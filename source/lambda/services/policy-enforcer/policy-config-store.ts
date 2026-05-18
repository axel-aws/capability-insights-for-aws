import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { logger } from '../../util/logger';
import type {
  PolicyConfiguration,
  CreatePolicyRequest,
  ListPoliciesQuery,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);

/** Convert a PolicyConfiguration to a DynamoDB item format. */
export function serializeToItem(config: PolicyConfiguration): Record<string, unknown> {
  return { ...config };
}

/** Convert a DynamoDB item to a PolicyConfiguration. */
export function deserializeFromItem(item: Record<string, unknown>): PolicyConfiguration {
  return item as unknown as PolicyConfiguration;
}

export class PolicyConfigStore {
  constructor(private tableName: string) {}

  /** Create a new policy configuration. Throws if policyName already exists. */
  async createPolicy(request: CreatePolicyRequest): Promise<PolicyConfiguration> {
    const now = new Date().toISOString();
    const policy: PolicyConfiguration = {
      policyId: crypto.randomUUID(),
      policyName: request.policyName,
      description: request.description,
      tags: request.tags ?? [],
      regions: request.regions,
      mode: request.mode,
      policyType: request.policyType,
      exceptions: request.exceptions ?? [],
      refreshIntervalHours: request.refreshIntervalHours ?? 24,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    const item = serializeToItem(policy);

    try {
      await docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(policyName)',
        }),
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Policy with name "${request.policyName}" already exists`);
      }
      logger.error('Failed to create policy', { policyName: request.policyName, error: String(error) });
      throw new Error(`Failed to create policy "${request.policyName}": ${error}`);
    }

    logger.info('Created policy', { policyId: policy.policyId, policyName: policy.policyName });
    return policy;
  }

  /** Get a policy by its policyId. Returns null if not found. */
  async getPolicy(policyId: string): Promise<PolicyConfiguration | null> {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { policyId },
        }),
      );

      if (!result.Item) {
        return null;
      }

      return deserializeFromItem(result.Item as Record<string, unknown>);
    } catch (error: unknown) {
      logger.error('Failed to get policy', { policyId, error: String(error) });
      throw new Error(`Failed to get policy "${policyId}": ${error}`);
    }
  }

  /** List policies with optional filtering by tag, status, or search term. */
  async listPolicies(query?: ListPoliciesQuery): Promise<PolicyConfiguration[]> {
    try {
      const expressionParts: string[] = [];
      const expressionValues: Record<string, unknown> = {};
      const expressionNames: Record<string, string> = {};

      if (query?.status) {
        expressionParts.push('#status = :status');
        expressionValues[':status'] = query.status;
        expressionNames['#status'] = 'status';
      }

      if (query?.tagKey && query?.tagValue) {
        // Tag filtering is handled post-scan since DynamoDB doesn't natively
        // support filtering inside list-of-map attributes with expressions easily.
        // We apply a contains-based filter for the key and do exact match post-scan.
      }

      const result = await docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          ...(expressionParts.length > 0 && {
            FilterExpression: expressionParts.join(' AND '),
            ExpressionAttributeValues: expressionValues,
            ...(Object.keys(expressionNames).length > 0 && {
              ExpressionAttributeNames: expressionNames,
            }),
          }),
        }),
      );

      let items = (result.Items ?? []).map(item => deserializeFromItem(item as Record<string, unknown>));

      // Filter out the SYNC_SETTINGS record (stored in same table but not a policy)
      items = items.filter(item => item.policyId !== 'SYNC_SETTINGS');

      // Apply tag filtering in-memory
      if (query?.tagKey && query?.tagValue) {
        items = items.filter(item =>
          item.tags.some(tag => tag.key === query.tagKey && tag.value === query.tagValue),
        );
      }

      // Apply case-insensitive search on policyName or description
      if (query?.search) {
        const searchLower = query.search.toLowerCase();
        items = items.filter(item => {
          const nameMatch = item.policyName.toLowerCase().includes(searchLower);
          const descMatch = item.description?.toLowerCase().includes(searchLower) ?? false;
          return nameMatch || descMatch;
        });
      }

      return items;
    } catch (error: unknown) {
      logger.error('Failed to list policies', { error: String(error) });
      throw new Error(`Failed to list policies: ${error}`);
    }
  }

  /** Update specific fields of a policy. Throws if the policy does not exist. */
  async updatePolicy(policyId: string, updates: Partial<PolicyConfiguration>): Promise<PolicyConfiguration> {
    const { policyId: _id, createdAt: _created, ...allowedUpdates } = updates as Record<string, unknown>;
    const fields = { ...allowedUpdates, updatedAt: new Date().toISOString() };

    const expressionParts: string[] = [];
    const expressionValues: Record<string, unknown> = {};
    const expressionNames: Record<string, string> = {};

    let index = 0;
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const attrAlias = `#attr${index}`;
      const valAlias = `:val${index}`;
      expressionParts.push(`${attrAlias} = ${valAlias}`);
      expressionNames[attrAlias] = key;
      expressionValues[valAlias] = value;
      index++;
    }

    if (expressionParts.length === 0) {
      throw new Error(`No valid fields to update for policy "${policyId}"`);
    }

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { policyId },
          UpdateExpression: `SET ${expressionParts.join(', ')}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
          ConditionExpression: 'attribute_exists(policyId)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      logger.info('Updated policy', { policyId });
      return deserializeFromItem(result.Attributes as Record<string, unknown>);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Policy "${policyId}" not found`);
      }
      logger.error('Failed to update policy', { policyId, error: String(error) });
      throw new Error(`Failed to update policy "${policyId}": ${error}`);
    }
  }

  /** Delete a policy by policyId. Throws if the policy does not exist. */
  async deletePolicy(policyId: string): Promise<void> {
    try {
      await docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { policyId },
          ConditionExpression: 'attribute_exists(policyId)',
        }),
      );
      logger.info('Deleted policy', { policyId });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Policy "${policyId}" not found`);
      }
      logger.error('Failed to delete policy', { policyId, error: String(error) });
      throw new Error(`Failed to delete policy "${policyId}": ${error}`);
    }
  }
}
