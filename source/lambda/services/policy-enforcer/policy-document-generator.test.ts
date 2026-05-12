import { describe, it, expect } from 'vitest';
import { generatePolicyDocument } from './policy-document-generator';
import type { PolicyDocumentOptions } from './policy-document-generator';

/**
 * Unit tests for generatePolicyDocument.
 * Validates: Requirements 4.1, 4.2, 4.3, 5.3
 */

const FIXED_TIMESTAMP = '2024-01-15T12:00:00Z';
const FIXED_POLICY_NAME = 'Test Policy';

function buildOptions(overrides: Partial<PolicyDocumentOptions> = {}): PolicyDocumentOptions {
  return {
    allowList: ['ec2:DescribeInstances', 's3:GetObject', 's3:PutObject'],
    policyType: 'IAM',
    policyName: FIXED_POLICY_NAME,
    generationTimestamp: FIXED_TIMESTAMP,
    ...overrides,
  };
}

describe('generatePolicyDocument', () => {
  describe('small allow-list produces single document', () => {
    it('produces a single document with correct structure for a small allow-list', () => {
      const options = buildOptions({
        allowList: ['ec2:DescribeInstances', 's3:GetObject', 's3:PutObject'],
      });

      const result = generatePolicyDocument(options);

      // Should produce exactly one document
      expect(result.documents).toHaveLength(1);
      expect(result.splitRequired).toBe(false);
      expect(result.error).toBeUndefined();

      const doc = result.documents[0];

      // Verify document structure
      expect(doc.Version).toBe('2012-10-17');
      expect(doc.Statement).toHaveLength(1);

      const statement = doc.Statement[0];
      expect(statement.Effect).toBe('Deny');
      expect(statement.NotAction).toEqual(['ec2:DescribeInstances', 's3:GetObject', 's3:PutObject']);
      expect(statement.Resource).toBe('*');

      // Sid contains sanitized timestamp
      const sanitizedTimestamp = FIXED_TIMESTAMP.replace(/[^a-zA-Z0-9]/g, '');
      expect(statement.Sid).toContain(sanitizedTimestamp);
      expect(statement.Sid).toContain('PolicyEnforcer');

      // Total size should be the JSON size of the single document
      expect(result.totalSize).toBe(JSON.stringify(doc).length);
    });
  });

  describe('large allow-list triggers split for IAM type', () => {
    it('splits into multiple documents when allow-list exceeds 6,144 chars', () => {
      // Generate 500+ actions to exceed the 6,144 character IAM limit
      const largeAllowList: string[] = [];
      for (let i = 0; i < 500; i++) {
        largeAllowList.push(`service${i}:ActionName${i}`);
      }

      const options = buildOptions({
        allowList: largeAllowList,
        policyType: 'IAM',
      });

      const result = generatePolicyDocument(options);

      // Should require splitting
      expect(result.splitRequired).toBe(true);
      expect(result.documents.length).toBeGreaterThan(1);
      expect(result.error).toBeUndefined();

      // Each individual document must not exceed 6,144 chars
      for (const doc of result.documents) {
        const size = JSON.stringify(doc).length;
        expect(size).toBeLessThanOrEqual(6144);
      }

      // All actions should be preserved across all documents
      const allActions: string[] = [];
      for (const doc of result.documents) {
        for (const statement of doc.Statement) {
          allActions.push(...statement.NotAction);
        }
      }
      expect(allActions.sort()).toEqual(largeAllowList.sort());

      // Each document should have valid structure
      for (const doc of result.documents) {
        expect(doc.Version).toBe('2012-10-17');
        expect(doc.Statement).toHaveLength(1);
        expect(doc.Statement[0].Effect).toBe('Deny');
        expect(doc.Statement[0].Resource).toBe('*');
      }
    });
  });

  describe('SCP exceeding limit returns error with guidance message', () => {
    it('returns error with guidance when SCP document exceeds 5,120 chars', () => {
      // Generate enough actions to exceed the 5,120 character SCP limit
      const largeAllowList: string[] = [];
      for (let i = 0; i < 400; i++) {
        largeAllowList.push(`service${i}:ActionName${i}`);
      }

      const options = buildOptions({
        allowList: largeAllowList,
        policyType: 'SCP',
      });

      const result = generatePolicyDocument(options);

      // Should have an error defined
      expect(result.error).toBeDefined();
      expect(result.error).toContain('5,120');
      expect(result.error).toContain('Service Control Policies cannot be split');

      // Error should contain guidance text
      expect(result.error).toContain('reducing the allow-list scope');

      // splitRequired should be false (SCPs cannot be split)
      expect(result.splitRequired).toBe(false);

      // Document is still returned (with the oversized content)
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].Version).toBe('2012-10-17');
    });
  });

  describe('empty allow-list produces valid document', () => {
    it('produces a valid document with empty NotAction array', () => {
      const options = buildOptions({
        allowList: [],
        policyType: 'IAM',
      });

      const result = generatePolicyDocument(options);

      // Should produce a single document
      expect(result.documents).toHaveLength(1);
      expect(result.splitRequired).toBe(false);
      expect(result.error).toBeUndefined();

      const doc = result.documents[0];

      // Document structure is valid
      expect(doc.Version).toBe('2012-10-17');
      expect(doc.Statement).toHaveLength(1);

      const statement = doc.Statement[0];
      expect(statement.Effect).toBe('Deny');
      expect(statement.NotAction).toEqual([]);
      expect(statement.Resource).toBe('*');

      // Sid is still present
      expect(statement.Sid).toContain('PolicyEnforcer');
    });
  });

  describe('snapshot test for known allow-list', () => {
    it('produces expected JSON output for a known allow-list', () => {
      const options: PolicyDocumentOptions = {
        allowList: ['ec2:DescribeInstances', 's3:GetObject', 's3:PutObject'],
        policyType: 'IAM',
        policyName: 'Test Policy',
        generationTimestamp: '2024-01-15T12:00:00Z',
      };

      const result = generatePolicyDocument(options);

      expect(result).toEqual({
        documents: [
          {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'PolicyEnforcer_20240115T120000Z',
                Effect: 'Deny',
                NotAction: ['ec2:DescribeInstances', 's3:GetObject', 's3:PutObject'],
                Resource: '*',
              },
            ],
          },
        ],
        totalSize: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PolicyEnforcer_20240115T120000Z',
              Effect: 'Deny',
              NotAction: ['ec2:DescribeInstances', 's3:GetObject', 's3:PutObject'],
              Resource: '*',
            },
          ],
        }).length,
        splitRequired: false,
      });
    });
  });
});
