import { describe, it, expect } from 'vitest';
import { computeAllowList } from './allow-list-engine';
import { AvailabilityStatus } from '../../../shared/types/availability/availability-status';
import type { ApiService } from '../../../shared/types/capability/api';
import type { PolicyConfiguration } from '../../../shared/types/policy-enforcer/policy-configuration';

/**
 * Unit tests for computeAllowList.
 * Validates: Requirements 2.2, 2.3, 3.1, 3.2, 3.4, 3.6, 6.6
 */

// --- Test Fixture ---
// Known catalog data with 2 services, 3 regions, specific availability matrix:
// - s3:GetObject       → Available in us-east-1, eu-west-1, ap-southeast-1 (ALL)
// - s3:PutObject       → Available in us-east-1, eu-west-1, NOT in ap-southeast-1
// - ec2:DescribeInstances → Available in us-east-1 ONLY
// - ec2:RunInstances   → Available in us-east-1, eu-west-1, ap-southeast-1 (ALL)

const TEST_REGIONS = ['us-east-1', 'eu-west-1', 'ap-southeast-1'];

const catalogData: ApiService[] = [
  {
    sdkServiceName: 's3',
    sdkServiceFullName: 'Amazon S3',
    apis: [
      {
        apiName: 'GetObject',
        apiAction: 'GetObject',
        homepage: '',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
          'ap-southeast-1': AvailabilityStatus.AVAILABLE,
        },
      },
      {
        apiName: 'PutObject',
        apiAction: 'PutObject',
        homepage: '',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
          'ap-southeast-1': AvailabilityStatus.NOT_AVAILABLE,
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
        homepage: '',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.NOT_AVAILABLE,
          'ap-southeast-1': AvailabilityStatus.NOT_AVAILABLE,
        },
      },
      {
        apiName: 'RunInstances',
        apiAction: 'RunInstances',
        homepage: '',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
          'ap-southeast-1': AvailabilityStatus.AVAILABLE,
        },
      },
    ],
  },
];

function buildConfig(
  regions: string[],
  mode: 'intersection' | 'union',
  exceptions: { action: string; reason?: string; addedAt: string }[] = [],
): PolicyConfiguration {
  return {
    policyId: 'test-id',
    policyName: 'Test Policy',
    tags: [],
    regions,
    mode,
    policyType: 'IAM',
    exceptions,
    refreshIntervalHours: 24,
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('computeAllowList', () => {
  describe('intersection mode', () => {
    it('includes only actions available in ALL selected regions', () => {
      const config = buildConfig(TEST_REGIONS, 'intersection');
      const result = computeAllowList({ catalogData, configuration: config });

      // s3:GetObject and ec2:RunInstances are Available in all 3 regions
      expect(result.actions).toContain('s3:GetObject');
      expect(result.actions).toContain('ec2:RunInstances');

      // s3:PutObject is NOT available in ap-southeast-1 → excluded
      expect(result.actions).not.toContain('s3:PutObject');

      // ec2:DescribeInstances is only available in us-east-1 → excluded
      expect(result.actions).not.toContain('ec2:DescribeInstances');

      expect(result.actionCount).toBe(2);
      expect(result.excludedCount).toBe(2);
    });
  });

  describe('union mode', () => {
    it('includes actions available in ANY selected region', () => {
      const config = buildConfig(TEST_REGIONS, 'union');
      const result = computeAllowList({ catalogData, configuration: config });

      // All 4 actions are available in at least one region
      expect(result.actions).toContain('s3:GetObject');
      expect(result.actions).toContain('s3:PutObject');
      expect(result.actions).toContain('ec2:DescribeInstances');
      expect(result.actions).toContain('ec2:RunInstances');

      expect(result.actionCount).toBe(4);
      expect(result.excludedCount).toBe(0);
    });
  });

  describe('empty regions', () => {
    it('intersection mode with empty regions includes all actions (vacuous truth, caught by validation)', () => {
      // With empty regions, regions.every() returns true (vacuous truth),
      // so all actions pass the filter. This edge case is caught by the
      // validation layer which rejects empty regions before computation.
      const config = buildConfig([], 'intersection');
      const result = computeAllowList({ catalogData, configuration: config });

      expect(result.actions).toEqual([
        'ec2:DescribeInstances',
        'ec2:RunInstances',
        's3:GetObject',
        's3:PutObject',
      ]);
      expect(result.actionCount).toBe(4);
    });

    it('union mode with empty regions returns empty actions array (no region satisfies condition)', () => {
      // With empty regions, regions.some() returns false for all operations,
      // so no actions pass the filter.
      const config = buildConfig([], 'union');
      const result = computeAllowList({ catalogData, configuration: config });

      expect(result.actions).toEqual([]);
      expect(result.actionCount).toBe(0);
    });
  });

  describe('exceptions', () => {
    it('includes an exception for an unavailable service regardless of availability', () => {
      const config = buildConfig(TEST_REGIONS, 'intersection', [
        { action: 'lambda:InvokeFunction', reason: 'needed for custom workflow', addedAt: '2024-01-01T00:00:00Z' },
      ]);
      const result = computeAllowList({ catalogData, configuration: config });

      // lambda:InvokeFunction is not in the catalog at all, but should be included via exception
      expect(result.actions).toContain('lambda:InvokeFunction');
      expect(result.exceptionCount).toBe(1);
    });

    it('does not produce duplicate when exception matches an already-included action', () => {
      // s3:GetObject is already in the allow-list via intersection (available in all regions)
      const config = buildConfig(TEST_REGIONS, 'intersection', [
        { action: 's3:GetObject', reason: 'explicit exception', addedAt: '2024-01-01T00:00:00Z' },
      ]);
      const result = computeAllowList({ catalogData, configuration: config });

      // Count occurrences of s3:GetObject — should be exactly 1
      const occurrences = result.actions.filter(a => a === 's3:GetObject').length;
      expect(occurrences).toBe(1);

      // exceptionCount should be 0 since the action was already included
      expect(result.exceptionCount).toBe(0);
    });
  });
});
