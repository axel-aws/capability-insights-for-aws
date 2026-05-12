import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { IAMClient, CreatePolicyVersionCommand, ListPolicyVersionsCommand, DeletePolicyVersionCommand } from '@aws-sdk/client-iam';
import { OrganizationsClient, UpdatePolicyCommand } from '@aws-sdk/client-organizations';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { mockClient } from 'aws-sdk-client-mock';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import type { ApiService } from '@capability-insights/shared/types/capability/api';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';

/**
 * Unit tests for Refresh Lambda handler.
 * Validates: Requirements 8.6, 11.1, 11.2, 11.3, 11.4, 11.5
 */

// Mock the AWS SDK clients
const dynamoMock = mockClient(DynamoDBDocumentClient);
const iamMock = mockClient(IAMClient);
const orgMock = mockClient(OrganizationsClient);
const cwMock = mockClient(CloudWatchClient);

// Mock the sleep function to avoid real delays in tests
vi.mock('./util/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// We need to mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Set environment variables before importing the handler
vi.stubEnv('CONFIG_TABLE_NAME', 'test-config-table');
vi.stubEnv('CATALOG_API_ENDPOINT', 'https://api.example.com/catalog');
vi.stubEnv('POLICY_CONFIG_ID', 'test-policy-id');
vi.stubEnv('POLICY_TYPE', 'IAM');
vi.stubEnv('POLICY_ARN', 'arn:aws:iam::123456789012:policy/test-policy');

// Import handler after env vars are set
const { handler } = await import('./refresh-lambda-main');

// Test fixtures
const mockPolicyConfig: PolicyConfiguration = {
  policyId: 'test-policy-id',
  policyName: 'Test Policy',
  description: 'A test policy',
  tags: [{ key: 'team', value: 'platform' }],
  regions: ['us-east-1', 'eu-west-1'],
  mode: 'intersection',
  policyType: 'IAM',
  exceptions: [{ action: 's3:GetObject', reason: 'Always needed', addedAt: '2024-01-01T00:00:00Z' }],
  refreshIntervalHours: 24,
  status: 'active',
  policyArn: 'arn:aws:iam::123456789012:policy/test-policy',
  lastActionCount: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockCatalogData: ApiService[] = [
  {
    sdkServiceName: 's3',
    sdkServiceFullName: 'Amazon S3',
    apis: [
      {
        apiName: 'GetObject',
        apiAction: 'GetObject',
        homepage: 'https://docs.aws.amazon.com/s3',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
        },
      },
      {
        apiName: 'PutObject',
        apiAction: 'PutObject',
        homepage: 'https://docs.aws.amazon.com/s3',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
        },
      },
    ],
  },
  {
    sdkServiceName: 'ec2',
    sdkServiceFullName: 'Amazon EC2',
    apis: [
      {
        apiName: 'DescribeInstances',
        apiAction: 'DescribeInstances',
        homepage: 'https://docs.aws.amazon.com/ec2',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
        },
      },
    ],
  },
];

describe('Refresh Lambda', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    dynamoMock.reset();
    iamMock.reset();
    orgMock.reset();
    cwMock.reset();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('successful refresh flow', () => {
    it('reads config, fetches catalog, computes allow-list, updates IAM policy, and emits success metric', async () => {
      // Mock DynamoDB GetCommand to return policy config
      dynamoMock.on(GetCommand).resolves({
        Item: mockPolicyConfig,
      });

      // Mock fetch to return catalog data
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCatalogData,
      });

      // Mock IAM ListPolicyVersions (fewer than 5 versions)
      iamMock.on(ListPolicyVersionsCommand).resolves({
        Versions: [
          { VersionId: 'v1', IsDefaultVersion: true, CreateDate: new Date('2024-01-01') },
        ],
      });

      // Mock IAM CreatePolicyVersion
      iamMock.on(CreatePolicyVersionCommand).resolves({});

      // Mock CloudWatch PutMetricData
      cwMock.on(PutMetricDataCommand).resolves({});

      // Mock DynamoDB UpdateCommand for metadata
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();
      // Advance timers to resolve any pending timeouts
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.policyUpdated).toBe(true);
      expect(result.retainedExistingPolicy).toBe(false);
      expect(result.actionCount).toBeGreaterThan(0);
      expect(result.error).toBeUndefined();

      // Verify DynamoDB was called to read config
      const getCommands = dynamoMock.commandCalls(GetCommand);
      expect(getCommands).toHaveLength(1);
      expect(getCommands[0].args[0].input).toEqual({
        TableName: 'test-config-table',
        Key: { policyId: 'test-policy-id' },
      });

      // Verify fetch was called with the catalog endpoint
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/catalog');

      // Verify IAM policy was updated
      const createVersionCalls = iamMock.commandCalls(CreatePolicyVersionCommand);
      expect(createVersionCalls).toHaveLength(1);
      expect(createVersionCalls[0].args[0].input.PolicyArn).toBe('arn:aws:iam::123456789012:policy/test-policy');
      expect(createVersionCalls[0].args[0].input.SetAsDefault).toBe(true);

      // Verify success metric was emitted
      const metricCalls = cwMock.commandCalls(PutMetricDataCommand);
      expect(metricCalls.length).toBeGreaterThanOrEqual(1);
      const successMetric = metricCalls.find(call =>
        call.args[0].input.MetricData?.[0]?.MetricName === 'PolicyRefreshSuccess'
      );
      expect(successMetric).toBeDefined();
      expect(successMetric!.args[0].input.MetricData?.[0]?.Value).toBe(1);

      // Verify config table was updated with success outcome
      const updateCalls = dynamoMock.commandCalls(UpdateCommand);
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('retry behavior on catalog API failure', () => {
    it('retries 3 times with exponential backoff when catalog API fails', async () => {
      // Mock DynamoDB GetCommand to return policy config
      dynamoMock.on(GetCommand).resolves({
        Item: mockPolicyConfig,
      });

      // Mock fetch to fail all attempts (initial + 3 retries = 4 calls)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // Mock CloudWatch and DynamoDB update for failure path
      cwMock.on(PutMetricDataCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();

      // Advance through all retry delays: 1s, 2s, 4s
      await vi.advanceTimersByTimeAsync(1000); // First retry delay
      await vi.advanceTimersByTimeAsync(2000); // Second retry delay
      await vi.advanceTimersByTimeAsync(4000); // Third retry delay
      await vi.runAllTimersAsync();

      const result = await resultPromise;

      // Should have failed after retries
      expect(result.success).toBe(false);
      expect(result.retainedExistingPolicy).toBe(true);
      expect(result.error).toContain('Failed to fetch catalog data after retries');

      // Verify fetch was called 4 times (initial + 3 retries)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('fail-open: existing policy retained when all retries fail', () => {
    it('retains existing policy and reports retained outcome when catalog API is unavailable', async () => {
      // Mock DynamoDB GetCommand to return policy config with existing action count
      dynamoMock.on(GetCommand).resolves({
        Item: { ...mockPolicyConfig, lastActionCount: 42 },
      });

      // Mock fetch to always fail
      mockFetch.mockRejectedValue(new Error('Network error'));

      // Mock CloudWatch and DynamoDB update
      cwMock.on(PutMetricDataCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Fail-open: policy not updated, existing retained
      expect(result.success).toBe(false);
      expect(result.policyUpdated).toBe(false);
      expect(result.retainedExistingPolicy).toBe(true);
      expect(result.actionCount).toBe(42); // Retains last known action count

      // IAM should NOT have been called
      const iamCalls = iamMock.commandCalls(CreatePolicyVersionCommand);
      expect(iamCalls).toHaveLength(0);
    });

    it('retains existing policy when IAM update fails after all retries', async () => {
      // Mock DynamoDB GetCommand to return policy config
      dynamoMock.on(GetCommand).resolves({
        Item: mockPolicyConfig,
      });

      // Mock fetch to succeed
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockCatalogData,
      });

      // Mock IAM to fail on all attempts
      iamMock.on(ListPolicyVersionsCommand).rejects(new Error('IAM service unavailable'));

      // Mock CloudWatch and DynamoDB update
      cwMock.on(PutMetricDataCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Fail-open: policy not updated
      expect(result.success).toBe(false);
      expect(result.policyUpdated).toBe(false);
      expect(result.retainedExistingPolicy).toBe(true);
      expect(result.error).toContain('Failed to update policy after retries');
    });
  });

  describe('CloudWatch metric emission', () => {
    it('emits PolicyRefreshSuccess metric on successful refresh', async () => {
      dynamoMock.on(GetCommand).resolves({ Item: mockPolicyConfig });
      mockFetch.mockResolvedValue({ ok: true, json: async () => mockCatalogData });
      iamMock.on(ListPolicyVersionsCommand).resolves({ Versions: [] });
      iamMock.on(CreatePolicyVersionCommand).resolves({});
      cwMock.on(PutMetricDataCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();
      await vi.runAllTimersAsync();
      await resultPromise;

      const metricCalls = cwMock.commandCalls(PutMetricDataCommand);
      const successMetric = metricCalls.find(call =>
        call.args[0].input.MetricData?.[0]?.MetricName === 'PolicyRefreshSuccess'
      );
      expect(successMetric).toBeDefined();
      expect(successMetric!.args[0].input.Namespace).toBe('PolicyEnforcer');
      expect(successMetric!.args[0].input.MetricData?.[0]?.Value).toBe(1);
      expect(successMetric!.args[0].input.MetricData?.[0]?.Unit).toBe('Count');
      expect(successMetric!.args[0].input.MetricData?.[0]?.Dimensions).toEqual(
        expect.arrayContaining([
          { Name: 'PolicyId', Value: 'test-policy-id' },
          { Name: 'PolicyType', Value: 'IAM' },
        ])
      );
    });

    it('emits PolicyUpdateFailure metric when catalog API fails', async () => {
      dynamoMock.on(GetCommand).resolves({ Item: mockPolicyConfig });
      mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' });
      cwMock.on(PutMetricDataCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();
      await vi.runAllTimersAsync();
      await resultPromise;

      const metricCalls = cwMock.commandCalls(PutMetricDataCommand);
      const failureMetric = metricCalls.find(call =>
        call.args[0].input.MetricData?.[0]?.MetricName === 'PolicyUpdateFailure'
      );
      expect(failureMetric).toBeDefined();
      expect(failureMetric!.args[0].input.MetricData?.[0]?.Value).toBe(1);
    });

    it('emits PolicyUpdateFailure metric when IAM update fails', async () => {
      dynamoMock.on(GetCommand).resolves({ Item: mockPolicyConfig });
      mockFetch.mockResolvedValue({ ok: true, json: async () => mockCatalogData });
      iamMock.on(ListPolicyVersionsCommand).rejects(new Error('Throttled'));
      cwMock.on(PutMetricDataCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();
      await vi.runAllTimersAsync();
      await resultPromise;

      const metricCalls = cwMock.commandCalls(PutMetricDataCommand);
      const failureMetric = metricCalls.find(call =>
        call.args[0].input.MetricData?.[0]?.MetricName === 'PolicyUpdateFailure'
      );
      expect(failureMetric).toBeDefined();
      expect(failureMetric!.args[0].input.MetricData?.[0]?.Value).toBe(1);
    });
  });

  describe('IAM update retry on transient failure', () => {
    it('retries IAM update and succeeds on second attempt', async () => {
      dynamoMock.on(GetCommand).resolves({ Item: mockPolicyConfig });
      mockFetch.mockResolvedValue({ ok: true, json: async () => mockCatalogData });

      // First call to ListPolicyVersions fails, second succeeds
      let listCallCount = 0;
      iamMock.on(ListPolicyVersionsCommand).callsFake(() => {
        listCallCount++;
        if (listCallCount === 1) {
          throw new Error('Transient IAM error');
        }
        return { Versions: [] };
      });

      iamMock.on(CreatePolicyVersionCommand).resolves({});
      cwMock.on(PutMetricDataCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Should succeed after retry
      expect(result.success).toBe(true);
      expect(result.policyUpdated).toBe(true);
      expect(result.retainedExistingPolicy).toBe(false);

      // ListPolicyVersions should have been called at least twice (first fail + retry success)
      expect(listCallCount).toBeGreaterThanOrEqual(2);
    });

    it('handles IAM 5-version limit by deleting oldest non-default version', async () => {
      dynamoMock.on(GetCommand).resolves({ Item: mockPolicyConfig });
      mockFetch.mockResolvedValue({ ok: true, json: async () => mockCatalogData });

      // Return 5 versions (at the limit)
      iamMock.on(ListPolicyVersionsCommand).resolves({
        Versions: [
          { VersionId: 'v1', IsDefaultVersion: false, CreateDate: new Date('2024-01-01') },
          { VersionId: 'v2', IsDefaultVersion: false, CreateDate: new Date('2024-01-02') },
          { VersionId: 'v3', IsDefaultVersion: false, CreateDate: new Date('2024-01-03') },
          { VersionId: 'v4', IsDefaultVersion: false, CreateDate: new Date('2024-01-04') },
          { VersionId: 'v5', IsDefaultVersion: true, CreateDate: new Date('2024-01-05') },
        ],
      });

      iamMock.on(DeletePolicyVersionCommand).resolves({});
      iamMock.on(CreatePolicyVersionCommand).resolves({});
      cwMock.on(PutMetricDataCommand).resolves({});
      dynamoMock.on(UpdateCommand).resolves({});

      const resultPromise = handler();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);

      // Verify oldest non-default version was deleted
      const deleteCalls = iamMock.commandCalls(DeletePolicyVersionCommand);
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0].args[0].input.VersionId).toBe('v1');
      expect(deleteCalls[0].args[0].input.PolicyArn).toBe('arn:aws:iam::123456789012:policy/test-policy');
    });
  });
});
