import { describe, it, expect } from 'vitest';
import {
  buildOperationAvailabilityIndex,
  computeResourceAvailability,
  getMissingOperations,
  buildAvailabilityTree,
} from './classic-api-availability-engine';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { ApiAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { ClassicApiMappingData } from '@capability-insights/shared/types/terraform-classic-api-mapping';

// --- Test Fixtures ---

const testRegions: Region[] = [
  { Region: 'us-east-1', RegionLongName: 'US East (N. Virginia)', Partition: 'aws', RegionStatus: 'available', RequireRegionOptIn: false },
  { Region: 'us-west-2', RegionLongName: 'US West (Oregon)', Partition: 'aws', RegionStatus: 'available', RequireRegionOptIn: false },
  { Region: 'eu-west-1', RegionLongName: 'Europe (Ireland)', Partition: 'aws', RegionStatus: 'available', RequireRegionOptIn: false },
];

/** S3 operations available in all regions */
const s3ApiRows: ApiAvailability[] = [
  {
    id: 'op-S3-CreateBucket',
    parentId: 'svc-S3',
    name: 'CreateBucket',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    sdkServiceName: 'S3',
    regionalAvailability: {
      'us-east-1': AvailabilityStatus.AVAILABLE,
      'us-west-2': AvailabilityStatus.AVAILABLE,
      'eu-west-1': AvailabilityStatus.AVAILABLE,
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
      'eu-west-1': AvailabilityStatus.AVAILABLE,
    },
  },
  {
    id: 'op-S3-DeleteBucket',
    parentId: 'svc-S3',
    name: 'DeleteBucket',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    sdkServiceName: 'S3',
    regionalAvailability: {
      'us-east-1': AvailabilityStatus.AVAILABLE,
      'us-west-2': AvailabilityStatus.AVAILABLE,
      'eu-west-1': AvailabilityStatus.AVAILABLE,
    },
  },
];

/** EC2 operations: RunInstances available everywhere, but CreateFleet only in us-east-1 */
const ec2ApiRows: ApiAvailability[] = [
  {
    id: 'op-EC2-RunInstances',
    parentId: 'svc-EC2',
    name: 'RunInstances',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    sdkServiceName: 'EC2',
    regionalAvailability: {
      'us-east-1': AvailabilityStatus.AVAILABLE,
      'us-west-2': AvailabilityStatus.AVAILABLE,
      'eu-west-1': AvailabilityStatus.AVAILABLE,
    },
  },
  {
    id: 'op-EC2-DescribeInstances',
    parentId: 'svc-EC2',
    name: 'DescribeInstances',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    sdkServiceName: 'EC2',
    regionalAvailability: {
      'us-east-1': AvailabilityStatus.AVAILABLE,
      'us-west-2': AvailabilityStatus.AVAILABLE,
      'eu-west-1': AvailabilityStatus.AVAILABLE,
    },
  },
  {
    id: 'op-EC2-CreateFleet',
    parentId: 'svc-EC2',
    name: 'CreateFleet',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    sdkServiceName: 'EC2',
    regionalAvailability: {
      'us-east-1': AvailabilityStatus.AVAILABLE,
      'us-west-2': AvailabilityStatus.NOT_AVAILABLE,
      'eu-west-1': AvailabilityStatus.NOT_AVAILABLE,
    },
  },
];

const allApiRows = [...s3ApiRows, ...ec2ApiRows];

const s3BucketMapping: ClassicApiMappingData = {
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
      requiredApis: ['CreateBucket', 'PutBucketPolicy', 'DeleteBucket'],
      registryPath: 's3_bucket',
    },
    {
      terraformType: 'aws_ec2_fleet',
      sdkService: 'EC2',
      requiredApis: ['CreateFleet', 'DescribeInstances'],
      registryPath: 'ec2_fleet',
    },
  ],
};

// --- Tests ---

describe('buildOperationAvailabilityIndex', () => {
  it('indexes operations by service, operation name, and region', () => {
    const index = buildOperationAvailabilityIndex(s3ApiRows);

    expect(index.has('s3')).toBe(true);
    const s3Map = index.get('s3')!;
    expect(s3Map.has('CreateBucket')).toBe(true);
    expect(s3Map.get('CreateBucket')!.has('us-east-1')).toBe(true);
    expect(s3Map.get('CreateBucket')!.has('us-west-2')).toBe(true);
  });

  it('only indexes OPERATION type rows', () => {
    const mixedRows: ApiAvailability[] = [
      ...s3ApiRows,
      {
        id: 'svc-S3',
        parentId: null,
        name: 'S3',
        regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
        regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
      },
    ];

    const index = buildOperationAvailabilityIndex(mixedRows);
    // The SERVICE row should not create a separate entry
    const s3Map = index.get('s3')!;
    expect(s3Map.has('S3')).toBe(false);
  });

  it('only indexes regions with AVAILABLE status', () => {
    const index = buildOperationAvailabilityIndex(ec2ApiRows);

    const ec2Map = index.get('ec2')!;
    const createFleetRegions = ec2Map.get('CreateFleet')!;
    expect(createFleetRegions.has('us-east-1')).toBe(true);
    expect(createFleetRegions.has('us-west-2')).toBe(false);
    expect(createFleetRegions.has('eu-west-1')).toBe(false);
  });

  it('returns empty index for empty input', () => {
    const index = buildOperationAvailabilityIndex([]);
    expect(index.size).toBe(0);
  });
});

describe('computeResourceAvailability', () => {
  it('returns "Available" when all required operations are available in the region', () => {
    const index = buildOperationAvailabilityIndex(s3ApiRows);
    const result = computeResourceAvailability(
      ['CreateBucket', 'PutBucketPolicy', 'DeleteBucket'],
      'S3',
      'us-east-1',
      index,
    );
    expect(result).toBe('Available');
  });

  it('returns "Not Available" when one operation is missing in the region', () => {
    const index = buildOperationAvailabilityIndex(ec2ApiRows);
    // CreateFleet is NOT_AVAILABLE in us-west-2
    const result = computeResourceAvailability(
      ['CreateFleet', 'DescribeInstances'],
      'EC2',
      'us-west-2',
      index,
    );
    expect(result).toBe('Not Available');
  });

  it('returns "Not Available" when the service is not in the index', () => {
    const index = buildOperationAvailabilityIndex(s3ApiRows);
    const result = computeResourceAvailability(
      ['SomeOperation'],
      'NonExistentService',
      'us-east-1',
      index,
    );
    expect(result).toBe('Not Available');
  });

  it('returns "Not Available" when the operation is not in the index', () => {
    const index = buildOperationAvailabilityIndex(s3ApiRows);
    const result = computeResourceAvailability(
      ['CreateBucket', 'NonExistentOperation'],
      'S3',
      'us-east-1',
      index,
    );
    expect(result).toBe('Not Available');
  });

  it('returns "Unknown" when requiredApis is empty', () => {
    const index = buildOperationAvailabilityIndex(s3ApiRows);
    const result = computeResourceAvailability([], 'S3', 'us-east-1', index);
    expect(result).toBe('Unknown');
  });
});

describe('getMissingOperations', () => {
  it('returns empty array when all operations are available', () => {
    const index = buildOperationAvailabilityIndex(s3ApiRows);
    const missing = getMissingOperations(
      ['CreateBucket', 'PutBucketPolicy'],
      'S3',
      'us-east-1',
      index,
    );
    expect(missing).toEqual([]);
  });

  it('returns missing operations formatted as service:operation', () => {
    const index = buildOperationAvailabilityIndex(ec2ApiRows);
    const missing = getMissingOperations(
      ['CreateFleet', 'DescribeInstances'],
      'EC2',
      'us-west-2',
      index,
    );
    expect(missing).toEqual(['EC2:CreateFleet']);
  });

  it('returns all operations when service is not in the index', () => {
    const index = buildOperationAvailabilityIndex(s3ApiRows);
    const missing = getMissingOperations(
      ['OpA', 'OpB'],
      'UnknownService',
      'us-east-1',
      index,
    );
    expect(missing).toEqual(['UnknownService:OpA', 'UnknownService:OpB']);
  });

  it('returns multiple missing operations when several are unavailable', () => {
    const index = buildOperationAvailabilityIndex(ec2ApiRows);
    // CreateFleet is unavailable in eu-west-1, but DescribeInstances is available
    const missing = getMissingOperations(
      ['CreateFleet', 'RunInstances', 'DescribeInstances'],
      'EC2',
      'eu-west-1',
      index,
    );
    expect(missing).toEqual(['EC2:CreateFleet']);
  });
});

describe('buildAvailabilityTree', () => {
  it('produces three-level tree with known S3 and EC2 data', () => {
    const tree = buildAvailabilityTree(s3BucketMapping, allApiRows, testRegions);

    // Should have: 2 resources + 2 services + (3 + 2) operations = 9 rows
    expect(tree.length).toBe(9);

    const resourceRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE);
    const serviceRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.SDK_SERVICE);
    const operationRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.OPERATION);

    expect(resourceRows.length).toBe(2);
    expect(serviceRows.length).toBe(2);
    expect(operationRows.length).toBe(5);
  });

  it('resource rows have parentId null', () => {
    const tree = buildAvailabilityTree(s3BucketMapping, allApiRows, testRegions);
    const resourceRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE);

    for (const row of resourceRows) {
      expect(row.parentId).toBeNull();
    }
  });

  it('service rows reference their parent resource', () => {
    const tree = buildAvailabilityTree(s3BucketMapping, allApiRows, testRegions);
    const resourceRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE);
    const serviceRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.SDK_SERVICE);
    const resourceIds = new Set(resourceRows.map(r => r.id));

    for (const row of serviceRows) {
      expect(row.parentId).not.toBeNull();
      expect(resourceIds.has(row.parentId!)).toBe(true);
    }
  });

  it('operation rows reference their parent service', () => {
    const tree = buildAvailabilityTree(s3BucketMapping, allApiRows, testRegions);
    const serviceRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.SDK_SERVICE);
    const operationRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.OPERATION);
    const serviceIds = new Set(serviceRows.map(r => r.id));

    for (const row of operationRows) {
      expect(row.parentId).not.toBeNull();
      expect(serviceIds.has(row.parentId!)).toBe(true);
    }
  });

  it('S3 resource row is Available in all regions (all ops available)', () => {
    const tree = buildAvailabilityTree(s3BucketMapping, allApiRows, testRegions);
    const s3Resource = tree.find(r => r.name === 'aws_s3_bucket');

    expect(s3Resource).toBeDefined();
    expect(s3Resource!.regionalAvailability!['us-east-1']).toBe(AvailabilityStatus.AVAILABLE);
    expect(s3Resource!.regionalAvailability!['us-west-2']).toBe(AvailabilityStatus.AVAILABLE);
    expect(s3Resource!.regionalAvailability!['eu-west-1']).toBe(AvailabilityStatus.AVAILABLE);
  });

  it('EC2 Fleet resource row is Not Available in regions where CreateFleet is missing', () => {
    const tree = buildAvailabilityTree(s3BucketMapping, allApiRows, testRegions);
    const ec2Fleet = tree.find(r => r.name === 'aws_ec2_fleet');

    expect(ec2Fleet).toBeDefined();
    expect(ec2Fleet!.regionalAvailability!['us-east-1']).toBe(AvailabilityStatus.AVAILABLE);
    expect(ec2Fleet!.regionalAvailability!['us-west-2']).toBe(AvailabilityStatus.NOT_AVAILABLE);
    expect(ec2Fleet!.regionalAvailability!['eu-west-1']).toBe(AvailabilityStatus.NOT_AVAILABLE);
  });

  it('operation rows have actual availability from API data', () => {
    const tree = buildAvailabilityTree(s3BucketMapping, allApiRows, testRegions);
    const operationRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.OPERATION);

    // Find the CreateFleet operation row
    const createFleetOp = operationRows.find(r => r.name === 'CreateFleet');
    expect(createFleetOp).toBeDefined();
    expect(createFleetOp!.regionalAvailability!['us-east-1']).toBe(AvailabilityStatus.AVAILABLE);
    expect(createFleetOp!.regionalAvailability!['us-west-2']).toBe(AvailabilityStatus.NOT_AVAILABLE);
    expect(createFleetOp!.regionalAvailability!['eu-west-1']).toBe(AvailabilityStatus.NOT_AVAILABLE);

    // Find the CreateBucket operation row
    const createBucketOp = operationRows.find(r => r.name === 'CreateBucket');
    expect(createBucketOp).toBeDefined();
    expect(createBucketOp!.regionalAvailability!['us-east-1']).toBe(AvailabilityStatus.AVAILABLE);
    expect(createBucketOp!.regionalAvailability!['us-west-2']).toBe(AvailabilityStatus.AVAILABLE);
    expect(createBucketOp!.regionalAvailability!['eu-west-1']).toBe(AvailabilityStatus.AVAILABLE);
  });

  it('operation rows have sdkServiceName set', () => {
    const tree = buildAvailabilityTree(s3BucketMapping, allApiRows, testRegions);
    const operationRows = tree.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.OPERATION);

    for (const row of operationRows) {
      expect(row.sdkServiceName).toBeDefined();
    }

    const s3Ops = operationRows.filter(r => r.sdkServiceName === 'S3');
    expect(s3Ops.length).toBe(3); // CreateBucket, PutBucketPolicy, DeleteBucket

    const ec2Ops = operationRows.filter(r => r.sdkServiceName === 'EC2');
    expect(ec2Ops.length).toBe(2); // CreateFleet, DescribeInstances
  });
});
