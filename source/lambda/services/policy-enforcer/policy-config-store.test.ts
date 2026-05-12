import { describe, it, expect, vi, beforeEach } from 'vitest';
import { serializeToItem, deserializeFromItem, PolicyConfigStore } from './policy-config-store';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

/**
 * Unit tests for policy-config-store.
 * Validates: Requirements 7.4, 7.6, 7a.4
 */

// --- Mock DynamoDB DocumentClient ---
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

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
    ScanCommand: actual.ScanCommand,
    UpdateCommand: actual.UpdateCommand,
    DeleteCommand: actual.DeleteCommand,
  };
});

// --- Test Fixtures ---

const SAMPLE_CONFIG: PolicyConfiguration = {
  policyId: '550e8400-e29b-41d4-a716-446655440000',
  policyName: 'Payment Service - US/EU',
  description: 'Restricts capabilities to US and EU regions for payment workloads',
  tags: [
    { key: 'team', value: 'payments' },
    { key: 'environment', value: 'production' },
  ],
  regions: ['us-east-1', 'eu-west-1'],
  mode: 'intersection',
  policyType: 'IAM',
  exceptions: [
    { action: 's3:GetObject', reason: 'Cross-region replication', addedAt: '2024-01-15T10:00:00Z' },
  ],
  refreshIntervalHours: 24,
  status: 'active',
  policyArn: 'arn:aws:iam::123456789012:policy/PaymentService',
  additionalPolicyArns: undefined,
  lastRefreshTime: '2024-06-01T00:00:00Z',
  lastRefreshOutcome: 'success',
  lastActionCount: 142,
  stackId: undefined,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-06-01T00:00:00Z',
};

const MINIMAL_CONFIG: PolicyConfiguration = {
  policyId: '660e8400-e29b-41d4-a716-446655440001',
  policyName: 'Minimal Policy',
  tags: [],
  regions: ['us-west-2'],
  mode: 'union',
  policyType: 'SCP',
  exceptions: [],
  refreshIntervalHours: 12,
  status: 'pending',
  createdAt: '2024-03-01T00:00:00Z',
  updatedAt: '2024-03-01T00:00:00Z',
};

describe('serializeToItem / deserializeFromItem', () => {
  it('round-trips a full configuration with all optional fields present', () => {
    const item = serializeToItem(SAMPLE_CONFIG);
    const result = deserializeFromItem(item);
    expect(result).toEqual(SAMPLE_CONFIG);
  });

  it('round-trips a minimal configuration with no optional fields', () => {
    const item = serializeToItem(MINIMAL_CONFIG);
    const result = deserializeFromItem(item);
    expect(result).toEqual(MINIMAL_CONFIG);
  });

  it('preserves tags array structure', () => {
    const item = serializeToItem(SAMPLE_CONFIG);
    const result = deserializeFromItem(item);
    expect(result.tags).toHaveLength(2);
    expect(result.tags[0]).toEqual({ key: 'team', value: 'payments' });
    expect(result.tags[1]).toEqual({ key: 'environment', value: 'production' });
  });

  it('preserves exceptions array with reason field', () => {
    const item = serializeToItem(SAMPLE_CONFIG);
    const result = deserializeFromItem(item);
    expect(result.exceptions).toHaveLength(1);
    expect(result.exceptions[0].action).toBe('s3:GetObject');
    expect(result.exceptions[0].reason).toBe('Cross-region replication');
    expect(result.exceptions[0].addedAt).toBe('2024-01-15T10:00:00Z');
  });

  it('preserves regions array order', () => {
    const config: PolicyConfiguration = {
      ...MINIMAL_CONFIG,
      regions: ['ap-southeast-1', 'us-east-1', 'eu-central-1'],
    };
    const item = serializeToItem(config);
    const result = deserializeFromItem(item);
    expect(result.regions).toEqual(['ap-southeast-1', 'us-east-1', 'eu-central-1']);
  });
});

describe('PolicyConfigStore', () => {
  let store: PolicyConfigStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PolicyConfigStore('test-policy-table');
  });

  describe('createPolicy', () => {
    it('creates a policy and returns the configuration with generated ID', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await store.createPolicy({
        policyName: 'New Policy',
        regions: ['us-east-1'],
        mode: 'intersection',
        policyType: 'IAM',
      });

      expect(result.policyName).toBe('New Policy');
      expect(result.regions).toEqual(['us-east-1']);
      expect(result.mode).toBe('intersection');
      expect(result.policyType).toBe('IAM');
      expect(result.status).toBe('pending');
      expect(result.policyId).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.tags).toEqual([]);
      expect(result.exceptions).toEqual([]);
      expect(result.refreshIntervalHours).toBe(24);
    });

    it('throws an error when policy name already exists (unique name constraint)', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      await expect(
        store.createPolicy({
          policyName: 'Duplicate Name',
          regions: ['us-east-1'],
          mode: 'union',
          policyType: 'IAM',
        }),
      ).rejects.toThrow('Policy with name "Duplicate Name" already exists');
    });

    it('throws a generic error on unexpected DynamoDB failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Service unavailable'));

      await expect(
        store.createPolicy({
          policyName: 'Test',
          regions: ['us-east-1'],
          mode: 'intersection',
          policyType: 'IAM',
        }),
      ).rejects.toThrow('Failed to create policy');
    });
  });

  describe('getPolicy', () => {
    it('returns the policy when found', async () => {
      mockSend.mockResolvedValueOnce({ Item: serializeToItem(SAMPLE_CONFIG) });

      const result = await store.getPolicy(SAMPLE_CONFIG.policyId);

      expect(result).toEqual(SAMPLE_CONFIG);
    });

    it('returns null when policy is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await store.getPolicy('nonexistent-id');

      expect(result).toBeNull();
    });

    it('throws an error on DynamoDB failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Throttled'));

      await expect(store.getPolicy('some-id')).rejects.toThrow('Failed to get policy');
    });
  });

  describe('listPolicies', () => {
    const policies: PolicyConfiguration[] = [
      {
        ...SAMPLE_CONFIG,
        policyId: 'id-1',
        policyName: 'Payment Service - US/EU',
        description: 'Payment workload policy',
        tags: [
          { key: 'team', value: 'payments' },
          { key: 'environment', value: 'production' },
        ],
        status: 'active',
      },
      {
        ...MINIMAL_CONFIG,
        policyId: 'id-2',
        policyName: 'Analytics Pipeline',
        description: 'Analytics data processing',
        tags: [
          { key: 'team', value: 'analytics' },
          { key: 'environment', value: 'staging' },
        ],
        status: 'pending',
      },
      {
        ...SAMPLE_CONFIG,
        policyId: 'id-3',
        policyName: 'Order Service - Global',
        description: 'Order processing service',
        tags: [
          { key: 'team', value: 'payments' },
          { key: 'environment', value: 'production' },
        ],
        status: 'error',
      },
    ];

    it('returns all policies when no filters are applied', async () => {
      mockSend.mockResolvedValueOnce({ Items: policies.map(p => serializeToItem(p)) });

      const result = await store.listPolicies();

      expect(result).toHaveLength(3);
    });

    it('filters by status', async () => {
      // When status filter is applied, DynamoDB FilterExpression handles it,
      // but the mock returns all items to test the flow
      mockSend.mockResolvedValueOnce({
        Items: policies.filter(p => p.status === 'active').map(p => serializeToItem(p)),
      });

      const result = await store.listPolicies({ status: 'active' });

      expect(result).toHaveLength(1);
      expect(result[0].policyName).toBe('Payment Service - US/EU');
    });

    it('filters by tag key and value', async () => {
      mockSend.mockResolvedValueOnce({ Items: policies.map(p => serializeToItem(p)) });

      const result = await store.listPolicies({ tagKey: 'team', tagValue: 'analytics' });

      expect(result).toHaveLength(1);
      expect(result[0].policyName).toBe('Analytics Pipeline');
    });

    it('filters by tag key and value matching multiple policies', async () => {
      mockSend.mockResolvedValueOnce({ Items: policies.map(p => serializeToItem(p)) });

      const result = await store.listPolicies({ tagKey: 'team', tagValue: 'payments' });

      expect(result).toHaveLength(2);
      expect(result.map(p => p.policyName)).toContain('Payment Service - US/EU');
      expect(result.map(p => p.policyName)).toContain('Order Service - Global');
    });

    it('filters by search term matching policy name (case-insensitive)', async () => {
      mockSend.mockResolvedValueOnce({ Items: policies.map(p => serializeToItem(p)) });

      const result = await store.listPolicies({ search: 'payment' });

      expect(result).toHaveLength(1);
      expect(result[0].policyName).toBe('Payment Service - US/EU');
    });

    it('filters by search term matching description (case-insensitive)', async () => {
      mockSend.mockResolvedValueOnce({ Items: policies.map(p => serializeToItem(p)) });

      const result = await store.listPolicies({ search: 'data processing' });

      expect(result).toHaveLength(1);
      expect(result[0].policyName).toBe('Analytics Pipeline');
    });

    it('returns empty array when search term matches nothing', async () => {
      mockSend.mockResolvedValueOnce({ Items: policies.map(p => serializeToItem(p)) });

      const result = await store.listPolicies({ search: 'nonexistent' });

      expect(result).toHaveLength(0);
    });

    it('returns empty array when tag filter matches nothing', async () => {
      mockSend.mockResolvedValueOnce({ Items: policies.map(p => serializeToItem(p)) });

      const result = await store.listPolicies({ tagKey: 'team', tagValue: 'unknown-team' });

      expect(result).toHaveLength(0);
    });

    it('handles empty Items from DynamoDB', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await store.listPolicies();

      expect(result).toEqual([]);
    });

    it('handles undefined Items from DynamoDB', async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const result = await store.listPolicies();

      expect(result).toEqual([]);
    });

    it('throws an error on DynamoDB failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Internal error'));

      await expect(store.listPolicies()).rejects.toThrow('Failed to list policies');
    });
  });

  describe('updatePolicy', () => {
    it('updates fields and returns the updated policy', async () => {
      const updatedConfig = { ...SAMPLE_CONFIG, status: 'error' as const, updatedAt: '2024-07-01T00:00:00Z' };
      mockSend.mockResolvedValueOnce({ Attributes: serializeToItem(updatedConfig) });

      const result = await store.updatePolicy(SAMPLE_CONFIG.policyId, { status: 'error' });

      expect(result.status).toBe('error');
    });

    it('throws when policy does not exist', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      await expect(store.updatePolicy('nonexistent-id', { status: 'active' })).rejects.toThrow(
        'Policy "nonexistent-id" not found',
      );
    });

    it('still updates updatedAt even when no other fields are provided', async () => {
      const updatedConfig = { ...SAMPLE_CONFIG, updatedAt: '2024-07-01T00:00:00Z' };
      mockSend.mockResolvedValueOnce({ Attributes: serializeToItem(updatedConfig) });

      const result = await store.updatePolicy(SAMPLE_CONFIG.policyId, {});

      expect(result.updatedAt).toBe('2024-07-01T00:00:00Z');
    });
  });

  describe('deletePolicy', () => {
    it('deletes a policy successfully', async () => {
      mockSend.mockResolvedValueOnce({});

      await expect(store.deletePolicy(SAMPLE_CONFIG.policyId)).resolves.toBeUndefined();
    });

    it('throws when policy does not exist', async () => {
      const error = new Error('ConditionalCheckFailedException');
      error.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      await expect(store.deletePolicy('nonexistent-id')).rejects.toThrow('Policy "nonexistent-id" not found');
    });

    it('throws on unexpected DynamoDB failure', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access denied'));

      await expect(store.deletePolicy('some-id')).rejects.toThrow('Failed to delete policy');
    });
  });
});
