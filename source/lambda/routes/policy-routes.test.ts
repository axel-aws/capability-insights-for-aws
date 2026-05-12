import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { StatusCode } from '../constants/status-codes';

// --- Mock PolicyConfigStore ---
const mockCreatePolicy = vi.fn();
const mockGetPolicy = vi.fn();
const mockListPolicies = vi.fn();
const mockUpdatePolicy = vi.fn();
const mockDeletePolicy = vi.fn();

vi.mock('../services/policy-enforcer/policy-config-store', () => ({
  PolicyConfigStore: vi.fn().mockImplementation(() => ({
    createPolicy: mockCreatePolicy,
    getPolicy: mockGetPolicy,
    listPolicies: mockListPolicies,
    updatePolicy: mockUpdatePolicy,
    deletePolicy: mockDeletePolicy,
  })),
}));

// --- Mock S3BucketClient ---
const mockGetObject = vi.fn();

vi.mock('../services/s3-client', () => ({
  S3BucketClient: vi.fn().mockImplementation(() => ({
    getObject: mockGetObject,
  })),
}));

// --- Mock logger ---
vi.mock('../util/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// --- Mock environment ---
vi.mock('../constants/environment', () => ({
  EnvironmentKey: {
    POLICY_TABLE_NAME: 'POLICY_TABLE_NAME',
    WEBSITE_BUCKET_NAME: 'WEBSITE_BUCKET_NAME',
  },
  getEnv: vi.fn().mockReturnValue('mock-value'),
}));

import {
  createPolicyRoute,
  listPoliciesRoute,
  getPolicyRoute,
  updatePolicyRoute,
  deletePolicyRoute,
  previewPolicyRoute,
} from './policy-routes';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/policies',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
    requestContext: {
      accountId: '123456789012',
      apiId: 'test',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
      path: '/policies',
      stage: 'prod',
      requestId: 'test-id',
      requestTimeEpoch: 0,
      resourceId: '',
      resourcePath: '',
    },
    ...overrides,
  };
}

const validCreateRequest = {
  policyName: 'Test Policy',
  regions: ['us-east-1', 'eu-west-1'],
  mode: 'intersection' as const,
  policyType: 'IAM' as const,
  description: 'A test policy',
  tags: [{ key: 'team', value: 'platform' }],
  exceptions: [{ action: 's3:GetObject', reason: 'needed', addedAt: '2024-01-01T00:00:00Z' }],
  refreshIntervalHours: 12,
};

const mockPolicyConfig = {
  policyId: 'policy-123',
  policyName: 'Test Policy',
  description: 'A test policy',
  tags: [{ key: 'team', value: 'platform' }],
  regions: ['us-east-1', 'eu-west-1'],
  mode: 'intersection' as const,
  policyType: 'IAM' as const,
  exceptions: [{ action: 's3:GetObject', reason: 'needed', addedAt: '2024-01-01T00:00:00Z' }],
  refreshIntervalHours: 12,
  status: 'pending' as const,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('policy-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /policies (createPolicyRoute)', () => {
    it('returns 201 with valid request', async () => {
      mockCreatePolicy.mockResolvedValueOnce(mockPolicyConfig);

      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify(validCreateRequest),
      });

      const result = await createPolicyRoute(event);

      expect(result.statusCode).toBe(StatusCode.CREATED);
      const body = JSON.parse(result.body);
      expect(body.policy).toEqual(mockPolicyConfig);
      expect(mockCreatePolicy).toHaveBeenCalledWith(validCreateRequest);
    });

    it('returns 400 when body is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: null,
      });

      const result = await createPolicyRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('Request body is required');
    });

    it('returns 400 when policyName is missing', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          regions: ['us-east-1'],
          mode: 'intersection',
          policyType: 'IAM',
        }),
      });

      const result = await createPolicyRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('policyName');
    });

    it('returns 400 when regions is empty', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          policyName: 'Test',
          regions: [],
          mode: 'intersection',
          policyType: 'IAM',
        }),
      });

      const result = await createPolicyRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('regions');
    });

    it('returns 400 when mode is invalid', async () => {
      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify({
          policyName: 'Test',
          regions: ['us-east-1'],
          mode: 'invalid',
          policyType: 'IAM',
        }),
      });

      const result = await createPolicyRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('mode');
    });

    it('returns 409 when policy name already exists', async () => {
      mockCreatePolicy.mockRejectedValueOnce(new Error('Policy with name "Test" already exists'));

      const event = makeEvent({
        httpMethod: 'POST',
        body: JSON.stringify(validCreateRequest),
      });

      const result = await createPolicyRoute(event);

      expect(result.statusCode).toBe(StatusCode.CONFLICT);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Conflict');
    });
  });

  describe('GET /policies (listPoliciesRoute)', () => {
    it('returns 200 with list of policies', async () => {
      mockListPolicies.mockResolvedValueOnce([mockPolicyConfig]);

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/policies',
      });

      const result = await listPoliciesRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.policies).toEqual([mockPolicyConfig]);
      expect(mockListPolicies).toHaveBeenCalledWith({});
    });

    it('passes query parameters as filters', async () => {
      mockListPolicies.mockResolvedValueOnce([]);

      const event = makeEvent({
        httpMethod: 'GET',
        path: '/policies',
        queryStringParameters: {
          tagKey: 'team',
          tagValue: 'platform',
          status: 'active',
          search: 'test',
        },
      });

      const result = await listPoliciesRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      expect(mockListPolicies).toHaveBeenCalledWith({
        tagKey: 'team',
        tagValue: 'platform',
        status: 'active',
        search: 'test',
      });
    });

    it('returns 500 when store throws', async () => {
      mockListPolicies.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = makeEvent({ httpMethod: 'GET', path: '/policies' });

      const result = await listPoliciesRoute(event);

      expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
    });
  });

  describe('GET /policies/:policyId (getPolicyRoute)', () => {
    it('returns 200 with policy when found', async () => {
      mockGetPolicy.mockResolvedValueOnce(mockPolicyConfig);

      const event = makeEvent({ path: '/policies/policy-123' });
      const result = await getPolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.policy).toEqual(mockPolicyConfig);
    });

    it('returns 404 when policy not found', async () => {
      mockGetPolicy.mockResolvedValueOnce(null);

      const event = makeEvent({ path: '/policies/unknown-id' });
      const result = await getPolicyRoute(event, { policyId: 'unknown-id' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('NotFound');
      expect(body.message).toContain('unknown-id');
    });
  });

  describe('PUT /policies/:policyId (updatePolicyRoute)', () => {
    it('returns 200 with updated policy', async () => {
      const updatedPolicy = { ...mockPolicyConfig, policyName: 'Updated Policy' };
      mockUpdatePolicy.mockResolvedValueOnce(updatedPolicy);

      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/policies/policy-123',
        body: JSON.stringify({ policyName: 'Updated Policy' }),
      });

      const result = await updatePolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.policy.policyName).toBe('Updated Policy');
    });

    it('returns 400 when body is missing', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/policies/policy-123',
        body: null,
      });

      const result = await updatePolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
    });

    it('returns 400 when update contains invalid regions', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/policies/policy-123',
        body: JSON.stringify({ regions: [] }),
      });

      const result = await updatePolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('regions');
    });

    it('returns 404 when policy does not exist', async () => {
      mockUpdatePolicy.mockRejectedValueOnce(new Error('Policy "unknown-id" not found'));

      const event = makeEvent({
        httpMethod: 'PUT',
        path: '/policies/unknown-id',
        body: JSON.stringify({ policyName: 'Updated' }),
      });

      const result = await updatePolicyRoute(event, { policyId: 'unknown-id' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('NotFound');
    });
  });

  describe('DELETE /policies/:policyId (deletePolicyRoute)', () => {
    it('returns 200 when policy is deleted', async () => {
      mockGetPolicy.mockResolvedValueOnce(mockPolicyConfig);
      mockDeletePolicy.mockResolvedValueOnce(undefined);

      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/policies/policy-123',
      });

      const result = await deletePolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('policy-123');
      expect(body.message).toContain('deleted');
    });

    it('returns 404 when policy does not exist', async () => {
      mockDeletePolicy.mockRejectedValueOnce(new Error('Policy "unknown-id" not found'));

      const event = makeEvent({
        httpMethod: 'DELETE',
        path: '/policies/unknown-id',
      });

      const result = await deletePolicyRoute(event, { policyId: 'unknown-id' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('NotFound');
    });
  });

  describe('GET /policies/:policyId/preview (previewPolicyRoute)', () => {
    const mockCatalogData = JSON.stringify([
      {
        sdkServiceName: 's3',
        sdkServiceFullName: 'Amazon S3',
        apis: [
          {
            apiName: 'GetObject',
            apiAction: 'GetObject',
            regionalAvailability: {
              'us-east-1': 'Available',
              'eu-west-1': 'Available',
            },
          },
          {
            apiName: 'PutObject',
            apiAction: 'PutObject',
            regionalAvailability: {
              'us-east-1': 'Available',
              'eu-west-1': 'Not Available',
            },
          },
        ],
      },
    ]);

    it('returns 200 with computed allow-list preview', async () => {
      mockGetPolicy.mockResolvedValueOnce(mockPolicyConfig);
      mockGetObject.mockResolvedValueOnce(mockCatalogData);

      const event = makeEvent({ path: '/policies/policy-123/preview' });
      const result = await previewPolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.actions).toBeDefined();
      expect(Array.isArray(body.actions)).toBe(true);
      expect(body.actionCount).toBeGreaterThan(0);
      expect(typeof body.excludedCount).toBe('number');
      expect(typeof body.exceptionCount).toBe('number');
      expect(typeof body.estimatedPolicySize).toBe('number');
      expect(typeof body.splitRequired).toBe('boolean');
    });

    it('returns 404 when policy not found', async () => {
      mockGetPolicy.mockResolvedValueOnce(null);

      const event = makeEvent({ path: '/policies/unknown-id/preview' });
      const result = await previewPolicyRoute(event, { policyId: 'unknown-id' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('NotFound');
    });

    it('returns 503 when catalog data is unavailable', async () => {
      mockGetPolicy.mockResolvedValueOnce(mockPolicyConfig);
      mockGetObject.mockRejectedValueOnce(new Error('S3 access denied'));

      const event = makeEvent({ path: '/policies/policy-123/preview' });
      const result = await previewPolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.SERVICE_UNAVAILABLE);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ServiceUnavailable');
    });
  });
});
