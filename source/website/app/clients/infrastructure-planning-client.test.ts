import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InfrastructurePlanningClient } from './infrastructure-planning-client';

// Mock the s3Client module
vi.mock('./s3-client', () => ({
  s3Client: {
    fetchJson: vi.fn().mockResolvedValue({ apiBaseUrl: 'https://api.example.com' }),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('InfrastructurePlanningClient', () => {
  let client: InfrastructurePlanningClient;

  beforeEach(() => {
    client = new InfrastructurePlanningClient();
    mockFetch.mockReset();
  });

  describe('createPlan', () => {
    it('should call POST /plans and return the created plan', async () => {
      const mockPlan = {
        planId: 'plan-123',
        planName: 'Test Plan',
        sourceType: 'cloudformation',
        labels: [],
        status: 'ready',
        capabilitySetKey: 'data/plans/plan-123/capability-set.json',
        resourceTypeCount: 5,
        apiOperationCount: 0,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plan: mockPlan }),
      });

      const result = await client.createPlan({
        planName: 'Test Plan',
        sourceType: 'cloudformation',
        templateContent: 'base64content',
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planName: 'Test Plan',
          sourceType: 'cloudformation',
          templateContent: 'base64content',
        }),
      });
      expect(result).toEqual(mockPlan);
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ message: 'Plan with name "Test Plan" already exists' }),
      });

      await expect(
        client.createPlan({ planName: 'Test Plan', sourceType: 'cloudformation' }),
      ).rejects.toThrow('Plan with name "Test Plan" already exists');
    });
  });

  describe('listPlans', () => {
    it('should call GET /plans without query params', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plans: [] }),
      });

      const result = await client.listPlans();

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/plans');
      expect(result).toEqual([]);
    });

    it('should include query parameters when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plans: [] }),
      });

      await client.listPlans({ search: 'test', sourceType: 'terraform' });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/plans?search=test&sourceType=terraform',
      );
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Internal server error' }),
      });

      await expect(client.listPlans()).rejects.toThrow('Internal server error');
    });
  });

  describe('getPlan', () => {
    it('should call GET /plans/:planId and return the plan', async () => {
      const mockPlan = {
        planId: 'plan-123',
        planName: 'Test Plan',
        sourceType: 'cloudformation',
        labels: [],
        status: 'ready',
        capabilitySetKey: 'data/plans/plan-123/capability-set.json',
        resourceTypeCount: 3,
        apiOperationCount: 0,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plan: mockPlan }),
      });

      const result = await client.getPlan('plan-123');

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/plans/plan-123');
      expect(result).toEqual(mockPlan);
    });

    it('should throw an error when plan is not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Plan not found' }),
      });

      await expect(client.getPlan('nonexistent')).rejects.toThrow('Plan not found');
    });
  });

  describe('updatePlan', () => {
    it('should call PUT /plans/:planId and return the updated plan', async () => {
      const mockPlan = {
        planId: 'plan-123',
        planName: 'Updated Plan',
        sourceType: 'cloudformation',
        labels: [{ key: 'env', value: 'prod' }],
        status: 'ready',
        capabilitySetKey: 'data/plans/plan-123/capability-set.json',
        resourceTypeCount: 3,
        apiOperationCount: 0,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T11:00:00Z',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plan: mockPlan }),
      });

      const result = await client.updatePlan('plan-123', {
        planName: 'Updated Plan',
        labels: [{ key: 'env', value: 'prod' }],
      });

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/plans/plan-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planName: 'Updated Plan', labels: [{ key: 'env', value: 'prod' }] }),
      });
      expect(result).toEqual(mockPlan);
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Plan not found' }),
      });

      await expect(client.updatePlan('nonexistent', { planName: 'X' })).rejects.toThrow(
        'Plan not found',
      );
    });
  });

  describe('deletePlan', () => {
    it('should call DELETE /plans/:planId', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

      await client.deletePlan('plan-123');

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/plans/plan-123', {
        method: 'DELETE',
      });
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Failed to delete plan' }),
      });

      await expect(client.deletePlan('plan-123')).rejects.toThrow('Failed to delete plan');
    });
  });

  describe('reprocessPlan', () => {
    it('should call POST /plans/:planId/reprocess and return the updated plan', async () => {
      const mockPlan = {
        planId: 'plan-123',
        planName: 'Test Plan',
        sourceType: 'cloudformation',
        labels: [],
        status: 'ready',
        capabilitySetKey: 'data/plans/plan-123/capability-set.json',
        resourceTypeCount: 7,
        apiOperationCount: 2,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T12:00:00Z',
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ plan: mockPlan }),
      });

      const result = await client.reprocessPlan('plan-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/plans/plan-123/reprocess',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      );
      expect(result).toEqual(mockPlan);
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Failed to reprocess plan' }),
      });

      await expect(client.reprocessPlan('plan-123')).rejects.toThrow('Failed to reprocess plan');
    });
  });

  describe('getCapabilitySet', () => {
    it('should call GET /plans/:planId/capability-set and return the capability set', async () => {
      const mockCapabilitySet = {
        cfnResourceTypes: ['AWS::S3::Bucket', 'AWS::Lambda::Function'],
        terraformResourceTypes: [],
        apiOperations: [],
        serviceNames: ['Amazon S3', 'AWS Lambda'],
        terraformToCfnMapping: {},
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockCapabilitySet),
      });

      const result = await client.getCapabilitySet('plan-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/plans/plan-123/capability-set',
      );
      expect(result).toEqual(mockCapabilitySet);
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Plan not found' }),
      });

      await expect(client.getCapabilitySet('nonexistent')).rejects.toThrow('Plan not found');
    });
  });

  describe('listPlanNames', () => {
    it('should call GET /plans/names and return plan names array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ planNames: ['Plan A', 'Plan B', 'Plan C'] }),
      });

      const result = await client.listPlanNames();

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/plans/names');
      expect(result).toEqual(['Plan A', 'Plan B', 'Plan C']);
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Failed to list plan names' }),
      });

      await expect(client.listPlanNames()).rejects.toThrow('Failed to list plan names');
    });
  });
});
