import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { corsHeaders } from '../types/api';
import { StatusCode } from '../constants/status-codes';
import { ErrorResponse } from '../constants/errors';
import { EnvironmentKey, getEnv } from '../constants/environment';
import { logger } from '../util/logger';
import { PolicyConfigStore } from '../services/policy-enforcer/policy-config-store';
import { validatePolicyConfiguration } from '../services/policy-enforcer/validation';
import { computeAllowList } from '../services/policy-enforcer/allow-list-engine';
import { generatePolicyDocument } from '../services/policy-enforcer/policy-document-generator';
import { S3BucketClient } from '../services/s3-client';
import {
  IAMClient,
  CreatePolicyCommand,
  CreatePolicyVersionCommand,
  ListPolicyVersionsCommand,
  DeletePolicyVersionCommand,
  DeletePolicyCommand,
} from '@aws-sdk/client-iam';
import type {
  CreatePolicyRequest,
  ListPoliciesQuery,
  PreviewResponse,
  PolicyStatus,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import type { ApiService } from '@capability-insights/shared/types/capability/api';

const iamClient = new IAMClient({});

function getStore(): PolicyConfigStore {
  const tableName = getEnv(EnvironmentKey.POLICY_TABLE_NAME);
  return new PolicyConfigStore(tableName);
}

function parseBody(event: APIGatewayProxyEvent): unknown {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

async function fetchCatalogData(): Promise<ApiService[]> {
  const bucketName = getEnv(EnvironmentKey.WEBSITE_BUCKET_NAME);
  const s3Client = new S3BucketClient(bucketName);
  const raw = await s3Client.getObject('data/json/apis.json');
  return JSON.parse(raw) as ApiService[];
}

// --- Route Handlers ---

/**
 * POST /policies — Create a new policy configuration.
 */
export const createPolicyRoute = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const body = parseBody(event);
  if (!body) {
    return {
      statusCode: StatusCode.BAD_REQUEST,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ValidationError', message: 'Request body is required' }),
    };
  }

  const request = body as CreatePolicyRequest;
  const validation = validatePolicyConfiguration(request);
  if (!validation.valid) {
    return {
      statusCode: StatusCode.BAD_REQUEST,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ValidationError', message: validation.errors.join('; ') }),
    };
  }

  try {
    const store = getStore();
    const policy = await store.createPolicy(request);
    return {
      statusCode: StatusCode.CREATED,
      headers: corsHeaders,
      body: JSON.stringify({ policy }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already exists')) {
      return {
        statusCode: StatusCode.CONFLICT,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Conflict', message: 'Policy name already exists' }),
      };
    }
    logger.error('Failed to create policy', { error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /policies — List all policy configurations with optional filters.
 */
export const listPoliciesRoute = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const query: ListPoliciesQuery = {};
  const params = event.queryStringParameters;

  if (params?.tagKey) query.tagKey = params.tagKey;
  if (params?.tagValue) query.tagValue = params.tagValue;
  if (params?.status) query.status = params.status as PolicyStatus;
  if (params?.search) query.search = params.search;

  try {
    const store = getStore();
    const policies = await store.listPolicies(query);
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ policies }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to list policies', { error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /policies/:policyId — Return a single policy configuration or 404.
 */
export const getPolicyRoute = async (
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
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ policy }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get policy', { policyId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * PUT /policies/:policyId — Validate and update a policy configuration or 404.
 */
export const updatePolicyRoute = async (
  event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { policyId } = params;
  const body = parseBody(event);
  if (!body) {
    return {
      statusCode: StatusCode.BAD_REQUEST,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ValidationError', message: 'Request body is required' }),
    };
  }

  const updates = body as Partial<CreatePolicyRequest>;

  // Validate the update fields if they contain core configuration
  if (updates.regions || updates.mode || updates.policyType || updates.exceptions) {
    const validationTarget: CreatePolicyRequest = {
      policyName: updates.policyName ?? 'placeholder',
      regions: updates.regions ?? ['us-east-1'],
      mode: updates.mode ?? 'intersection',
      policyType: updates.policyType ?? 'IAM',
      exceptions: updates.exceptions,
      refreshIntervalHours: updates.refreshIntervalHours,
    };
    const validation = validatePolicyConfiguration(validationTarget);
    if (!validation.valid) {
      return {
        statusCode: StatusCode.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'ValidationError', message: validation.errors.join('; ') }),
      };
    }
  }

  try {
    const store = getStore();
    const policy = await store.updatePolicy(policyId, updates);
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ policy }),
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
    logger.error('Failed to update policy', { policyId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * DELETE /policies/:policyId — Remove a policy configuration or 404.
 */
export const deletePolicyRoute = async (
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

    // Delete the IAM policy if one was created
    if (policy.policyArn) {
      try {
        // Delete all non-default versions first (required before deleting the policy)
        const versions = await iamClient.send(new ListPolicyVersionsCommand({ PolicyArn: policy.policyArn }));
        for (const v of (versions.Versions ?? []).filter(v => !v.IsDefaultVersion)) {
          await iamClient.send(new DeletePolicyVersionCommand({
            PolicyArn: policy.policyArn,
            VersionId: v.VersionId,
          }));
        }
        await iamClient.send(new DeletePolicyCommand({ PolicyArn: policy.policyArn }));
        logger.info('Deleted IAM policy', { policyId, policyArn: policy.policyArn });
      } catch (iamError: unknown) {
        logger.warn('Failed to delete IAM policy (may not exist)', { policyArn: policy.policyArn, error: String(iamError) });
      }
    }

    await store.deletePolicy(policyId);
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Policy ${policyId} deleted` }),
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
    logger.error('Failed to delete policy', { policyId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * POST /policies/:policyId/refresh — Trigger an immediate policy refresh.
 */
export const refreshPolicyRoute = async (
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

    // Fetch catalog data and recompute
    let catalogData: ApiService[];
    try {
      catalogData = await fetchCatalogData();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Catalog data unavailable during refresh', { policyId, error: msg });
      return {
        statusCode: StatusCode.SERVICE_UNAVAILABLE,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'ServiceUnavailable', message: 'Catalog data is temporarily unavailable' }),
      };
    }

    const allowListResult = computeAllowList({ catalogData, configuration: policy });
    const generatedPolicy = generatePolicyDocument({
      allowList: allowListResult.actions,
      policyType: policy.policyType,
      policyName: policy.policyName,
      generationTimestamp: new Date().toISOString(),
    });

    // Create or update the IAM managed policy
    let policyArn = policy.policyArn;
    const policyDocument = JSON.stringify(generatedPolicy.documents[0]);

    if (!policyArn) {
      // Create new IAM policy
      const createResult = await iamClient.send(new CreatePolicyCommand({
        PolicyName: `PolicyEnforcer-${policy.policyName.replace(/[^a-zA-Z0-9+=,.@_-]/g, '-')}`,
        PolicyDocument: policyDocument,
        Description: `Managed by Policy Enforcer: ${policy.policyName}`,
      }));
      policyArn = createResult.Policy?.Arn;
      logger.info('Created IAM policy', { policyId, policyArn });
    } else {
      // Update existing policy by creating a new version
      // IAM allows max 5 versions — delete oldest non-default if at limit
      const versions = await iamClient.send(new ListPolicyVersionsCommand({ PolicyArn: policyArn }));
      const nonDefaultVersions = (versions.Versions ?? [])
        .filter(v => !v.IsDefaultVersion)
        .sort((a, b) => (a.CreateDate?.getTime() ?? 0) - (b.CreateDate?.getTime() ?? 0));

      if ((versions.Versions?.length ?? 0) >= 5 && nonDefaultVersions.length > 0) {
        await iamClient.send(new DeletePolicyVersionCommand({
          PolicyArn: policyArn,
          VersionId: nonDefaultVersions[0].VersionId,
        }));
      }

      await iamClient.send(new CreatePolicyVersionCommand({
        PolicyArn: policyArn,
        PolicyDocument: policyDocument,
        SetAsDefault: true,
      }));
      logger.info('Updated IAM policy version', { policyId, policyArn });
    }

    // Update the policy config with refresh results and ARN
    await store.updatePolicy(policyId, {
      status: 'active',
      policyArn,
      lastRefreshTime: new Date().toISOString(),
      lastRefreshOutcome: 'success',
      lastActionCount: allowListResult.actionCount,
    });

    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({
        message: 'Policy refreshed successfully',
        policyArn,
        actionCount: allowListResult.actionCount,
        splitRequired: generatedPolicy.splitRequired,
        totalSize: generatedPolicy.totalSize,
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to refresh policy', { policyId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /policies/:policyId/preview — Fetch catalog data, compute allow-list, return preview.
 */
export const previewPolicyRoute = async (
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

    let catalogData: ApiService[];
    try {
      catalogData = await fetchCatalogData();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Catalog data unavailable for preview', { policyId, error: msg });
      return {
        statusCode: StatusCode.SERVICE_UNAVAILABLE,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'ServiceUnavailable', message: 'Catalog data is temporarily unavailable' }),
      };
    }

    const allowListResult = computeAllowList({ catalogData, configuration: policy });
    const generatedPolicy = generatePolicyDocument({
      allowList: allowListResult.actions,
      policyType: policy.policyType,
      policyName: policy.policyName,
      generationTimestamp: new Date().toISOString(),
    });

    const preview: PreviewResponse = {
      actions: allowListResult.actions,
      actionCount: allowListResult.actionCount,
      excludedCount: allowListResult.excludedCount,
      exceptionCount: allowListResult.exceptionCount,
      estimatedPolicySize: generatedPolicy.totalSize,
      splitRequired: generatedPolicy.splitRequired,
    };

    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify(preview),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to preview policy', { policyId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /policies/:policyId/template — Generate and return a CloudFormation template.
 */
export const templatePolicyRoute = async (
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

    // Generate a basic CloudFormation template for the policy configuration
    const template = {
      AWSTemplateFormatVersion: '2010-09-09',
      Description: `Policy Enforcer deployment for "${policy.policyName}"`,
      Parameters: {
        CatalogApiEndpoint: {
          Type: 'String',
          Description: 'The endpoint URL for the Catalog API',
        },
        RefreshIntervalHours: {
          Type: 'Number',
          Default: policy.refreshIntervalHours,
          Description: 'How often to refresh the policy (in hours)',
          MinValue: 1,
          MaxValue: 24,
        },
      },
      Resources: {
        PolicyConfigTable: {
          Type: 'AWS::DynamoDB::Table',
          Properties: {
            TableName: { 'Fn::Sub': '${AWS::StackName}-config' },
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [{ AttributeName: 'policyId', AttributeType: 'S' }],
            KeySchema: [{ AttributeName: 'policyId', KeyType: 'HASH' }],
            SSESpecification: { SSEEnabled: true },
          },
        },
      },
      Outputs: {
        PolicyConfigTableName: {
          Value: { Ref: 'PolicyConfigTable' },
          Description: 'Name of the policy configuration DynamoDB table',
        },
      },
    };

    return {
      statusCode: StatusCode.OK,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate template', { policyId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};
