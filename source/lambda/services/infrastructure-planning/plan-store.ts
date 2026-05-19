import {
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { docClient, buildUpdateExpression } from '../dynamo-client';
import { S3BucketClient } from '../s3-client';
import { logger } from '../../util/logger';
import type {
  PlanConfiguration,
  CapabilitySet,
  CreatePlanRequest,
  UpdatePlanRequest,
  ListPlansQuery,
  PlanNamesResponse,
} from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';

const s3Client = new S3Client({});

/** The GSI name used for plan name uniqueness enforcement and lookups. */
const PLAN_NAME_INDEX = 'PlanNameIndex';

/** Convert a PlanConfiguration to a DynamoDB item format. */
export function serializeToItem(config: PlanConfiguration): Record<string, unknown> {
  return { ...config };
}

/** Convert a DynamoDB item to a PlanConfiguration. */
export function deserializeFromItem(item: Record<string, unknown>): PlanConfiguration {
  return item as unknown as PlanConfiguration;
}

export class PlanStore {
  constructor(
    private tableName: string,
    private bucketName: string,
  ) {}

  /** Build the S3 key for a plan's capability set. */
  private getCapabilitySetKey(planId: string): string {
    return `data/plans/${planId}/capability-set.json`;
  }

  /** Query the PlanNameIndex GSI to check if a plan name already exists. */
  private async getPlanByNameFromIndex(planName: string): Promise<PlanConfiguration | null> {
    try {
      const result = await docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: PLAN_NAME_INDEX,
          KeyConditionExpression: 'planName = :planName',
          ExpressionAttributeValues: { ':planName': planName },
          Limit: 1,
        }),
      );

      if (!result.Items || result.Items.length === 0) {
        return null;
      }

      return deserializeFromItem(result.Items[0] as Record<string, unknown>);
    } catch (error: unknown) {
      logger.error('Failed to query plan by name', { planName, error: String(error) });
      throw new Error(`Failed to query plan by name "${planName}": ${error}`);
    }
  }

  /** Create a new plan. Throws if planName already exists. */
  async createPlan(
    request: CreatePlanRequest,
    capabilitySet: CapabilitySet,
  ): Promise<PlanConfiguration> {
    // Enforce plan name uniqueness via GSI query
    const existing = await this.getPlanByNameFromIndex(request.planName);
    if (existing) {
      throw new Error(`Plan with name "${request.planName}" already exists`);
    }

    const now = new Date().toISOString();
    const planId = crypto.randomUUID();
    const capabilitySetKey = this.getCapabilitySetKey(planId);

    const plan: PlanConfiguration = {
      planId,
      planName: request.planName,
      sourceType: request.sourceType,
      labels: request.labels ?? [],
      status: 'ready',
      capabilitySetKey,
      resourceTypeCount: capabilitySet.cfnResourceTypes.length,
      apiOperationCount: capabilitySet.apiOperations.length,
      createdAt: now,
      updatedAt: now,
      lastRefreshedAt: now,
      ...(request.repositoryUrl ? { repositoryUrl: request.repositoryUrl } : {}),
    };

    // Store capability set in S3
    const s3BucketClient = new S3BucketClient(this.bucketName);
    try {
      await s3BucketClient.putObject(
        capabilitySetKey,
        JSON.stringify(capabilitySet),
        'application/json',
      );
    } catch (error: unknown) {
      logger.error('Failed to store capability set in S3', { planId, error: String(error) });
      throw new Error('Failed to store capability data');
    }

    // Store metadata in DynamoDB
    const item = serializeToItem(plan);
    try {
      await docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(planId)',
        }),
      );
    } catch (error: unknown) {
      // Attempt to clean up S3 on DynamoDB failure
      try {
        await s3Client.send(
          new DeleteObjectCommand({ Bucket: this.bucketName, Key: capabilitySetKey }),
        );
      } catch (cleanupError: unknown) {
        logger.warn('Failed to clean up S3 after DynamoDB write failure', {
          planId,
          error: String(cleanupError),
        });
      }

      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Plan with name "${request.planName}" already exists`);
      }
      logger.error('Failed to create plan in DynamoDB', { planId, error: String(error) });
      throw new Error(`Failed to create plan "${request.planName}": ${error}`);
    }

    logger.info('Created plan', { planId, planName: plan.planName });
    return plan;
  }

  /** Get a plan by its planId. Returns null if not found. */
  async getPlan(planId: string): Promise<PlanConfiguration | null> {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { planId },
        }),
      );

      if (!result.Item) {
        return null;
      }

      return deserializeFromItem(result.Item as Record<string, unknown>);
    } catch (error: unknown) {
      logger.error('Failed to get plan', { planId, error: String(error) });
      throw new Error(`Failed to get plan "${planId}": ${error}`);
    }
  }

  /** Get a plan by its name using the GSI. Returns null if not found. */
  async getPlanByName(planName: string): Promise<PlanConfiguration | null> {
    return this.getPlanByNameFromIndex(planName);
  }

  /** List plans with optional filtering by search term, source type, or label. */
  async listPlans(query?: ListPlansQuery): Promise<PlanConfiguration[]> {
    try {
      const expressionParts: string[] = [];
      const expressionValues: Record<string, unknown> = {};
      const expressionNames: Record<string, string> = {};

      if (query?.sourceType) {
        expressionParts.push('#sourceType = :sourceType');
        expressionValues[':sourceType'] = query.sourceType;
        expressionNames['#sourceType'] = 'sourceType';
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

      let items = (result.Items ?? []).map(item =>
        deserializeFromItem(item as Record<string, unknown>),
      );

      // Apply label filtering in-memory
      if (query?.labelKey && query?.labelValue) {
        items = items.filter(item =>
          item.labels.some(
            label => label.key === query.labelKey && label.value === query.labelValue,
          ),
        );
      }

      // Apply case-insensitive search on planName
      if (query?.search) {
        const searchLower = query.search.toLowerCase();
        items = items.filter(item => item.planName.toLowerCase().includes(searchLower));
      }

      return items;
    } catch (error: unknown) {
      logger.error('Failed to list plans', { error: String(error) });
      throw new Error(`Failed to list plans: ${error}`);
    }
  }

  /** Update plan metadata (name and/or labels). Throws if the plan does not exist. */
  async updatePlan(planId: string, updates: UpdatePlanRequest): Promise<PlanConfiguration> {
    // If planName is being changed, check uniqueness
    if (updates.planName) {
      const existing = await this.getPlanByNameFromIndex(updates.planName);
      if (existing && existing.planId !== planId) {
        throw new Error(`Plan with name "${updates.planName}" already exists`);
      }
    }

    const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (updates.planName !== undefined) fields.planName = updates.planName;
    if (updates.labels !== undefined) fields.labels = updates.labels;

    const expr = buildUpdateExpression(fields);
    if (!expr) {
      throw new Error(`No valid fields to update for plan "${planId}"`);
    }

    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { planId },
          ...expr,
          ConditionExpression: 'attribute_exists(planId)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      logger.info('Updated plan', { planId });
      return deserializeFromItem(result.Attributes as Record<string, unknown>);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Plan "${planId}" not found`);
      }
      logger.error('Failed to update plan', { planId, error: String(error) });
      throw new Error(`Failed to update plan "${planId}": ${error}`);
    }
  }

  /** Delete a plan and its capability set. Handles partial failures gracefully. */
  async deletePlan(planId: string): Promise<void> {
    // Get the plan first to find the S3 key
    const plan = await this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan "${planId}" not found`);
    }

    let dynamoDeleted = false;
    let s3Deleted = false;

    // Delete from DynamoDB
    try {
      await docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { planId },
          ConditionExpression: 'attribute_exists(planId)',
        }),
      );
      dynamoDeleted = true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Plan "${planId}" not found`);
      }
      logger.error('Failed to delete plan from DynamoDB', { planId, error: String(error) });
    }

    // Delete from S3
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: this.bucketName, Key: plan.capabilitySetKey }),
      );
      s3Deleted = true;
    } catch (error: unknown) {
      logger.error('Failed to delete capability set from S3', {
        planId,
        key: plan.capabilitySetKey,
        error: String(error),
      });
    }

    // Handle partial delete failures
    if (!dynamoDeleted || !s3Deleted) {
      const failedParts = [];
      if (!dynamoDeleted) failedParts.push('DynamoDB');
      if (!s3Deleted) failedParts.push('S3');
      throw new Error(`Plan partially deleted. Failed to delete from: ${failedParts.join(', ')}. Retry to complete.`);
    }

    logger.info('Deleted plan', { planId });
  }

  /** Get plan names for autocomplete. Returns all plan names sorted alphabetically. */
  async listPlanNames(): Promise<PlanNamesResponse> {
    try {
      const result = await docClient.send(
        new ScanCommand({
          TableName: this.tableName,
          ProjectionExpression: 'planName',
        }),
      );

      const planNames = (result.Items ?? [])
        .map(item => item.planName as string)
        .filter(Boolean)
        .sort();

      return { planNames };
    } catch (error: unknown) {
      logger.error('Failed to list plan names', { error: String(error) });
      throw new Error(`Failed to list plan names: ${error}`);
    }
  }

  /** Get the capability set for a plan from S3. */
  async getCapabilitySet(planId: string): Promise<CapabilitySet | null> {
    const plan = await this.getPlan(planId);
    if (!plan) {
      return null;
    }

    try {
      const s3BucketClient = new S3BucketClient(this.bucketName);
      const raw = await s3BucketClient.getObject(plan.capabilitySetKey);
      return JSON.parse(raw) as CapabilitySet;
    } catch (error: unknown) {
      logger.error('Failed to get capability set from S3', {
        planId,
        key: plan.capabilitySetKey,
        error: String(error),
      });
      throw new Error(`Failed to get capability set for plan "${planId}": ${error}`);
    }
  }

  /** Update the capability set and related metadata after reprocessing. */
  async updateCapabilitySet(planId: string, capabilitySet: CapabilitySet): Promise<PlanConfiguration> {
    const plan = await this.getPlan(planId);
    if (!plan) {
      throw new Error(`Plan "${planId}" not found`);
    }

    // Store updated capability set in S3
    const s3BucketClient = new S3BucketClient(this.bucketName);
    try {
      await s3BucketClient.putObject(
        plan.capabilitySetKey,
        JSON.stringify(capabilitySet),
        'application/json',
      );
    } catch (error: unknown) {
      logger.error('Failed to update capability set in S3', { planId, error: String(error) });
      throw new Error('Failed to store capability data');
    }

    // Update metadata counts and timestamp
    const now = new Date().toISOString();
    try {
      const result = await docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { planId },
          UpdateExpression:
            'SET #resourceTypeCount = :resourceTypeCount, #apiOperationCount = :apiOperationCount, #status = :status, #updatedAt = :updatedAt, #lastRefreshedAt = :lastRefreshedAt REMOVE #errorMessage',
          ExpressionAttributeNames: {
            '#resourceTypeCount': 'resourceTypeCount',
            '#apiOperationCount': 'apiOperationCount',
            '#status': 'status',
            '#updatedAt': 'updatedAt',
            '#lastRefreshedAt': 'lastRefreshedAt',
            '#errorMessage': 'errorMessage',
          },
          ExpressionAttributeValues: {
            ':resourceTypeCount': capabilitySet.cfnResourceTypes.length,
            ':apiOperationCount': capabilitySet.apiOperations.length,
            ':status': 'ready',
            ':updatedAt': now,
            ':lastRefreshedAt': now,
          },
          ConditionExpression: 'attribute_exists(planId)',
          ReturnValues: 'ALL_NEW',
        }),
      );

      logger.info('Updated capability set', { planId });
      return deserializeFromItem(result.Attributes as Record<string, unknown>);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        throw new Error(`Plan "${planId}" not found`);
      }
      logger.error('Failed to update plan metadata after capability set update', {
        planId,
        error: String(error),
      });
      throw new Error(`Failed to update plan "${planId}": ${error}`);
    }
  }
}
