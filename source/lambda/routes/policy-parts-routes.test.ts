import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { StatusCode } from '../constants/status-codes';

// --- Mock PolicyConfigStore ---
const mockGetPolicy = vi.fn();
const mockUpdatePolicy = vi.fn();
const mockDeletePolicy = vi.fn();

vi.mock('../services/policy-enforcer/policy-config-store', () => ({
  PolicyConfigStore: vi.fn().mockImplementation(() => ({
    getPolicy: mockGetPolicy,
    updatePolicy: mockUpdatePolicy,
    deletePolicy: mockDeletePolicy,
  })),
}));

// --- Mock Lambda client ---
const { mockSend } = vi.hoisted(() => {
  return { mockSend: vi.fn() };
});

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: vi.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  InvokeCommand: vi.fn().mockImplementation((input) => input),
}));

// --- Mock logger ---
vi.mock('../util/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// --- Mock environment ---
vi.mock('../constants/environment', () => ({
  EnvironmentKey: {
    POLICY_TABLE_NAME: 'POLICY_TABLE_NAME',
    IAM_HELPER_LAMBDA_NAME: 'IAM_HELPER_LAMBDA_NAME',
  },
  getEnv: vi.fn().mockReturnValue('mock-value'),
}));

import {
  getPolicyPartsRoute,
  getPolicyPartDetailRoute,
  deletePolicyPartRoute,
  cascadingDeletePolicyRoute,
} from './policy-parts-routes';

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

const samplePolicyDocument = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Deny',
      NotAction: ['s3:*', 'ec2:*', 'iam:*'],
      Resource: '*',
    },
  ],
});

const sampleSpecificPolicyDocument = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Deny',
      Action: ['s3:GetObject', 's3:PutObject', 'ec2:RunInstances'],
      Resource: '*',
    },
  ],
});

function mockIAMHelperResponse(response: Record<string, unknown>) {
  mockSend.mockResolvedValueOnce({
    Payload: Buffer.from(JSON.stringify(response)),
  });
}

const basePolicyConfig = {
  policyId: 'policy-123',
  policyName: 'Test Policy',
  description: 'A test policy',
  tags: [],
  regions: ['us-east-1'],
  mode: 'intersection' as const,
  policyType: 'IAM' as const,
  exceptions: [],
  refreshIntervalHours: 12,
  status: 'active' as const,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('policy-parts-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /policies/:policyId/parts (getPolicyPartsRoute)', () => {
    it('returns 404 when policy not found', async () => {
      mockGetPolicy.mockResolvedValueOnce(null);

      const event = makeEvent({ path: '/policies/unknown/parts' });
      const result = await getPolicyPartsRoute(event, { policyId: 'unknown' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('NotFound');
    });

    it('returns empty parts when no ARNs exist (0 parts)', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: undefined,
        additionalPolicyArns: undefined,
      });

      const event = makeEvent({ path: '/policies/policy-123/parts' });
      const result = await getPolicyPartsRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.parts).toEqual([]);
      expect(body.totalParts).toBe(0);
      expect(body.combinedSize).toBe(0);
    });

    it('returns 1 part when only primary ARN exists', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
      });

      mockIAMHelperResponse({
        success: true,
        policyDocument: samplePolicyDocument,
      });

      const event = makeEvent({ path: '/policies/policy-123/parts' });
      const result = await getPolicyPartsRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.totalParts).toBe(1);
      expect(body.parts).toHaveLength(1);
      expect(body.parts[0].partIndex).toBe(0);
      expect(body.parts[0].partType).toBe('blanket-deny');
      expect(body.parts[0].arn).toBe('arn:aws:iam::123456789012:policy/TestPolicy');
      expect(body.parts[0].documentSize).toBe(samplePolicyDocument.length);
      expect(body.parts[0].statementItemCount).toBe(3); // 3 NotAction items
      expect(body.combinedSize).toBe(samplePolicyDocument.length);
    });

    it('returns multiple parts with correct types', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy-Part1',
        additionalPolicyArns: ['arn:aws:iam::123456789012:policy/TestPolicy-Part2'],
      });

      // First ARN response (blanket-deny)
      mockIAMHelperResponse({
        success: true,
        policyDocument: samplePolicyDocument,
      });

      // Second ARN response (specific-api-deny)
      mockIAMHelperResponse({
        success: true,
        policyDocument: sampleSpecificPolicyDocument,
      });

      const event = makeEvent({ path: '/policies/policy-123/parts' });
      const result = await getPolicyPartsRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.totalParts).toBe(2);
      expect(body.parts[0].partType).toBe('blanket-deny');
      expect(body.parts[0].statementItemCount).toBe(3);
      expect(body.parts[1].partType).toBe('specific-api-deny');
      expect(body.parts[1].statementItemCount).toBe(3); // 3 Action items
      expect(body.combinedSize).toBe(samplePolicyDocument.length + sampleSpecificPolicyDocument.length);
    });

    it('handles IAM helper failure gracefully (document size 0)', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
      });

      mockIAMHelperResponse({
        success: false,
        error: 'Policy not found',
      });

      const event = makeEvent({ path: '/policies/policy-123/parts' });
      const result = await getPolicyPartsRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.totalParts).toBe(1);
      expect(body.parts[0].documentSize).toBe(0);
      expect(body.parts[0].statementItemCount).toBe(0);
    });
  });

  describe('GET /policies/:policyId/parts/:partIndex (getPolicyPartDetailRoute)', () => {
    it('returns 404 when policy not found', async () => {
      mockGetPolicy.mockResolvedValueOnce(null);

      const event = makeEvent({ path: '/policies/unknown/parts/0' });
      const result = await getPolicyPartDetailRoute(event, { policyId: 'unknown', partIndex: '0' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('NotFound');
      expect(body.message).toContain('unknown');
    });

    it('returns 404 when part index out of range', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
      });

      const event = makeEvent({ path: '/policies/policy-123/parts/5' });
      const result = await getPolicyPartDetailRoute(event, { policyId: 'policy-123', partIndex: '5' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('NotFound');
      expect(body.message).toContain('Part not found');
    });

    it('returns 404 for invalid part index', async () => {
      const event = makeEvent({ path: '/policies/policy-123/parts/-1' });
      const result = await getPolicyPartDetailRoute(event, { policyId: 'policy-123', partIndex: '-1' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
    });

    it('returns part detail with document and service groups', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
        additionalPolicyArns: ['arn:aws:iam::123456789012:policy/TestPolicy-Part2'],
      });

      mockIAMHelperResponse({
        success: true,
        policyDocument: sampleSpecificPolicyDocument,
      });

      const event = makeEvent({ path: '/policies/policy-123/parts/1' });
      const result = await getPolicyPartDetailRoute(event, { policyId: 'policy-123', partIndex: '1' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.part.partIndex).toBe(1);
      expect(body.part.partType).toBe('specific-api-deny');
      expect(body.part.arn).toBe('arn:aws:iam::123456789012:policy/TestPolicy-Part2');
      expect(body.document).toBeDefined();
      expect(body.document.Version).toBe('2012-10-17');
      expect(body.services).toHaveLength(2); // s3 and ec2
      expect(body.services[0].servicePrefix).toBe('ec2');
      expect(body.services[0].actions).toEqual(['RunInstances']);
      expect(body.services[1].servicePrefix).toBe('s3');
      expect(body.services[1].actions).toEqual(['GetObject', 'PutObject']);
    });

    it('returns 502 when IAM helper invocation throws', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
      });

      mockSend.mockRejectedValueOnce(new Error('Lambda invocation timeout'));

      const event = makeEvent({ path: '/policies/policy-123/parts/0' });
      const result = await getPolicyPartDetailRoute(event, { policyId: 'policy-123', partIndex: '0' });

      expect(result.statusCode).toBe(502);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('BadGateway');
      expect(body.message).toContain('Upstream IAM service unavailable');
    });

    it('returns 502 when IAM helper returns failure', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
      });

      mockIAMHelperResponse({
        success: false,
        error: 'Access denied',
      });

      const event = makeEvent({ path: '/policies/policy-123/parts/0' });
      const result = await getPolicyPartDetailRoute(event, { policyId: 'policy-123', partIndex: '0' });

      expect(result.statusCode).toBe(502);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('BadGateway');
    });
  });

  describe('DELETE /policies/:policyId/parts/:partIndex (deletePolicyPartRoute)', () => {
    it('returns 404 when policy not found', async () => {
      mockGetPolicy.mockResolvedValueOnce(null);

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/unknown/parts/0' });
      const result = await deletePolicyPartRoute(event, { policyId: 'unknown', partIndex: '0' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
    });

    it('returns 404 when part index out of range', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
      });

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/policy-123/parts/5' });
      const result = await deletePolicyPartRoute(event, { policyId: 'policy-123', partIndex: '5' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
    });

    it('deletes primary ARN and promotes additional ARN on success', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy-Part1',
        additionalPolicyArns: ['arn:aws:iam::123456789012:policy/TestPolicy-Part2'],
      });

      mockIAMHelperResponse({ success: true });
      mockUpdatePolicy.mockResolvedValueOnce({});

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/policy-123/parts/0' });
      const result = await deletePolicyPartRoute(event, { policyId: 'policy-123', partIndex: '0' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.arn).toBe('arn:aws:iam::123456789012:policy/TestPolicy-Part1');

      // Verify the update promoted the additional ARN
      expect(mockUpdatePolicy).toHaveBeenCalledWith('policy-123', {
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy-Part2',
        additionalPolicyArns: undefined,
      });
    });

    it('deletes additional ARN and updates additionalPolicyArns', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy-Part1',
        additionalPolicyArns: [
          'arn:aws:iam::123456789012:policy/TestPolicy-Part2',
          'arn:aws:iam::123456789012:policy/TestPolicy-Part3',
        ],
      });

      mockIAMHelperResponse({ success: true });
      mockUpdatePolicy.mockResolvedValueOnce({});

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/policy-123/parts/1' });
      const result = await deletePolicyPartRoute(event, { policyId: 'policy-123', partIndex: '1' });

      expect(result.statusCode).toBe(StatusCode.OK);

      // Verify the update removed the correct additional ARN
      expect(mockUpdatePolicy).toHaveBeenCalledWith('policy-123', {
        additionalPolicyArns: ['arn:aws:iam::123456789012:policy/TestPolicy-Part3'],
      });
    });

    it('returns error when IAM deletion fails (does not modify config)', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
      });

      mockIAMHelperResponse({ success: false, error: 'Policy is attached to entities' });

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/policy-123/parts/0' });
      const result = await deletePolicyPartRoute(event, { policyId: 'policy-123', partIndex: '0' });

      expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      expect(mockUpdatePolicy).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /policies/:policyId (cascadingDeletePolicyRoute)', () => {
    it('returns 404 when policy not found', async () => {
      mockGetPolicy.mockResolvedValueOnce(null);

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/unknown' });
      const result = await cascadingDeletePolicyRoute(event, { policyId: 'unknown' });

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
    });

    it('deletes DynamoDB record when no ARNs exist (never refreshed)', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: undefined,
        additionalPolicyArns: undefined,
      });
      mockDeletePolicy.mockResolvedValueOnce(undefined);

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/policy-123' });
      const result = await cascadingDeletePolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.deletedArns).toEqual([]);
      expect(body.failedArns).toEqual([]);
      expect(mockDeletePolicy).toHaveBeenCalledWith('policy-123');
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('deletes all ARNs and DynamoDB record on full success', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy-Part1',
        additionalPolicyArns: ['arn:aws:iam::123456789012:policy/TestPolicy-Part2'],
      });

      // Both IAM deletions succeed
      mockIAMHelperResponse({ success: true });
      mockIAMHelperResponse({ success: true });
      mockDeletePolicy.mockResolvedValueOnce(undefined);

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/policy-123' });
      const result = await cascadingDeletePolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(true);
      expect(body.deletedArns).toEqual([
        'arn:aws:iam::123456789012:policy/TestPolicy-Part1',
        'arn:aws:iam::123456789012:policy/TestPolicy-Part2',
      ]);
      expect(body.failedArns).toEqual([]);
      expect(mockDeletePolicy).toHaveBeenCalledWith('policy-123');
    });

    it('handles partial failure: deletes DynamoDB record and reports failures', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy-Part1',
        additionalPolicyArns: ['arn:aws:iam::123456789012:policy/TestPolicy-Part2'],
      });

      // First deletion succeeds, second fails
      mockIAMHelperResponse({ success: true });
      mockIAMHelperResponse({ success: false, error: 'Policy is attached to entities' });
      mockDeletePolicy.mockResolvedValueOnce(undefined);

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/policy-123' });
      const result = await cascadingDeletePolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.deletedArns).toEqual(['arn:aws:iam::123456789012:policy/TestPolicy-Part1']);
      expect(body.failedArns).toEqual([
        { arn: 'arn:aws:iam::123456789012:policy/TestPolicy-Part2', error: 'Policy is attached to entities' },
      ]);
      // DynamoDB record is still deleted even on partial failure
      expect(mockDeletePolicy).toHaveBeenCalledWith('policy-123');
    });

    it('handles IAM invocation exception as a failure', async () => {
      mockGetPolicy.mockResolvedValueOnce({
        ...basePolicyConfig,
        policyArn: 'arn:aws:iam::123456789012:policy/TestPolicy',
      });

      mockSend.mockRejectedValueOnce(new Error('Lambda timeout'));
      mockDeletePolicy.mockResolvedValueOnce(undefined);

      const event = makeEvent({ httpMethod: 'DELETE', path: '/policies/policy-123' });
      const result = await cascadingDeletePolicyRoute(event, { policyId: 'policy-123' });

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.success).toBe(false);
      expect(body.deletedArns).toEqual([]);
      expect(body.failedArns).toHaveLength(1);
      expect(body.failedArns[0].arn).toBe('arn:aws:iam::123456789012:policy/TestPolicy');
      expect(body.failedArns[0].error).toContain('Lambda timeout');
      expect(mockDeletePolicy).toHaveBeenCalledWith('policy-123');
    });
  });
});
