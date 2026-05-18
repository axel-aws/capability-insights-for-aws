import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { PlanStore } from './plan-store';
import type {
  CreatePlanRequest,
  CapabilitySet,
  PlanConfiguration,
} from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';

/**
 * Feature: infrastructure-planning, Property 7: Plan name uniqueness
 *
 * For any two create-plan requests with the same planName, the second request
 * SHALL fail with a name conflict error, and the first plan SHALL remain unchanged.
 *
 * Validates: Requirements 4.1, 4.5
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
  const actual = await vi.importActual<typeof import('@aws-sdk/client-dynamodb')>('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: vi.fn().mockImplementation(() => ({})),
  };
});

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>('@aws-sdk/lib-dynamodb');
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
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
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
 * Supports QueryCommand (for GSI name lookup), PutCommand, GetCommand.
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

  mockSend.mockImplementation((command: { input: Record<string, unknown>; constructor: { name: string } }) => {
    const commandName = command.constructor.name;

    if (commandName === 'QueryCommand') {
      // Simulate GSI query on planName
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

      // Simulate ConditionExpression: attribute_not_exists(planId)
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

    if (commandName === 'ScanCommand') {
      return Promise.resolve({ Items: Object.values(dynamoStore) });
    }

    return Promise.reject(new Error(`Unexpected command: ${commandName}`));
  });
}

// --- Generators ---

/** Generator for valid plan names: non-empty strings without leading/trailing whitespace. */
const planNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .map(s => s.trim())
  .filter(s => s.length > 0);

/** Generator for valid source types. */
const sourceTypeArb = fc.constantFrom('cloudformation' as const, 'terraform' as const, 'github' as const);

/** Generator for valid plan labels. */
const planLabelArb = fc.record({
  key: fc.string({ minLength: 1, maxLength: 30 }).map(s => s.trim()).filter(s => s.length > 0),
  value: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.trim()).filter(s => s.length > 0),
});

/** Generator for a minimal valid CapabilitySet. */
const capabilitySetArb: fc.Arbitrary<CapabilitySet> = fc.record({
  cfnResourceTypes: fc.uniqueArray(
    fc.tuple(
      fc.constantFrom('S3', 'Lambda', 'DynamoDB', 'EC2', 'IAM', 'SNS', 'SQS', 'ECS', 'RDS', 'CloudFront'),
      fc.constantFrom('Bucket', 'Function', 'Table', 'Instance', 'Role', 'Topic', 'Queue', 'Cluster', 'DBInstance', 'Distribution'),
    ).map(([svc, res]) => `AWS::${svc}::${res}`),
    { minLength: 0, maxLength: 5 },
  ),
  terraformResourceTypes: fc.array(fc.constant(''), { maxLength: 0 }),
  apiOperations: fc.array(fc.constant(''), { maxLength: 0 }),
  serviceNames: fc.array(fc.constant(''), { maxLength: 0 }),
  terraformToCfnMapping: fc.constant({}),
});

// --- Property Tests ---

describe('Feature: infrastructure-planning, Property 7: Plan name uniqueness', () => {
  let store: PlanStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setupInMemoryMock();
    store = new PlanStore('test-plan-table', 'test-bucket');
  });

  it('creating two plans with the same name results in a conflict error for the second', async () => {
    await fc.assert(
      fc.asyncProperty(
        planNameArb,
        sourceTypeArb,
        fc.array(planLabelArb, { minLength: 0, maxLength: 3 }),
        capabilitySetArb,
        async (planName, sourceType, labels, capabilitySet) => {
          // Reset stores for each iteration
          dynamoStore = {};
          s3Store = {};

          const request: CreatePlanRequest = {
            planName,
            sourceType,
            labels,
          };

          // First creation should succeed
          const firstPlan = await store.createPlan(request, capabilitySet);
          expect(firstPlan.planName).toBe(planName);
          expect(firstPlan.sourceType).toBe(sourceType);
          expect(firstPlan.status).toBe('ready');

          // Second creation with the same name should fail with conflict error
          await expect(store.createPlan(request, capabilitySet)).rejects.toThrow(
            `Plan with name "${planName}" already exists`,
          );

          // Verify the first plan remains unchanged in the store
          const storedPlan = await store.getPlan(firstPlan.planId);
          expect(storedPlan).not.toBeNull();
          expect(storedPlan!.planName).toBe(planName);
          expect(storedPlan!.sourceType).toBe(sourceType);
          expect(storedPlan!.planId).toBe(firstPlan.planId);
          expect(storedPlan!.createdAt).toBe(firstPlan.createdAt);
          expect(storedPlan!.updatedAt).toBe(firstPlan.updatedAt);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('plans with different names can coexist without conflict', async () => {
    await fc.assert(
      fc.asyncProperty(
        planNameArb,
        planNameArb.filter(n => n.length > 0),
        sourceTypeArb,
        capabilitySetArb,
        async (name1, name2Suffix, sourceType, capabilitySet) => {
          // Ensure names are different by appending a suffix
          const planName1 = name1;
          const planName2 = name1 + '_' + name2Suffix;

          // Reset stores for each iteration
          dynamoStore = {};
          s3Store = {};

          const request1: CreatePlanRequest = { planName: planName1, sourceType };
          const request2: CreatePlanRequest = { planName: planName2, sourceType };

          // Both creations should succeed since names are different
          const plan1 = await store.createPlan(request1, capabilitySet);
          const plan2 = await store.createPlan(request2, capabilitySet);

          expect(plan1.planName).toBe(planName1);
          expect(plan2.planName).toBe(planName2);
          expect(plan1.planId).not.toBe(plan2.planId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
