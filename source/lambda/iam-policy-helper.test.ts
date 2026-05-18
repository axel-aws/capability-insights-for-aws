import { describe, it, expect, beforeEach } from 'vitest';
import {
  IAMClient,
  GetPolicyVersionCommand,
  ListPolicyVersionsCommand,
} from '@aws-sdk/client-iam';
import { mockClient } from 'aws-sdk-client-mock';
import { handler } from './iam-policy-helper';

const iamMock = mockClient(IAMClient);

describe('iam-policy-helper', () => {
  beforeEach(() => {
    iamMock.reset();
  });

  describe('getPolicyDocument', () => {
    it('returns the policy document for the default version when no versionId specified', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/TestPolicy';
      const encodedDocument = encodeURIComponent(JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Deny', NotAction: ['s3:*', 'ec2:*'], Resource: '*' }],
      }));

      iamMock.on(ListPolicyVersionsCommand, { PolicyArn: policyArn }).resolves({
        Versions: [
          { VersionId: 'v1', IsDefaultVersion: false, CreateDate: new Date('2024-01-01') },
          { VersionId: 'v2', IsDefaultVersion: true, CreateDate: new Date('2024-01-02') },
        ],
      });

      iamMock.on(GetPolicyVersionCommand, { PolicyArn: policyArn, VersionId: 'v2' }).resolves({
        PolicyVersion: {
          Document: encodedDocument,
          VersionId: 'v2',
          IsDefaultVersion: true,
        },
      });

      const result = await handler({ action: 'getPolicyDocument', policyArn });

      expect(result.success).toBe(true);
      expect(result.policyDocument).toBe(JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Deny', NotAction: ['s3:*', 'ec2:*'], Resource: '*' }],
      }));
    });

    it('returns the policy document for a specified versionId', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/TestPolicy';
      const encodedDocument = encodeURIComponent('{"Version":"2012-10-17"}');

      iamMock.on(GetPolicyVersionCommand, { PolicyArn: policyArn, VersionId: 'v3' }).resolves({
        PolicyVersion: {
          Document: encodedDocument,
          VersionId: 'v3',
          IsDefaultVersion: false,
        },
      });

      const result = await handler({ action: 'getPolicyDocument', policyArn, versionId: 'v3' });

      expect(result.success).toBe(true);
      expect(result.policyDocument).toBe('{"Version":"2012-10-17"}');
    });

    it('returns error when policyArn is not provided', async () => {
      const result = await handler({ action: 'getPolicyDocument' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('policyArn required for getPolicyDocument');
    });

    it('returns error when no default version is found', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/TestPolicy';

      iamMock.on(ListPolicyVersionsCommand, { PolicyArn: policyArn }).resolves({
        Versions: [],
      });

      const result = await handler({ action: 'getPolicyDocument', policyArn });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not determine default policy version');
    });

    it('returns error when policy document is empty', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/TestPolicy';

      iamMock.on(GetPolicyVersionCommand, { PolicyArn: policyArn, VersionId: 'v1' }).resolves({
        PolicyVersion: {
          Document: undefined,
          VersionId: 'v1',
          IsDefaultVersion: true,
        },
      });

      const result = await handler({ action: 'getPolicyDocument', policyArn, versionId: 'v1' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Policy document not found');
    });

    it('returns error when IAM throws NoSuchEntity', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/NonExistent';

      iamMock.on(ListPolicyVersionsCommand, { PolicyArn: policyArn }).rejects(
        new Error('Policy arn:aws:iam::123456789012:policy/NonExistent was not found.')
      );

      const result = await handler({ action: 'getPolicyDocument', policyArn });

      expect(result.success).toBe(false);
      expect(result.error).toContain('was not found');
    });

    it('returns error when IAM throws AccessDenied', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/Restricted';

      iamMock.on(ListPolicyVersionsCommand, { PolicyArn: policyArn }).rejects(
        new Error('User is not authorized to perform: iam:ListPolicyVersions')
      );

      const result = await handler({ action: 'getPolicyDocument', policyArn });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not authorized');
    });
  });

  describe('listVersions', () => {
    it('returns all versions for a policy', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/TestPolicy';

      iamMock.on(ListPolicyVersionsCommand, { PolicyArn: policyArn }).resolves({
        Versions: [
          { VersionId: 'v1', IsDefaultVersion: false, CreateDate: new Date('2024-01-01T00:00:00Z') },
          { VersionId: 'v2', IsDefaultVersion: true, CreateDate: new Date('2024-02-01T00:00:00Z') },
          { VersionId: 'v3', IsDefaultVersion: false, CreateDate: new Date('2024-03-01T00:00:00Z') },
        ],
      });

      const result = await handler({ action: 'listVersions', policyArn });

      expect(result.success).toBe(true);
      expect(result.versions).toHaveLength(3);
      expect(result.versions).toEqual([
        { versionId: 'v1', isDefaultVersion: false, createDate: '2024-01-01T00:00:00.000Z' },
        { versionId: 'v2', isDefaultVersion: true, createDate: '2024-02-01T00:00:00.000Z' },
        { versionId: 'v3', isDefaultVersion: false, createDate: '2024-03-01T00:00:00.000Z' },
      ]);
    });

    it('returns empty array when policy has no versions', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/TestPolicy';

      iamMock.on(ListPolicyVersionsCommand, { PolicyArn: policyArn }).resolves({
        Versions: [],
      });

      const result = await handler({ action: 'listVersions', policyArn });

      expect(result.success).toBe(true);
      expect(result.versions).toEqual([]);
    });

    it('returns error when policyArn is not provided', async () => {
      const result = await handler({ action: 'listVersions' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('policyArn required for listVersions');
    });

    it('returns error when IAM throws an error', async () => {
      const policyArn = 'arn:aws:iam::123456789012:policy/NonExistent';

      iamMock.on(ListPolicyVersionsCommand, { PolicyArn: policyArn }).rejects(
        new Error('Policy not found')
      );

      const result = await handler({ action: 'listVersions', policyArn });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Policy not found');
    });
  });

  describe('unknown action', () => {
    it('returns error for unknown action', async () => {
      const result = await handler({ action: 'invalidAction' as never });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
      expect(result.error).toContain('invalidAction');
    });
  });
});
