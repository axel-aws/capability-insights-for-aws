import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyEnforcerClient } from './policy-enforcer-client';

// Mock the s3Client module
vi.mock('./s3-client', () => ({
  s3Client: {
    fetchJson: vi.fn().mockResolvedValue({ apiBaseUrl: 'https://api.example.com' }),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('PolicyEnforcerClient', () => {
  let client: PolicyEnforcerClient;

  beforeEach(() => {
    client = new PolicyEnforcerClient();
    mockFetch.mockReset();
  });

  describe('getPolicyParts', () => {
    it('should call GET /policies/:policyId/parts and return PolicyPartsResponse', async () => {
      const mockResponse = {
        parts: [
          { partIndex: 0, arn: 'arn:aws:iam::123:policy/test-0', partType: 'blanket-deny', documentSize: 2048, statementItemCount: 5 },
          { partIndex: 1, arn: 'arn:aws:iam::123:policy/test-1', partType: 'specific-api-deny', documentSize: 4096, statementItemCount: 20 },
        ],
        totalParts: 2,
        combinedSize: 6144,
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getPolicyParts('policy-123');

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/policies/policy-123/parts');
      expect(result).toEqual(mockResponse);
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Policy not found' }),
      });

      await expect(client.getPolicyParts('nonexistent')).rejects.toThrow('Policy not found');
    });
  });

  describe('getPolicyPartDetail', () => {
    it('should call GET /policies/:policyId/parts/:partIndex and return PolicyPartDetailResponse', async () => {
      const mockResponse = {
        part: { partIndex: 0, arn: 'arn:aws:iam::123:policy/test-0', partType: 'blanket-deny', documentSize: 2048, statementItemCount: 5 },
        document: { Version: '2012-10-17', Statement: [] },
        services: [{ servicePrefix: 's3', actions: ['GetObject', 'PutObject'] }],
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getPolicyPartDetail('policy-123', 0);

      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/policies/policy-123/parts/0');
      expect(result).toEqual(mockResponse);
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ message: 'Part not found' }),
      });

      await expect(client.getPolicyPartDetail('policy-123', 99)).rejects.toThrow('Part not found');
    });
  });

  describe('deletePolicyPart', () => {
    it('should call DELETE /policies/:policyId/parts/:partIndex', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await client.deletePolicyPart('policy-123', 1);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/policies/policy-123/parts/1',
        { method: 'DELETE' },
      );
    });

    it('should throw an error when the request fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'IAM deletion failed' }),
      });

      await expect(client.deletePolicyPart('policy-123', 0)).rejects.toThrow('IAM deletion failed');
    });
  });

  describe('deletePolicy (cascading)', () => {
    it('should call DELETE /policies/:policyId and return CascadingDeleteResponse', async () => {
      const mockResponse = {
        success: true,
        deletedArns: ['arn:aws:iam::123:policy/test-0', 'arn:aws:iam::123:policy/test-1'],
        failedArns: [],
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.deletePolicy('policy-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/policies/policy-123',
        { method: 'DELETE' },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should return partial failure response', async () => {
      const mockResponse = {
        success: false,
        deletedArns: ['arn:aws:iam::123:policy/test-0'],
        failedArns: [{ arn: 'arn:aws:iam::123:policy/test-1', error: 'Access denied' }],
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.deletePolicy('policy-123');

      expect(result.success).toBe(false);
      expect(result.deletedArns).toHaveLength(1);
      expect(result.failedArns).toHaveLength(1);
    });
  });

  describe('refreshAllPolicies', () => {
    it('should call refreshPolicy for each policy ID', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await client.refreshAllPolicies(['policy-1', 'policy-2', 'policy-3']);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/policies/policy-1/refresh',
        { method: 'POST' },
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/policies/policy-2/refresh',
        { method: 'POST' },
      );
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/policies/policy-3/refresh',
        { method: 'POST' },
      );
    });

    it('should handle empty array without making any calls', async () => {
      await client.refreshAllPolicies([]);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should propagate errors from individual refresh calls', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'Refresh failed' }),
        });

      await expect(client.refreshAllPolicies(['policy-1', 'policy-2'])).rejects.toThrow('Refresh failed');
    });
  });
});
