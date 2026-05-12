import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IAMClient, CreatePolicyVersionCommand, ListPolicyVersionsCommand, DeletePolicyVersionCommand } from '@aws-sdk/client-iam';
import { OrganizationsClient, UpdatePolicyCommand } from '@aws-sdk/client-organizations';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { computeAllowList } from './services/policy-enforcer/allow-list-engine';
import { generatePolicyDocument } from './services/policy-enforcer/policy-document-generator';
import { logger } from './util/logger';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import type { ApiService } from '@capability-insights/shared/types/capability/api';

export interface RefreshResult {
  success: boolean;
  actionCount: number;
  policyUpdated: boolean;
  error?: string;
  retainedExistingPolicy: boolean;
}

// Environment variables
const CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME ?? '';
const CATALOG_API_ENDPOINT = process.env.CATALOG_API_ENDPOINT ?? '';
const POLICY_CONFIG_ID = process.env.POLICY_CONFIG_ID ?? '';
const POLICY_TYPE = (process.env.POLICY_TYPE ?? 'IAM') as 'IAM' | 'SCP';
const POLICY_ARN = process.env.POLICY_ARN ?? '';

// AWS SDK clients
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const iamClient = new IAMClient({});
const organizationsClient = new OrganizationsClient({});
const cloudWatchClient = new CloudWatchClient({});

const METRIC_NAMESPACE = 'PolicyEnforcer';

/**
 * Sleeps for the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes an async operation with retry logic using exponential backoff.
 * Retries up to maxRetries times with delays of 1s, 2s, 4s.
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        logger.warn(`${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms`, {
          error: String(error),
          attempt: attempt + 1,
        });
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

/**
 * Reads the PolicyConfiguration from the DynamoDB Config Table.
 */
async function readPolicyConfiguration(policyId: string): Promise<PolicyConfiguration> {
  const result = await docClient.send(
    new GetCommand({
      TableName: CONFIG_TABLE_NAME,
      Key: { policyId },
    }),
  );

  if (!result.Item) {
    throw new Error(`Policy configuration "${policyId}" not found in table "${CONFIG_TABLE_NAME}"`);
  }

  return result.Item as PolicyConfiguration;
}

/**
 * Fetches catalog data from the Catalog API endpoint with retry logic.
 */
async function fetchCatalogData(): Promise<ApiService[]> {
  return withRetry(async () => {
    const response = await fetch(CATALOG_API_ENDPOINT);

    if (!response.ok) {
      throw new Error(`Catalog API returned status ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data as ApiService[];
  }, 'Catalog API fetch');
}

/**
 * Updates an IAM managed policy with the new policy document.
 * Handles the 5-version limit by deleting the oldest non-default version if needed.
 */
async function updateIamPolicy(policyArn: string, policyDocument: string): Promise<void> {
  await withRetry(async () => {
    // List existing versions to check if we need to delete one
    const listResult = await iamClient.send(
      new ListPolicyVersionsCommand({ PolicyArn: policyArn }),
    );

    const versions = listResult.Versions ?? [];
    if (versions.length >= 5) {
      // Delete the oldest non-default version
      const nonDefaultVersions = versions
        .filter(v => !v.IsDefaultVersion)
        .sort((a, b) => {
          const dateA = a.CreateDate?.getTime() ?? 0;
          const dateB = b.CreateDate?.getTime() ?? 0;
          return dateA - dateB;
        });

      if (nonDefaultVersions.length > 0) {
        await iamClient.send(
          new DeletePolicyVersionCommand({
            PolicyArn: policyArn,
            VersionId: nonDefaultVersions[0].VersionId,
          }),
        );
      }
    }

    // Create new policy version and set as default
    await iamClient.send(
      new CreatePolicyVersionCommand({
        PolicyArn: policyArn,
        PolicyDocument: policyDocument,
        SetAsDefault: true,
      }),
    );
  }, 'IAM policy update');
}

/**
 * Updates a Service Control Policy with the new policy document.
 */
async function updateScpPolicy(policyArn: string, policyDocument: string): Promise<void> {
  // Extract the policy ID from the ARN (last segment after /)
  const policyId = policyArn.split('/').pop() ?? policyArn;

  await withRetry(async () => {
    await organizationsClient.send(
      new UpdatePolicyCommand({
        PolicyId: policyId,
        Content: policyDocument,
      }),
    );
  }, 'SCP policy update');
}

/**
 * Emits a CloudWatch metric for the Policy Enforcer.
 */
async function emitMetric(metricName: string, value: number): Promise<void> {
  try {
    await cloudWatchClient.send(
      new PutMetricDataCommand({
        Namespace: METRIC_NAMESPACE,
        MetricData: [
          {
            MetricName: metricName,
            Value: value,
            Unit: 'Count',
            Timestamp: new Date(),
            Dimensions: [
              { Name: 'PolicyId', Value: POLICY_CONFIG_ID },
              { Name: 'PolicyType', Value: POLICY_TYPE },
            ],
          },
        ],
      }),
    );
  } catch (error: unknown) {
    logger.warn('Failed to emit CloudWatch metric', { metricName, error: String(error) });
  }
}

/**
 * Updates the config table with refresh outcome metadata.
 */
async function updateRefreshMetadata(
  policyId: string,
  outcome: 'success' | 'retained' | 'error',
  actionCount: number,
): Promise<void> {
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: CONFIG_TABLE_NAME,
        Key: { policyId },
        UpdateExpression: 'SET lastRefreshTime = :time, lastRefreshOutcome = :outcome, lastActionCount = :count, updatedAt = :updated',
        ExpressionAttributeValues: {
          ':time': new Date().toISOString(),
          ':outcome': outcome,
          ':count': actionCount,
          ':updated': new Date().toISOString(),
        },
      }),
    );
  } catch (error: unknown) {
    logger.warn('Failed to update refresh metadata', { policyId, error: String(error) });
  }
}

/**
 * Refresh Lambda handler.
 * Reads policy configuration, fetches catalog data, computes the allow-list,
 * generates the policy document, and updates the IAM Policy or SCP.
 */
export async function handler(): Promise<RefreshResult> {
  logger.info('Starting policy refresh', {
    policyConfigId: POLICY_CONFIG_ID,
    policyType: POLICY_TYPE,
    policyArn: POLICY_ARN,
  });

  let configuration: PolicyConfiguration;

  // Step 1: Read PolicyConfiguration from DynamoDB
  try {
    configuration = await readPolicyConfiguration(POLICY_CONFIG_ID);
  } catch (error: unknown) {
    const errorMessage = `Failed to read policy configuration: ${String(error)}`;
    logger.error(errorMessage, { policyConfigId: POLICY_CONFIG_ID });
    await emitMetric('PolicyUpdateFailure', 1);
    await updateRefreshMetadata(POLICY_CONFIG_ID, 'error', 0);
    return {
      success: false,
      actionCount: 0,
      policyUpdated: false,
      error: errorMessage,
      retainedExistingPolicy: true,
    };
  }

  // Step 2: Fetch catalog data from Catalog API with retry
  let catalogData: ApiService[];
  try {
    catalogData = await fetchCatalogData();
  } catch (error: unknown) {
    const errorMessage = `Failed to fetch catalog data after retries: ${String(error)}`;
    logger.warn(errorMessage, { policyConfigId: POLICY_CONFIG_ID });
    await emitMetric('PolicyUpdateFailure', 1);
    await updateRefreshMetadata(POLICY_CONFIG_ID, 'retained', configuration.lastActionCount ?? 0);
    return {
      success: false,
      actionCount: configuration.lastActionCount ?? 0,
      policyUpdated: false,
      error: errorMessage,
      retainedExistingPolicy: true,
    };
  }

  // Step 3: Compute allow-list
  const allowListResult = computeAllowList({
    catalogData,
    configuration,
  });

  logger.info('Allow-list computed', {
    actionCount: allowListResult.actionCount,
    excludedCount: allowListResult.excludedCount,
    exceptionCount: allowListResult.exceptionCount,
  });

  // Step 4: Generate policy document
  const generatedPolicy = generatePolicyDocument({
    allowList: allowListResult.actions,
    policyType: POLICY_TYPE,
    policyName: configuration.policyName,
    generationTimestamp: new Date().toISOString(),
  });

  if (generatedPolicy.error) {
    const errorMessage = `Policy document generation error: ${generatedPolicy.error}`;
    logger.error(errorMessage, { policyConfigId: POLICY_CONFIG_ID });
    await emitMetric('PolicyUpdateFailure', 1);
    await updateRefreshMetadata(POLICY_CONFIG_ID, 'error', allowListResult.actionCount);
    return {
      success: false,
      actionCount: allowListResult.actionCount,
      policyUpdated: false,
      error: errorMessage,
      retainedExistingPolicy: true,
    };
  }

  // Step 5: Update IAM Policy or SCP via AWS SDK (with retry)
  try {
    const policyDocumentJson = JSON.stringify(generatedPolicy.documents[0]);

    if (POLICY_TYPE === 'SCP') {
      await updateScpPolicy(POLICY_ARN, policyDocumentJson);
    } else {
      await updateIamPolicy(POLICY_ARN, policyDocumentJson);
    }

    logger.info('Policy updated successfully', {
      policyArn: POLICY_ARN,
      actionCount: allowListResult.actionCount,
      policyType: POLICY_TYPE,
    });
  } catch (error: unknown) {
    // Fail-open: retain existing policy
    const errorMessage = `Failed to update policy after retries: ${String(error)}`;
    logger.warn(errorMessage, { policyArn: POLICY_ARN });
    await emitMetric('PolicyUpdateFailure', 1);
    await updateRefreshMetadata(POLICY_CONFIG_ID, 'retained', allowListResult.actionCount);
    return {
      success: false,
      actionCount: allowListResult.actionCount,
      policyUpdated: false,
      error: errorMessage,
      retainedExistingPolicy: true,
    };
  }

  // Step 6: Emit success metric and update config table
  await emitMetric('PolicyRefreshSuccess', 1);
  await updateRefreshMetadata(POLICY_CONFIG_ID, 'success', allowListResult.actionCount);

  logger.info('Policy refresh completed successfully', {
    policyConfigId: POLICY_CONFIG_ID,
    actionCount: allowListResult.actionCount,
  });

  return {
    success: true,
    actionCount: allowListResult.actionCount,
    policyUpdated: true,
    retainedExistingPolicy: false,
  };
}
