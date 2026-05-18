import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { ApiAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { ClassicApiMappingData } from '@capability-insights/shared/types/terraform-classic-api-mapping';
import { filterTreeBySearch } from './use-classic-api-availability';

// --- Mock the s3Client module ---
const mockFetchJson = vi.fn();

vi.mock('~/clients/s3-client', () => ({
  s3Client: {
    fetchJson: (...args: unknown[]) => mockFetchJson(...args),
  },
}));

// --- Test Data ---

const testRegions: Region[] = [
  { Region: 'us-east-1', RegionLongName: 'US East (N. Virginia)', Partition: 'aws', RegionStatus: 'available', RequireRegionOptIn: false },
  { Region: 'us-west-2', RegionLongName: 'US West (Oregon)', Partition: 'aws', RegionStatus: 'available', RequireRegionOptIn: false },
];

const testApiRows: ApiAvailability[] = [
  {
    id: 'op-S3-CreateBucket',
    parentId: 'svc-S3',
    name: 'CreateBucket',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    sdkServiceName: 'S3',
    regionalAvailability: {
      'us-east-1': AvailabilityStatus.AVAILABLE,
      'us-west-2': AvailabilityStatus.AVAILABLE,
    },
  },
  {
    id: 'op-S3-PutBucketPolicy',
    parentId: 'svc-S3',
    name: 'PutBucketPolicy',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    sdkServiceName: 'S3',
    regionalAvailability: {
      'us-east-1': AvailabilityStatus.AVAILABLE,
      'us-west-2': AvailabilityStatus.AVAILABLE,
    },
  },
  {
    id: 'op-EC2-RunInstances',
    parentId: 'svc-EC2',
    name: 'RunInstances',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    sdkServiceName: 'EC2',
    regionalAvailability: {
      'us-east-1': AvailabilityStatus.AVAILABLE,
      'us-west-2': AvailabilityStatus.NOT_AVAILABLE,
    },
  },
];

const testMappingData: ClassicApiMappingData = {
  metadata: {
    generatedAt: '2025-01-15T10:30:00.000Z',
    providerCommitSha: 'abc123def',
    resourceCount: 2,
    serviceCount: 2,
  },
  resources: [
    {
      terraformType: 'aws_s3_bucket',
      sdkService: 'S3',
      requiredApis: ['CreateBucket', 'PutBucketPolicy'],
      registryPath: 's3_bucket',
    },
    {
      terraformType: 'aws_instance',
      sdkService: 'EC2',
      requiredApis: ['RunInstances'],
      registryPath: 'instance',
    },
  ],
};

// --- Hook Tests ---

describe('useClassicApiAvailability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('starts in loading state while fetching', async () => {
    // Never resolve the fetch to keep it in loading state
    mockFetchJson.mockReturnValue(new Promise(() => {}));

    const { useClassicApiAvailability } = await import('./use-classic-api-availability');
    const { result } = renderHook(() => useClassicApiAvailability(testApiRows, testRegions));

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.rows).toEqual([]);
  });

  it('sets error state on fetch failure', async () => {
    mockFetchJson.mockRejectedValue(new Error('Network error'));

    const { useClassicApiAvailability } = await import('./use-classic-api-availability');
    const { result } = renderHook(() => useClassicApiAvailability(testApiRows, testRegions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.rows).toEqual([]);
  });

  it('sets generic error message for non-Error exceptions', async () => {
    mockFetchJson.mockRejectedValue('something went wrong');

    const { useClassicApiAvailability } = await import('./use-classic-api-availability');
    const { result } = renderHook(() => useClassicApiAvailability(testApiRows, testRegions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to load Terraform classic API mapping data');
  });

  it('produces correct tree rows on successful fetch', async () => {
    mockFetchJson.mockResolvedValue(testMappingData);

    const { useClassicApiAvailability } = await import('./use-classic-api-availability');
    const { result } = renderHook(() => useClassicApiAvailability(testApiRows, testRegions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.rows.length).toBeGreaterThan(0);

    // Should have 2 resources + 2 services + (2 + 1) operations = 7 rows
    const resourceRows = result.current.rows.filter(
      r => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE,
    );
    const serviceRows = result.current.rows.filter(
      r => r.regionalAvailabilityType === RegionalAvailabilityType.SDK_SERVICE,
    );
    const operationRows = result.current.rows.filter(
      r => r.regionalAvailabilityType === RegionalAvailabilityType.OPERATION,
    );

    expect(resourceRows.length).toBe(2);
    expect(serviceRows.length).toBe(2);
    expect(operationRows.length).toBe(3);
  });

  it('resourceCount and serviceCount match metadata', async () => {
    mockFetchJson.mockResolvedValue(testMappingData);

    const { useClassicApiAvailability } = await import('./use-classic-api-availability');
    const { result } = renderHook(() => useClassicApiAvailability(testApiRows, testRegions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.resourceCount).toBe(testMappingData.metadata.resourceCount);
    expect(result.current.serviceCount).toBe(testMappingData.metadata.serviceCount);
  });

  it('returns zero counts when fetch fails', async () => {
    mockFetchJson.mockRejectedValue(new Error('Failed'));

    const { useClassicApiAvailability } = await import('./use-classic-api-availability');
    const { result } = renderHook(() => useClassicApiAvailability(testApiRows, testRegions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.resourceCount).toBe(0);
    expect(result.current.serviceCount).toBe(0);
  });

  it('returns empty rows when apiRows is empty', async () => {
    mockFetchJson.mockResolvedValue(testMappingData);

    const { useClassicApiAvailability } = await import('./use-classic-api-availability');
    const { result } = renderHook(() => useClassicApiAvailability([], testRegions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.rows).toEqual([]);
  });
});

// --- filterTreeBySearch Tests ---

describe('filterTreeBySearch', () => {
  // Build a sample tree for search tests
  const sampleTree: ApiAvailability[] = [
    {
      id: 'terraform-resource-aws_s3_bucket',
      parentId: null,
      name: 'aws_s3_bucket',
      regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
      sdkServiceName: 'S3',
    },
    {
      id: 'terraform-service-aws_s3_bucket-S3',
      parentId: 'terraform-resource-aws_s3_bucket',
      name: 'S3',
      regionalAvailabilityType: RegionalAvailabilityType.SDK_SERVICE,
    },
    {
      id: 'terraform-op-aws_s3_bucket-S3-CreateBucket',
      parentId: 'terraform-service-aws_s3_bucket-S3',
      name: 'CreateBucket',
      regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
      sdkServiceName: 'S3',
    },
    {
      id: 'terraform-op-aws_s3_bucket-S3-PutBucketPolicy',
      parentId: 'terraform-service-aws_s3_bucket-S3',
      name: 'PutBucketPolicy',
      regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
      sdkServiceName: 'S3',
    },
    {
      id: 'terraform-resource-aws_instance',
      parentId: null,
      name: 'aws_instance',
      regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
      sdkServiceName: 'EC2',
    },
    {
      id: 'terraform-service-aws_instance-EC2',
      parentId: 'terraform-resource-aws_instance',
      name: 'EC2',
      regionalAvailabilityType: RegionalAvailabilityType.SDK_SERVICE,
    },
    {
      id: 'terraform-op-aws_instance-EC2-RunInstances',
      parentId: 'terraform-service-aws_instance-EC2',
      name: 'RunInstances',
      regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
      sdkServiceName: 'EC2',
    },
  ];

  it('returns all rows when search query is empty', () => {
    const result = filterTreeBySearch(sampleTree, '');
    expect(result).toEqual(sampleTree);
  });

  it('filters by resource name (partial match)', () => {
    const result = filterTreeBySearch(sampleTree, 's3_bucket');
    const resultIds = new Set(result.map(r => r.id));

    // Should include the matching resource and all its descendants' ancestors
    expect(resultIds.has('terraform-resource-aws_s3_bucket')).toBe(true);
    // Should NOT include unrelated resources
    expect(resultIds.has('terraform-resource-aws_instance')).toBe(false);
  });

  it('filters by service name and includes ancestors', () => {
    const result = filterTreeBySearch(sampleTree, 'EC2');
    const resultIds = new Set(result.map(r => r.id));

    // The EC2 service row matches
    expect(resultIds.has('terraform-service-aws_instance-EC2')).toBe(true);
    // Its parent resource should be included as an ancestor
    expect(resultIds.has('terraform-resource-aws_instance')).toBe(true);
  });

  it('filters by operation name and includes ancestors', () => {
    const result = filterTreeBySearch(sampleTree, 'RunInstances');
    const resultIds = new Set(result.map(r => r.id));

    // The operation row matches
    expect(resultIds.has('terraform-op-aws_instance-EC2-RunInstances')).toBe(true);
    // Its parent service should be included
    expect(resultIds.has('terraform-service-aws_instance-EC2')).toBe(true);
    // Its grandparent resource should be included
    expect(resultIds.has('terraform-resource-aws_instance')).toBe(true);
  });

  it('search is case-insensitive', () => {
    const resultLower = filterTreeBySearch(sampleTree, 'createbucket');
    const resultUpper = filterTreeBySearch(sampleTree, 'CREATEBUCKET');
    const resultMixed = filterTreeBySearch(sampleTree, 'CreateBucket');

    expect(resultLower.length).toBe(resultUpper.length);
    expect(resultLower.length).toBe(resultMixed.length);

    // All should find the CreateBucket operation
    const lowerIds = new Set(resultLower.map(r => r.id));
    expect(lowerIds.has('terraform-op-aws_s3_bucket-S3-CreateBucket')).toBe(true);
  });

  it('partial substring matching works', () => {
    // "Bucket" should match both "aws_s3_bucket" (resource) and "CreateBucket", "PutBucketPolicy" (operations)
    const result = filterTreeBySearch(sampleTree, 'Bucket');
    const resultIds = new Set(result.map(r => r.id));

    expect(resultIds.has('terraform-resource-aws_s3_bucket')).toBe(true);
    expect(resultIds.has('terraform-op-aws_s3_bucket-S3-CreateBucket')).toBe(true);
    expect(resultIds.has('terraform-op-aws_s3_bucket-S3-PutBucketPolicy')).toBe(true);
  });

  it('returns empty array when no rows match', () => {
    const result = filterTreeBySearch(sampleTree, 'nonexistent_xyz');
    expect(result).toEqual([]);
  });

  it('matching a child includes all ancestors up to root', () => {
    const result = filterTreeBySearch(sampleTree, 'PutBucketPolicy');
    const resultIds = new Set(result.map(r => r.id));

    // The operation itself
    expect(resultIds.has('terraform-op-aws_s3_bucket-S3-PutBucketPolicy')).toBe(true);
    // Its parent service
    expect(resultIds.has('terraform-service-aws_s3_bucket-S3')).toBe(true);
    // Its grandparent resource
    expect(resultIds.has('terraform-resource-aws_s3_bucket')).toBe(true);
    // Should NOT include unrelated tree branches
    expect(resultIds.has('terraform-resource-aws_instance')).toBe(false);
  });
});
