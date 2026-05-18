import { describe, it, expect } from 'vitest';
import { generatePolicyDocument } from './policy-document-generator';
import type { PolicyDocumentOptions } from './policy-document-generator';
import type { ApiService } from '@capability-insights/shared/types/capability/api';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { AvailabilityStatus } from '../../../shared/types/availability/availability-status';

/**
 * Unit tests for generatePolicyDocument (two-tier strategy).
 * Validates: Requirements 4.1, 4.2, 4.3, 5.3
 */

const FIXED_TIMESTAMP = '2024-01-15T12:00:00Z';
const FIXED_POLICY_NAME = 'Test Policy';

function buildConfiguration(overrides: Partial<PolicyConfiguration> = {}): PolicyConfiguration {
  return {
    policyId: 'test-policy-id',
    policyName: FIXED_POLICY_NAME,
    tags: [],
    regions: ['us-east-1', 'us-west-2'],
    mode: 'intersection',
    policyType: 'IAM',
    exceptions: [],
    refreshIntervalHours: 24,
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function buildCatalogData(services: Array<{
  name: string;
  apis: Array<{ action: string; homepage: string; availability: Record<string, AvailabilityStatus> }>;
}>): ApiService[] {
  return services.map(s => ({
    sdkServiceName: s.name,
    sdkServiceFullName: `AWS ${s.name}`,
    apis: s.apis.map(a => ({
      apiName: a.action,
      apiAction: a.action,
      homepage: a.homepage,
      regionalAvailability: a.availability,
    })),
  }));
}

function buildOptions(overrides: Partial<PolicyDocumentOptions> = {}): PolicyDocumentOptions {
  const catalogData = buildCatalogData([
    {
      name: 's3',
      apis: [
        {
          action: 'GetObject',
          homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
          availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
        },
        {
          action: 'PutObject',
          homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
          availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
        },
      ],
    },
    {
      name: 'ec2',
      apis: [
        {
          action: 'DescribeInstances',
          homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/index.html',
          availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
        },
      ],
    },
  ]);

  return {
    catalogData,
    configuration: buildConfiguration(),
    policyName: FIXED_POLICY_NAME,
    generationTimestamp: FIXED_TIMESTAMP,
    ...overrides,
  };
}

describe('generatePolicyDocument', () => {
  describe('fully available services produce blanket deny with wildcards', () => {
    it('produces a single blanket deny document with service:* wildcards for fully available services', () => {
      const options = buildOptions();
      const result = generatePolicyDocument(options);

      // Should produce exactly one document (blanket deny only, no specific denies)
      expect(result.documents).toHaveLength(1);
      expect(result.splitRequired).toBe(false);
      expect(result.error).toBeUndefined();

      const doc = result.documents[0];

      // Verify document structure
      expect(doc.Version).toBe('2012-10-17');
      expect(doc.Statement).toHaveLength(1);

      const statement = doc.Statement[0];
      expect(statement.Effect).toBe('Deny');
      expect(statement.NotAction).toContain('ec2:*');
      expect(statement.NotAction).toContain('s3:*');
      expect(statement.Resource).toBe('*');

      // Sid contains BlanketDeny and sanitized timestamp
      expect(statement.Sid).toContain('PolicyEnforcerBlanketDeny');
      expect(statement.Sid).toContain('20240115T120000Z');

      // Metrics
      expect(result.blanketDenyServiceCount).toBe(0);
      expect(result.partialDenyActionCount).toBe(0);
      expect(result.fullyAvailableServiceCount).toBe(2);
    });
  });

  describe('partially available services use optimal strategy', () => {
    it('uses flipped strategy (available actions in NotAction) when fewer available than unavailable', () => {
      const catalogData = buildCatalogData([
        {
          name: 's3',
          apis: [
            {
              action: 'GetObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
            {
              action: 'PutObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.NOT_AVAILABLE },
            },
          ],
        },
        {
          name: 'ec2',
          apis: [
            {
              action: 'DescribeInstances',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
          ],
        },
      ]);

      const options = buildOptions({
        catalogData,
        configuration: buildConfiguration({ mode: 'intersection' }),
      });

      const result = generatePolicyDocument(options);

      // With 1 available and 1 unavailable action in s3, the flipped strategy
      // (list the 1 available action in NotAction) is cheaper than the original
      // (wildcard + 1 action in separate deny doc), so it produces a single document
      expect(result.documents).toHaveLength(1);
      expect(result.splitRequired).toBe(false);
      expect(result.error).toBeUndefined();

      // First document: blanket deny with ec2:* wildcard and s3:GetObject specific action
      const blanketDoc = result.documents[0];
      expect(blanketDoc.Statement[0].NotAction).toContain('ec2:*');
      expect(blanketDoc.Statement[0].NotAction).toContain('s3:GetObject');
      // s3:* should NOT be present since we're using the flipped strategy
      expect(blanketDoc.Statement[0].NotAction).not.toContain('s3:*');
      expect(blanketDoc.Statement[0].Sid).toContain('PolicyEnforcerBlanketDeny');

      // Metrics
      expect(result.partialDenyActionCount).toBe(0);
      expect(result.fullyAvailableServiceCount).toBe(2);
    });

    it('uses original strategy (wildcard + Action deny) when fewer unavailable than available', () => {
      const catalogData = buildCatalogData([
        {
          name: 's3',
          apis: [
            {
              action: 'GetObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
            {
              action: 'PutObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
            {
              action: 'DeleteObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
            {
              action: 'ListBuckets',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
            {
              action: 'CreateBucket',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.NOT_AVAILABLE },
            },
          ],
        },
      ]);

      const options = buildOptions({
        catalogData,
        configuration: buildConfiguration({ mode: 'intersection' }),
      });

      const result = generatePolicyDocument(options);

      // With 4 available and 1 unavailable, original strategy (wildcard + 1 deny) is cheaper
      // than listing 4 available actions individually
      expect(result.documents).toHaveLength(2);
      expect(result.splitRequired).toBe(true);

      // First document: blanket deny with s3:* wildcard
      const blanketDoc = result.documents[0];
      expect(blanketDoc.Statement[0].NotAction).toContain('s3:*');

      // Second document: specific API deny for the one unavailable action
      const apiDenyDoc = result.documents[1];
      expect(apiDenyDoc.Statement[0].Action).toContain('s3:CreateBucket');
      expect(apiDenyDoc.Statement[0].Sid).toContain('PolicyEnforcerAPIDeny');
    });
  });

  describe('completely unavailable services are covered by blanket deny', () => {
    it('does not add service:* to NotAction for services with zero available APIs', () => {
      const catalogData = buildCatalogData([
        {
          name: 's3',
          apis: [
            {
              action: 'GetObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
          ],
        },
        {
          name: 'bedrock',
          apis: [
            {
              action: 'InvokeModel',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/bedrock/index.html',
              availability: { 'us-east-1': AvailabilityStatus.NOT_AVAILABLE, 'us-west-2': AvailabilityStatus.NOT_AVAILABLE },
            },
          ],
        },
      ]);

      const options = buildOptions({
        catalogData,
        configuration: buildConfiguration({ mode: 'intersection' }),
      });

      const result = generatePolicyDocument(options);

      // Only s3:* should be in NotAction, not bedrock:*
      const blanketDoc = result.documents[0];
      expect(blanketDoc.Statement[0].NotAction).toContain('s3:*');
      expect(blanketDoc.Statement[0].NotAction).not.toContain('bedrock:*');

      // bedrock is counted as blanket deny
      expect(result.blanketDenyServiceCount).toBe(1);
      expect(result.fullyAvailableServiceCount).toBe(1);
    });
  });

  describe('SCP exceeding limit returns error with guidance message', () => {
    it('returns error with guidance when SCP document exceeds 5,120 chars', () => {
      // Generate many services to exceed the 5,120 character SCP limit
      const services: Array<{
        name: string;
        apis: Array<{ action: string; homepage: string; availability: Record<string, AvailabilityStatus> }>;
      }> = [];

      for (let i = 0; i < 200; i++) {
        services.push({
          name: `service${i}`,
          apis: [
            {
              action: `ActionName${i}`,
              homepage: `https://awscli.amazonaws.com/v2/documentation/api/latest/reference/service${i}/index.html`,
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
            {
              action: `OtherAction${i}`,
              homepage: `https://awscli.amazonaws.com/v2/documentation/api/latest/reference/service${i}/index.html`,
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.NOT_AVAILABLE },
            },
          ],
        });
      }

      const catalogData = buildCatalogData(services);
      const options = buildOptions({
        catalogData,
        configuration: buildConfiguration({ policyType: 'SCP' }),
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

      // Document is still returned
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].Version).toBe('2012-10-17');
    });
  });

  describe('empty catalog produces valid document', () => {
    it('produces a valid document with empty NotAction array', () => {
      const options = buildOptions({
        catalogData: [],
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
      expect(statement.Sid).toContain('PolicyEnforcerBlanketDeny');

      // Metrics
      expect(result.blanketDenyServiceCount).toBe(0);
      expect(result.partialDenyActionCount).toBe(0);
      expect(result.fullyAvailableServiceCount).toBe(0);
    });
  });

  describe('exceptions prevent actions from being denied', () => {
    it('does not deny actions that are in the exceptions list', () => {
      const catalogData = buildCatalogData([
        {
          name: 's3',
          apis: [
            {
              action: 'GetObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.NOT_AVAILABLE, 'us-west-2': AvailabilityStatus.NOT_AVAILABLE },
            },
            {
              action: 'PutObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.NOT_AVAILABLE, 'us-west-2': AvailabilityStatus.NOT_AVAILABLE },
            },
          ],
        },
      ]);

      const options = buildOptions({
        catalogData,
        configuration: buildConfiguration({
          exceptions: [{ action: 's3:GetObject', addedAt: '2024-01-01T00:00:00Z' }],
        }),
      });

      const result = generatePolicyDocument(options);

      // s3 has 1 available (exception) and 1 unavailable
      // With the optimization: 1 available action (s3:GetObject) is cheaper to list
      // in NotAction than wildcard + 1 deny action, so it uses the flipped strategy
      const blanketDoc = result.documents[0];
      expect(blanketDoc.Statement[0].NotAction).toContain('s3:GetObject');
      // s3:PutObject should NOT be in NotAction (it's unavailable and not excepted)
      expect(blanketDoc.Statement[0].NotAction).not.toContain('s3:PutObject');

      // No separate deny document needed since the blanket deny covers s3:PutObject
      // (it's not in NotAction, so it's implicitly denied)
      expect(result.documents).toHaveLength(1);
    });
  });

  describe('IAM policy size limit enforcement', () => {
    it('bin-packs specific deny actions into multiple documents within 6,144 char limit', () => {
      // Generate services where the original strategy (wildcard + deny) is cheaper,
      // meaning many available APIs and few unavailable ones per service.
      // This forces actions into the Action deny tier which then needs bin-packing.
      const services: Array<{
        name: string;
        apis: Array<{ action: string; homepage: string; availability: Record<string, AvailabilityStatus> }>;
      }> = [];

      for (let i = 0; i < 50; i++) {
        const apis: Array<{ action: string; homepage: string; availability: Record<string, AvailabilityStatus> }> = [];
        // Many available APIs per service (makes wildcard strategy cheaper)
        for (let j = 0; j < 10; j++) {
          apis.push({
            action: `AvailableAction${i}x${j}LongNameForPadding`,
            homepage: `https://awscli.amazonaws.com/v2/documentation/api/latest/reference/svc${i}/index.html`,
            availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
          });
        }
        // A few unavailable APIs per service (these go to Action deny tier)
        for (let j = 0; j < 3; j++) {
          apis.push({
            action: `UnavailableAction${i}x${j}LongNameForPadding`,
            homepage: `https://awscli.amazonaws.com/v2/documentation/api/latest/reference/svc${i}/index.html`,
            availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.NOT_AVAILABLE },
          });
        }
        services.push({ name: `svc${i}`, apis });
      }

      const catalogData = buildCatalogData(services);
      const options = buildOptions({
        catalogData,
        configuration: buildConfiguration({ mode: 'intersection' }),
      });

      const result = generatePolicyDocument(options);

      // Each individual document must not exceed 6,144 chars
      for (const doc of result.documents) {
        const size = JSON.stringify(doc).length;
        expect(size).toBeLessThanOrEqual(6144);
      }

      // Should have multiple documents (blanket deny + at least one API deny)
      expect(result.documents.length).toBeGreaterThan(1);

      // First document is always the blanket deny
      expect(result.documents[0].Statement[0].NotAction).toBeDefined();
      expect(result.documents[0].Statement[0].Sid).toContain('BlanketDeny');

      // Subsequent documents are API denies
      for (let i = 1; i < result.documents.length; i++) {
        expect(result.documents[i].Statement[0].Action).toBeDefined();
        expect(result.documents[i].Statement[0].Sid).toContain('APIDeny');
      }
    });
  });

  describe('snapshot test for known catalog data', () => {
    it('produces expected output for a known catalog', () => {
      const catalogData = buildCatalogData([
        {
          name: 's3',
          apis: [
            {
              action: 'GetObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
          ],
        },
        {
          name: 'ec2',
          apis: [
            {
              action: 'DescribeInstances',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/ec2/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.AVAILABLE },
            },
          ],
        },
      ]);

      const options: PolicyDocumentOptions = {
        catalogData,
        configuration: buildConfiguration(),
        policyName: 'Test Policy',
        generationTimestamp: '2024-01-15T12:00:00Z',
      };

      const result = generatePolicyDocument(options);

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0]).toEqual({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'PolicyEnforcerBlanketDeny20240115T120000Z',
            Effect: 'Deny',
            NotAction: ['ec2:*', 's3:*'],
            Resource: '*',
          },
        ],
      });
      expect(result.splitRequired).toBe(false);
      expect(result.blanketDenyServiceCount).toBe(0);
      expect(result.partialDenyActionCount).toBe(0);
      expect(result.fullyAvailableServiceCount).toBe(2);
    });
  });

  describe('union mode includes actions available in any region', () => {
    it('treats an action as available if it is available in any selected region', () => {
      const catalogData = buildCatalogData([
        {
          name: 's3',
          apis: [
            {
              action: 'GetObject',
              homepage: 'https://awscli.amazonaws.com/v2/documentation/api/latest/reference/s3/index.html',
              availability: { 'us-east-1': AvailabilityStatus.AVAILABLE, 'us-west-2': AvailabilityStatus.NOT_AVAILABLE },
            },
          ],
        },
      ]);

      // In union mode, s3:GetObject is available (available in us-east-1)
      const options = buildOptions({
        catalogData,
        configuration: buildConfiguration({ mode: 'union' }),
      });

      const result = generatePolicyDocument(options);

      // s3 should be fully available in union mode
      const blanketDoc = result.documents[0];
      expect(blanketDoc.Statement[0].NotAction).toContain('s3:*');
      expect(result.fullyAvailableServiceCount).toBe(1);
      expect(result.partialDenyActionCount).toBe(0);
    });
  });
});
