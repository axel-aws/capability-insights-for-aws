import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlanStore } from './plan-store';
import type {
  CreatePlanRequest,
  CapabilitySet,
} from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';

/**
 * Unit tests for PlanStore refresh metadata and source persistence.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 6.1
 */

// --- In-memory DynamoDB + S3 mock ---
let dynamoStore: Record<string, Record<string, unknown>> = {};
let s3Store: Record<string, string> = {};

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

const mockPutObject = vi.fn();
const mockGetObject = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-dynamodb')>(
    '@aws-sdk/client-dynamodb',
  );
  return {
    ...actual,
    DynamoDBClient: vi.fn().mockImplementation(() => ({})),
  };
});

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>(
    '@aws-sdk/lib-dynamodb',
  );
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({ send: mockSend }),
    },
    PutCommand: actual.PutCommand,
    GetCommand: actual.GetCommand,
    QueryCommand: actual.QueryCommand,
    ScanCommand: actual.ScanCommand,
    UpdateCommand: actual.UpdateCommand,
    DeleteCommand: actual.DeleteCommand,
  };
});

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>(
    '@aws-sdk/client-s3',
  );
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({}),
    })),
    DeleteObjectCommand: actual.DeleteObjectCommand,
  };
});

vi.mock('../s3-client', () => ({
  S3BucketClient: vi.fn().mockImplementation(() => ({
    putObject: mockPutObject,
    getObject: mockGetObject,
  })),
}));

/**
 * Sets up the in-memory mock to simulate DynamoDB operations for PlanStore.
 */
function setupInMemoryMock(): void {
  dynamoStore = {};
  s3Store = {};

  mockPutObject.mockImplementation((key: string, body: string) => {
    s3Store[key] = body;
    return Promise.resolve();
  });

  mockGetObject.mockImplementation((key: string) => {
    const data = s3Store[key];
    if (!data) return Promise.reject(new Error(`Key not found: ${key}`));
    return Promise.resolve(data);
  });

  mockSend.mockImplementation(
    (command: { input: Record<string, unknown>; constructor: { name: string } }) => {
      const commandName = command.constructor.name;

      if (commandName === 'QueryCommand') {
        const input = command.input as {
          IndexName?: string;
          KeyConditionExpression?: string;
          ExpressionAttributeValues?: Record<string, unknown>;
        };
        const planName = input.ExpressionAttributeValues?.[':planName'] as string;

        const matchingItems = Object.values(dynamoStore).filter(
          item => (item as Record<string, unknown>).planName === planName,
        );

        return Promise.resolve({ Items: matchingItems });
      }

      if (commandName === 'PutCommand') {
        const input = command.input as {
          Item: Record<string, unknown>;
          ConditionExpression?: string;
        };
        const item = input.Item;
        const planId = item.planId as string;

        if (input.ConditionExpression === 'attribute_not_exists(planId)' && dynamoStore[planId]) {
          const error = new Error('The conditional request failed');
          error.name = 'ConditionalCheckFailedException';
          return Promise.reject(error);
        }

        dynamoStore[planId] = { ...item };
        return Promise.resolve({});
      }

      if (commandName === 'GetCommand') {
        const input = command.input as { Key: Record<string, string> };
        const planId = input.Key.planId;
        const item = dynamoStore[planId];
        return Promise.resolve({ Item: item ?? undefined });
      }

      if (commandName === 'UpdateCommand') {
        const input = command.input as {
          Key: Record<string, string>;
          UpdateExpression: string;
          ExpressionAttributeNames: Record<string, string>;
          ExpressionAttributeValues: Record<string, unknown>;
          ConditionExpression?: string;
          ReturnValues?: string;
        };
        const planId = input.Key.planId;
        const item = dynamoStore[planId];

        if (!item) {
          if (input.ConditionExpression === 'attribute_exists(planId)') {
            const error = new Error('The conditional request failed');
            error.name = 'ConditionalCheckFailedException';
            return Promise.reject(error);
          }
          return Promise.reject(new Error(`Plan "${planId}" not found`));
        }

        // Apply SET expressions
        const setMatch = input.UpdateExpression.match(/SET\s+(.+?)(?:\s+REMOVE|$)/);
        if (setMatch) {
          const setParts = setMatch[1].split(',').map(s => s.trim());
          for (const part of setParts) {
            const [nameAlias, valueAlias] = part.split('=').map(s => s.trim());
            const actualName = input.ExpressionAttributeNames[nameAlias];
            const actualValue = input.ExpressionAttributeValues[valueAlias];
            if (actualName && actualValue !== undefined) {
              item[actualName] = actualValue;
            }
          }
        }

        // Apply REMOVE expressions
        const removeMatch = input.UpdateExpression.match(/REMOVE\s+(.+)/);
        if (removeMatch) {
          const removeParts = removeMatch[1].split(',').map(s => s.trim());
          for (const part of removeParts) {
            const actualName = input.ExpressionAttributeNames[part];
            if (actualName) {
              delete item[actualName];
            }
          }
        }

        dynamoStore[planId] = item;
        return Promise.resolve({ Attributes: { ...item } });
      }

      if (commandName === 'ScanCommand') {
        return Promise.resolve({ Items: Object.values(dynamoStore) });
      }

      return Promise.reject(new Error(`Unexpected command: ${commandName}`));
    },
  );
}

// --- Test helpers ---

const makeCapabilitySet = (overrides?: Partial<CapabilitySet>): CapabilitySet => ({
  cfnResourceTypes: ['AWS::S3::Bucket', 'AWS::Lambda::Function'],
  terraformResourceTypes: [],
  apiOperations: ['s3:GetObject'],
  serviceNames: ['Amazon S3', 'AWS Lambda'],
  terraformToCfnMapping: {},
  ...overrides,
});

// --- Tests ---

describe('PlanStore refresh metadata and source persistence', () => {
  let store: PlanStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setupInMemoryMock();
    store = new PlanStore('test-plan-table', 'test-bucket');
  });

  describe('lastRefreshedAt is set on creation', () => {
    it('sets lastRefreshedAt to the same value as createdAt on plan creation', async () => {
      const request: CreatePlanRequest = {
        planName: 'Test Plan',
        sourceType: 'cloudformation',
        labels: [],
      };

      const plan = await store.createPlan(request, makeCapabilitySet());

      expect(plan.lastRefreshedAt).toBeDefined();
      expect(plan.lastRefreshedAt).toBe(plan.createdAt);
    });

    it('sets lastRefreshedAt as a valid ISO 8601 timestamp on creation', async () => {
      const request: CreatePlanRequest = {
        planName: 'ISO Timestamp Plan',
        sourceType: 'terraform',
        labels: [],
      };

      const plan = await store.createPlan(request, makeCapabilitySet());

      // Verify it's a valid ISO 8601 date
      const parsed = new Date(plan.lastRefreshedAt);
      expect(parsed.toISOString()).toBe(plan.lastRefreshedAt);
    });
  });

  describe('lastRefreshedAt is updated on refresh', () => {
    it('updateCapabilitySet updates lastRefreshedAt to a new timestamp', async () => {
      const request: CreatePlanRequest = {
        planName: 'Refresh Test Plan',
        sourceType: 'cloudformation',
        labels: [],
      };

      const plan = await store.createPlan(request, makeCapabilitySet());
      const originalLastRefreshedAt = plan.lastRefreshedAt;

      // Wait a small amount to ensure timestamp differs
      await new Promise(resolve => setTimeout(resolve, 10));

      const updatedCapabilitySet = makeCapabilitySet({
        cfnResourceTypes: ['AWS::S3::Bucket', 'AWS::Lambda::Function', 'AWS::DynamoDB::Table'],
        apiOperations: ['s3:GetObject', 'dynamodb:PutItem'],
      });

      const updatedPlan = await store.updateCapabilitySet(plan.planId, updatedCapabilitySet);

      expect(updatedPlan.lastRefreshedAt).toBeDefined();
      expect(updatedPlan.lastRefreshedAt).not.toBe(originalLastRefreshedAt);
    });

    it('updateCapabilitySet includes lastRefreshedAt in the UpdateExpression', async () => {
      const request: CreatePlanRequest = {
        planName: 'Expression Test Plan',
        sourceType: 'terraform',
        labels: [],
      };

      const plan = await store.createPlan(request, makeCapabilitySet());

      // Clear mocks to capture the updateCapabilitySet call specifically
      mockSend.mockClear();

      // Re-setup mock but track the UpdateCommand
      let capturedUpdateExpression = '';
      let capturedExpressionNames: Record<string, string> = {};
      let capturedExpressionValues: Record<string, unknown> = {};

      mockSend.mockImplementation(
        (command: { input: Record<string, unknown>; constructor: { name: string } }) => {
          const commandName = command.constructor.name;

          if (commandName === 'GetCommand') {
            const input = command.input as { Key: Record<string, string> };
            const planId = input.Key.planId;
            const item = dynamoStore[planId];
            return Promise.resolve({ Item: item ?? undefined });
          }

          if (commandName === 'UpdateCommand') {
            const input = command.input as {
              Key: Record<string, string>;
              UpdateExpression: string;
              ExpressionAttributeNames: Record<string, string>;
              ExpressionAttributeValues: Record<string, unknown>;
              ConditionExpression?: string;
              ReturnValues?: string;
            };
            capturedUpdateExpression = input.UpdateExpression;
            capturedExpressionNames = input.ExpressionAttributeNames;
            capturedExpressionValues = input.ExpressionAttributeValues;

            const item = dynamoStore[input.Key.planId];
            return Promise.resolve({ Attributes: { ...item } });
          }

          return Promise.reject(new Error(`Unexpected command: ${commandName}`));
        },
      );

      await store.updateCapabilitySet(plan.planId, makeCapabilitySet());

      // Verify lastRefreshedAt is in the UpdateExpression
      expect(capturedUpdateExpression).toContain('#lastRefreshedAt');
      expect(capturedExpressionNames['#lastRefreshedAt']).toBe('lastRefreshedAt');
      expect(capturedExpressionValues[':lastRefreshedAt']).toBeDefined();
      expect(typeof capturedExpressionValues[':lastRefreshedAt']).toBe('string');

      // Verify it's a valid ISO timestamp
      const timestamp = capturedExpressionValues[':lastRefreshedAt'] as string;
      const parsed = new Date(timestamp);
      expect(parsed.toISOString()).toBe(timestamp);
    });
  });

  describe('repositoryUrl is persisted for GitHub plans', () => {
    it('createPlan with repositoryUrl persists it in the DynamoDB item', async () => {
      const request: CreatePlanRequest = {
        planName: 'GitHub Plan',
        sourceType: 'github',
        labels: [],
        repositoryUrl: 'https://github.com/aws/aws-cdk',
      };

      const plan = await store.createPlan(request, makeCapabilitySet());

      expect(plan.repositoryUrl).toBe('https://github.com/aws/aws-cdk');

      // Verify it's persisted in the store
      const retrieved = await store.getPlan(plan.planId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.repositoryUrl).toBe('https://github.com/aws/aws-cdk');
    });

    it('createPlan without repositoryUrl does NOT include it in the DynamoDB item', async () => {
      const request: CreatePlanRequest = {
        planName: 'CFN Plan No Repo',
        sourceType: 'cloudformation',
        labels: [],
      };

      const plan = await store.createPlan(request, makeCapabilitySet());

      expect(plan.repositoryUrl).toBeUndefined();

      // Verify it's not in the stored item
      const retrieved = await store.getPlan(plan.planId);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.repositoryUrl).toBeUndefined();
    });

    it('getPlan returns repositoryUrl field when present', async () => {
      const request: CreatePlanRequest = {
        planName: 'GitHub Repo Plan',
        sourceType: 'github',
        labels: [{ key: 'team', value: 'platform' }],
        repositoryUrl: 'https://github.com/owner/repo',
      };

      const plan = await store.createPlan(request, makeCapabilitySet());
      const retrieved = await store.getPlan(plan.planId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.repositoryUrl).toBe('https://github.com/owner/repo');
      expect(retrieved!.lastRefreshedAt).toBeDefined();
      expect(retrieved!.lastRefreshedAt).toBe(plan.createdAt);
    });

    it('getPlan returns lastRefreshedAt field when present', async () => {
      const request: CreatePlanRequest = {
        planName: 'Metadata Fields Plan',
        sourceType: 'terraform',
        labels: [],
      };

      const plan = await store.createPlan(request, makeCapabilitySet());
      const retrieved = await store.getPlan(plan.planId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.lastRefreshedAt).toBeDefined();
      expect(retrieved!.lastRefreshedAt).toBe(plan.createdAt);
    });
  });
});
