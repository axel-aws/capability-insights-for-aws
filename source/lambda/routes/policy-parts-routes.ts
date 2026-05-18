import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { corsHeaders } from '../types/api';
import { StatusCode } from '../constants/status-codes';
import { ErrorResponse } from '../constants/errors';
import { EnvironmentKey, getEnv } from '../constants/environment';
import { logger } from '../util/logger';
import { PolicyConfigStore } from '../services/policy-enforcer/policy-config-store';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type {
  PolicyConfiguration,
  PolicyPart,
  PolicyPartsResponse,
  PolicyPartDetailResponse,
  ServiceActionGroup,
  CascadingDeleteResponse,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

const lambdaClient = new LambdaClient({});

interface IAMHelperResponse {
  success: boolean;
  policyArn?: string;
  policyDocument?: string;
  error?: string;
}

async function invokeIAMHelper(payload: Record<string, unknown>): Promise<IAMHelperResponse> {
  const helperName = getEnv(EnvironmentKey.IAM_HELPER_LAMBDA_NAME);
  const result = await lambdaClient.send(new InvokeCommand({
    FunctionName: helperName,
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  const response = JSON.parse(Buffer.from(result.Payload ?? '{}').toString());
  return response;
}

function getStore(): PolicyConfigStore {
  const tableName = getEnv(EnvironmentKey.POLICY_TABLE_NAME);
  return new PolicyConfigStore(tableName);
}

/**
 * Derive the list of all ARNs from a PolicyConfiguration.
 * Index 0 = policyArn (blanket-deny), Index 1+ = additionalPolicyArns (specific-api-deny).
 */
function getAllArns(policy: PolicyConfiguration): string[] {
  const arns: string[] = [];
  if (policy.policyArn) {
    arns.push(policy.policyArn);
  }
  if (policy.additionalPolicyArns) {
    arns.push(...policy.additionalPolicyArns);
  }
  return arns;
}

/**
 * Count statement items (NotAction or Action array lengths) across all statements.
 */
export function countStatementItems(document: Record<string, unknown>): number {
  const statements = document.Statement;
  if (!Array.isArray(statements)) return 0;

  let count = 0;
  for (const statement of statements) {
    if (Array.isArray(statement.NotAction)) {
      count += statement.NotAction.length;
    } else if (Array.isArray(statement.Action)) {
      count += statement.Action.length;
    }
  }
  return count;
}

/**
 * Group actions by service prefix for display.
 */
export function groupActionsByService(actions: string[]): ServiceActionGroup[] {
  const groups = new Map<string, string[]>();
  for (const action of actions) {
    const [prefix, ...rest] = action.split(':');
    const servicePrefix = prefix;
    if (!groups.has(servicePrefix)) groups.set(servicePrefix, []);
    groups.get(servicePrefix)!.push(rest.join(':'));
  }
  return Array.from(groups.entries())
    .map(([servicePrefix, actions]) => ({ servicePrefix, actions }))
    .sort((a, b) => a.servicePrefix.localeCompare(b.servicePrefix));
}

/**
 * Extract all actions from a policy document (from NotAction or Action arrays).
 */
function extractActions(document: Record<string, unknown>): string[] {
  const statements = document.Statement;
  if (!Array.isArray(statements)) return [];

  const actions: string[] = [];
  for (const statement of statements) {
    if (Array.isArray(statement.NotAction)) {
      actions.push(...statement.NotAction);
    } else if (Array.isArray(statement.Action)) {
      actions.push(...statement.Action);
    }
  }
  return actions;
}

// --- Route Handlers ---

/**
 * GET /policies/:policyId/parts — List all policy parts with metadata.
 */
export const getPolicyPartsRoute = async (
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { policyId } = params;

  try {
    const store = getStore();
    const policy = await store.getPolicy(policyId);
    if (!policy) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Policy ${policyId} not found` }),
      };
    }

    const arns = getAllArns(policy);
    if (arns.length === 0) {
      const response: PolicyPartsResponse = {
        parts: [],
        totalParts: 0,
        combinedSize: 0,
      };
      return {
        statusCode: StatusCode.OK,
        headers: corsHeaders,
        body: JSON.stringify(response),
      };
    }

    const parts: PolicyPart[] = [];
    let combinedSize = 0;

    for (let i = 0; i < arns.length; i++) {
      const arn = arns[i];
      const iamResult = await invokeIAMHelper({ action: 'getPolicyDocument', policyArn: arn });

      let documentSize = 0;
      let statementItemCount = 0;

      if (iamResult.success && iamResult.policyDocument) {
        documentSize = iamResult.policyDocument.length;
        try {
          const doc = JSON.parse(iamResult.policyDocument);
          statementItemCount = countStatementItems(doc);
        } catch {
          // If parsing fails, leave statementItemCount as 0
        }
      }

      const part: PolicyPart = {
        partIndex: i,
        arn,
        partType: i === 0 ? 'blanket-deny' : 'specific-api-deny',
        documentSize,
        statementItemCount,
      };

      parts.push(part);
      combinedSize += documentSize;
    }

    const response: PolicyPartsResponse = {
      parts,
      totalParts: parts.length,
      combinedSize,
    };

    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get policy parts', { policyId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /policies/:policyId/parts/:partIndex — Fetch live policy document for a specific part.
 */
export const getPolicyPartDetailRoute = async (
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { policyId, partIndex: partIndexStr } = params;
  const partIndex = parseInt(partIndexStr, 10);

  if (isNaN(partIndex) || partIndex < 0) {
    return {
      statusCode: StatusCode.NOT_FOUND,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'NotFound', message: 'Part not found' }),
    };
  }

  try {
    const store = getStore();
    const policy = await store.getPolicy(policyId);
    if (!policy) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Policy ${policyId} not found` }),
      };
    }

    const arns = getAllArns(policy);
    if (partIndex >= arns.length) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: 'Part not found' }),
      };
    }

    const arn = arns[partIndex];
    let iamResult: IAMHelperResponse;
    try {
      iamResult = await invokeIAMHelper({ action: 'getPolicyDocument', policyArn: arn });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('IAM Helper invocation failed', { policyId, partIndex, error: msg });
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'BadGateway', message: 'Upstream IAM service unavailable' }),
      };
    }

    if (!iamResult.success) {
      return {
        statusCode: 502,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'BadGateway', message: `Upstream IAM service unavailable: ${iamResult.error}` }),
      };
    }

    const document = JSON.parse(iamResult.policyDocument!);
    const actions = extractActions(document);
    const services = groupActionsByService(actions);
    const statementItemCount = countStatementItems(document);

    const part: PolicyPart = {
      partIndex,
      arn,
      partType: partIndex === 0 ? 'blanket-deny' : 'specific-api-deny',
      documentSize: iamResult.policyDocument!.length,
      statementItemCount,
    };

    const response: PolicyPartDetailResponse = {
      part,
      document,
      services,
    };

    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get policy part detail', { policyId, partIndex, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * DELETE /policies/:policyId/parts/:partIndex — Delete a single policy part from IAM.
 */
export const deletePolicyPartRoute = async (
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { policyId, partIndex: partIndexStr } = params;
  const partIndex = parseInt(partIndexStr, 10);

  if (isNaN(partIndex) || partIndex < 0) {
    return {
      statusCode: StatusCode.NOT_FOUND,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'NotFound', message: 'Part not found' }),
    };
  }

  try {
    const store = getStore();
    const policy = await store.getPolicy(policyId);
    if (!policy) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Policy ${policyId} not found` }),
      };
    }

    const arns = getAllArns(policy);
    if (partIndex >= arns.length) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: 'Part not found' }),
      };
    }

    const arn = arns[partIndex];

    // Attempt to delete the IAM policy
    const iamResult = await invokeIAMHelper({ action: 'delete', policyArn: arn });
    if (!iamResult.success) {
      logger.error('Failed to delete IAM policy part', { policyId, partIndex, arn, error: iamResult.error });
      return ErrorResponse.internalServerError(`Failed to delete policy part: ${iamResult.error}`);
    }

    // On success: remove the ARN from the config
    if (partIndex === 0) {
      // Removing the primary ARN — promote the first additional ARN if available
      const newPrimaryArn = policy.additionalPolicyArns?.[0];
      const newAdditionalArns = policy.additionalPolicyArns?.slice(1);
      await store.updatePolicy(policyId, {
        policyArn: newPrimaryArn ?? undefined,
        additionalPolicyArns: newAdditionalArns && newAdditionalArns.length > 0 ? newAdditionalArns : undefined,
      } as Partial<PolicyConfiguration>);
    } else {
      // Removing from additionalPolicyArns
      const additionalIndex = partIndex - 1;
      const newAdditionalArns = [...(policy.additionalPolicyArns ?? [])];
      newAdditionalArns.splice(additionalIndex, 1);
      await store.updatePolicy(policyId, {
        additionalPolicyArns: newAdditionalArns.length > 0 ? newAdditionalArns : undefined,
      } as Partial<PolicyConfiguration>);
    }

    logger.info('Deleted policy part', { policyId, partIndex, arn });
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Part ${partIndex} deleted`, arn }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to delete policy part', { policyId, partIndex, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * DELETE /policies/:policyId — Cascading delete of all policy parts and DynamoDB record.
 * Enhanced version that tracks partial failures.
 */
export const cascadingDeletePolicyRoute = async (
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { policyId } = params;

  try {
    const store = getStore();
    const policy = await store.getPolicy(policyId);
    if (!policy) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Policy ${policyId} not found` }),
      };
    }

    const arns = getAllArns(policy);

    // If no ARNs exist (never refreshed), just delete the DynamoDB record
    if (arns.length === 0) {
      await store.deletePolicy(policyId);
      return {
        statusCode: StatusCode.OK,
        headers: corsHeaders,
        body: JSON.stringify({
          success: true,
          deletedArns: [],
          failedArns: [],
        } as CascadingDeleteResponse),
      };
    }

    // Attempt deletion of each ARN, continuing on individual failures
    const deletedArns: string[] = [];
    const failedArns: { arn: string; error: string }[] = [];

    for (const arn of arns) {
      try {
        const iamResult = await invokeIAMHelper({ action: 'delete', policyArn: arn });
        if (iamResult.success) {
          deletedArns.push(arn);
        } else {
          failedArns.push({ arn, error: iamResult.error ?? 'Unknown error' });
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        failedArns.push({ arn, error: msg });
      }
    }

    // Always delete the DynamoDB record (even on partial failure)
    await store.deletePolicy(policyId);

    const response: CascadingDeleteResponse = {
      success: failedArns.length === 0,
      deletedArns,
      failedArns,
    };

    logger.info('Cascading delete completed', { policyId, deletedArns, failedArns });

    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify(response),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not found')) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Policy ${policyId} not found` }),
      };
    }
    logger.error('Failed to cascade delete policy', { policyId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};
