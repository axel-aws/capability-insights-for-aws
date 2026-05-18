import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { CapabilitySet, PlanConfiguration } from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';

// Mock the dependencies before importing the module under test
vi.mock('../services/infrastructure-planning/plan-store');
vi.mock('../services/infrastructure-planning/plan-processor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/infrastructure-planning/plan-processor')>();
  return {
    ...actual,
    PlanProcessor: vi.fn(),
  };
});
vi.mock('../services/github-token-store');
vi.mock('../services/s3-client');

import { reprocessPlanRoute } from './plan-routes';
import { PlanStore } from '../services/infrastructure-planning/plan-store';
import { PlanProcessor, GitHubFetchError } from '../services/infrastructure-planning/plan-processor';

// Helper to create a mock APIGatewayProxyEvent
function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/plans/test-plan-id/reprocess',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: { planId: 'test-plan-id' },
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
    requestContext: {
      accountId: '123456789012',
      apiId: 'test',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: 'POST',
      identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
      path: '/plans/test-plan-id/reprocess',
      stage: 'prod',
      requestId: 'test-id',
      requestTimeEpoch: 0,
      resourceId: '',
      resourcePath: '',
    },
    ...overrides,
  };
}

// Helper to create a mock PlanConfiguration
function makePlan(overrides: Partial<PlanConfiguration> = {}): PlanConfiguration {
  return {
    planId: 'test-plan-id',
    planName: 'Test Plan',
    sourceType: 'cloudformation',
    labels: [],
    status: 'ready',
    capabilitySetKey: 'data/plans/test-plan-id/capability-set.json',
    resourceTypeCount: 3,
    apiOperationCount: 0,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    lastRefreshedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// Helper to create a mock CapabilitySet
function makeCapabilitySet(overrides: Partial<CapabilitySet> = {}): CapabilitySet {
  return {
    cfnResourceTypes: ['AWS::S3::Bucket', 'AWS::Lambda::Function'],
    terraformResourceTypes: [],
    apiOperations: [],
    serviceNames: ['S3', 'Lambda'],
    terraformToCfnMapping: {},
    ...overrides,
  };
}

describe('reprocessPlanRoute', () => {
  let mockGetPlan: ReturnType<typeof vi.fn>;
  let mockUpdateCapabilitySet: ReturnType<typeof vi.fn>;
  let mockProcess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('PLAN_TABLE_NAME', 'test-plan-table');
    vi.stubEnv('WEBSITE_BUCKET_NAME', 'test-bucket');
    vi.stubEnv('GITHUB_TOKEN_SECRET_NAME', 'test-secret');
    vi.stubEnv('GITHUB_FETCH_FUNCTION_NAME', 'test-github-fetch-fn');

    mockGetPlan = vi.fn();
    mockUpdateCapabilitySet = vi.fn();
    mockProcess = vi.fn();

    // Mock PlanStore constructor to return our mock methods
    vi.mocked(PlanStore).mockImplementation(() => ({
      getPlan: mockGetPlan,
      updateCapabilitySet: mockUpdateCapabilitySet,
      createPlan: vi.fn(),
      listPlans: vi.fn(),
      updatePlan: vi.fn(),
      deletePlan: vi.fn(),
      getPlanByName: vi.fn(),
      listPlanNames: vi.fn(),
      getCapabilitySet: vi.fn(),
    }) as unknown as PlanStore);

    // Mock PlanProcessor constructor to return our mock process method
    vi.mocked(PlanProcessor).mockImplementation(() => ({
      process: mockProcess,
    }) as unknown as PlanProcessor);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('GitHub refresh using stored repositoryUrl', () => {
    it('uses stored repositoryUrl when plan has one and no body is provided', async () => {
      const plan = makePlan({
        sourceType: 'github',
        repositoryUrl: 'https://github.com/owner/repo',
      });
      const capabilitySet = makeCapabilitySet({
        apiOperations: ['s3:GetObject'],
      });
      const updatedPlan = makePlan({
        ...plan,
        lastRefreshedAt: '2025-06-01T00:00:00Z',
      });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockResolvedValue(capabilitySet);
      mockUpdateCapabilitySet.mockResolvedValue(updatedPlan);

      const event = makeEvent({ body: null });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(200);
      expect(mockProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          planName: 'Test Plan',
          sourceType: 'github',
          repositoryUrl: 'https://github.com/owner/repo',
        }),
      );
      expect(mockUpdateCapabilitySet).toHaveBeenCalledWith('test-plan-id', capabilitySet);
    });

    it('uses stored repositoryUrl even when body provides a different URL', async () => {
      const plan = makePlan({
        sourceType: 'github',
        repositoryUrl: 'https://github.com/owner/stored-repo',
      });
      const capabilitySet = makeCapabilitySet({ apiOperations: ['s3:PutObject'] });
      const updatedPlan = makePlan({ ...plan, lastRefreshedAt: '2025-06-01T00:00:00Z' });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockResolvedValue(capabilitySet);
      mockUpdateCapabilitySet.mockResolvedValue(updatedPlan);

      const event = makeEvent({
        body: JSON.stringify({ repositoryUrl: 'https://github.com/owner/body-repo' }),
      });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(200);
      // Should use stored URL (plan.repositoryUrl), not body URL
      expect(mockProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: 'https://github.com/owner/stored-repo',
        }),
      );
    });

    it('falls back to body repositoryUrl when plan has no stored URL', async () => {
      const plan = makePlan({
        sourceType: 'github',
        repositoryUrl: undefined,
      });
      const capabilitySet = makeCapabilitySet({ apiOperations: ['dynamodb:GetItem'] });
      const updatedPlan = makePlan({ ...plan, lastRefreshedAt: '2025-06-01T00:00:00Z' });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockResolvedValue(capabilitySet);
      mockUpdateCapabilitySet.mockResolvedValue(updatedPlan);

      const event = makeEvent({
        body: JSON.stringify({ repositoryUrl: 'https://github.com/owner/fallback-repo' }),
      });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(200);
      expect(mockProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryUrl: 'https://github.com/owner/fallback-repo',
        }),
      );
    });
  });

  describe('CloudFormation/Terraform refresh with re-submitted template', () => {
    it('refreshes a CloudFormation plan with templateContent in body', async () => {
      const plan = makePlan({ sourceType: 'cloudformation' });
      const templateContent = Buffer.from('AWSTemplateFormatVersion: "2010-09-09"').toString('base64');
      const capabilitySet = makeCapabilitySet();
      const updatedPlan = makePlan({ ...plan, lastRefreshedAt: '2025-06-01T00:00:00Z' });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockResolvedValue(capabilitySet);
      mockUpdateCapabilitySet.mockResolvedValue(updatedPlan);

      const event = makeEvent({
        body: JSON.stringify({ templateContent }),
      });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(200);
      expect(mockProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          planName: 'Test Plan',
          sourceType: 'cloudformation',
          templateContent,
        }),
      );
      expect(mockUpdateCapabilitySet).toHaveBeenCalledWith('test-plan-id', capabilitySet);
      const body = JSON.parse(result.body);
      expect(body.plan).toBeDefined();
    });

    it('refreshes a Terraform plan with templateContent in body', async () => {
      const plan = makePlan({ sourceType: 'terraform' });
      const templateContent = Buffer.from('resource "aws_s3_bucket" "example" {}').toString('base64');
      const capabilitySet = makeCapabilitySet({
        terraformResourceTypes: ['aws_s3_bucket'],
        cfnResourceTypes: ['AWS::S3::Bucket'],
      });
      const updatedPlan = makePlan({
        ...plan,
        sourceType: 'terraform',
        lastRefreshedAt: '2025-06-01T00:00:00Z',
      });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockResolvedValue(capabilitySet);
      mockUpdateCapabilitySet.mockResolvedValue(updatedPlan);

      const event = makeEvent({
        body: JSON.stringify({ templateContent }),
      });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(200);
      expect(mockProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          planName: 'Test Plan',
          sourceType: 'terraform',
          templateContent,
        }),
      );
      expect(mockUpdateCapabilitySet).toHaveBeenCalledWith('test-plan-id', capabilitySet);
    });

    it('returns 400 when CloudFormation plan has no templateContent in body', async () => {
      const plan = makePlan({ sourceType: 'cloudformation' });
      mockGetPlan.mockResolvedValue(plan);

      const event = makeEvent({ body: JSON.stringify({}) });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('templateContent is required');
      expect(mockProcess).not.toHaveBeenCalled();
      expect(mockUpdateCapabilitySet).not.toHaveBeenCalled();
    });

    it('returns 400 when Terraform plan has no templateContent in body', async () => {
      const plan = makePlan({ sourceType: 'terraform' });
      mockGetPlan.mockResolvedValue(plan);

      const event = makeEvent({ body: null });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('templateContent is required');
      expect(mockProcess).not.toHaveBeenCalled();
    });
  });

  describe('400 error when GitHub plan has no repositoryUrl', () => {
    it('returns 400 when GitHub plan has no stored repositoryUrl and no body URL', async () => {
      const plan = makePlan({
        sourceType: 'github',
        repositoryUrl: undefined,
      });
      mockGetPlan.mockResolvedValue(plan);

      const event = makeEvent({ body: null });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('Repository URL is required');
      expect(mockProcess).not.toHaveBeenCalled();
      expect(mockUpdateCapabilitySet).not.toHaveBeenCalled();
    });

    it('returns 400 when GitHub plan has no stored repositoryUrl and body is empty object', async () => {
      const plan = makePlan({
        sourceType: 'github',
        repositoryUrl: undefined,
      });
      mockGetPlan.mockResolvedValue(plan);

      const event = makeEvent({ body: JSON.stringify({}) });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('Repository URL is required');
      expect(mockProcess).not.toHaveBeenCalled();
    });
  });

  describe('404 for non-existent plan', () => {
    it('returns 404 when plan does not exist', async () => {
      mockGetPlan.mockResolvedValue(null);

      const event = makeEvent({ body: null });
      const result = await reprocessPlanRoute(event, { planId: 'non-existent-id' });

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('NotFound');
      expect(body.message).toContain('non-existent-id');
      expect(mockProcess).not.toHaveBeenCalled();
      expect(mockUpdateCapabilitySet).not.toHaveBeenCalled();
    });
  });

  describe('existing data is not modified on failure', () => {
    it('does not call updateCapabilitySet when processor throws an error', async () => {
      const plan = makePlan({ sourceType: 'cloudformation' });
      const templateContent = Buffer.from('invalid content').toString('base64');

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockRejectedValue(new Error('Failed to parse template: invalid YAML'));

      const event = makeEvent({
        body: JSON.stringify({ templateContent }),
      });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ProcessingError');
      expect(body.message).toContain('Failed to parse template');
      expect(mockUpdateCapabilitySet).not.toHaveBeenCalled();
    });

    it('does not call updateCapabilitySet when refresh produces zero capabilities', async () => {
      const plan = makePlan({ sourceType: 'cloudformation' });
      const templateContent = Buffer.from('Resources: {}').toString('base64');
      const emptyCapabilitySet = makeCapabilitySet({
        cfnResourceTypes: [],
        terraformResourceTypes: [],
        apiOperations: [],
        serviceNames: [],
      });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockResolvedValue(emptyCapabilitySet);

      const event = makeEvent({
        body: JSON.stringify({ templateContent }),
      });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('ProcessingError');
      expect(body.message).toContain('zero capabilities');
      expect(mockUpdateCapabilitySet).not.toHaveBeenCalled();
    });

    it('does not call updateCapabilitySet when GitHubFetchError is thrown', async () => {
      const plan = makePlan({
        sourceType: 'github',
        repositoryUrl: 'https://github.com/owner/repo',
      });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockRejectedValue(new GitHubFetchError('GitHub token is invalid or expired', 'auth', 401));

      const event = makeEvent({ body: null });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('auth');
      expect(body.message).toContain('GitHub token is invalid or expired');
      expect(mockUpdateCapabilitySet).not.toHaveBeenCalled();
    });

    it('does not call updateCapabilitySet when Lambda invocation fails', async () => {
      const plan = makePlan({
        sourceType: 'github',
        repositoryUrl: 'https://github.com/owner/repo',
      });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockRejectedValue(new Error('Failed to invoke GitHubFetchLambda: timeout'));

      const event = makeEvent({ body: null });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('LambdaInvocationError');
      expect(mockUpdateCapabilitySet).not.toHaveBeenCalled();
    });
  });

  describe('successful refresh', () => {
    it('calls updateCapabilitySet and returns updated plan on success', async () => {
      const plan = makePlan({
        sourceType: 'github',
        repositoryUrl: 'https://github.com/owner/repo',
      });
      const capabilitySet = makeCapabilitySet({
        cfnResourceTypes: ['AWS::S3::Bucket', 'AWS::DynamoDB::Table'],
        apiOperations: ['s3:GetObject', 'dynamodb:PutItem'],
      });
      const updatedPlan = makePlan({
        ...plan,
        resourceTypeCount: 2,
        apiOperationCount: 2,
        lastRefreshedAt: '2025-06-15T12:00:00Z',
      });

      mockGetPlan.mockResolvedValue(plan);
      mockProcess.mockResolvedValue(capabilitySet);
      mockUpdateCapabilitySet.mockResolvedValue(updatedPlan);

      const event = makeEvent({ body: null });
      const result = await reprocessPlanRoute(event, { planId: 'test-plan-id' });

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.plan.planId).toBe('test-plan-id');
      expect(body.plan.lastRefreshedAt).toBe('2025-06-15T12:00:00Z');
      expect(mockUpdateCapabilitySet).toHaveBeenCalledWith('test-plan-id', capabilitySet);
    });
  });
});
