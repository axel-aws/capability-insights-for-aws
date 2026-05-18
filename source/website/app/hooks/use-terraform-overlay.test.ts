import { describe, it, expect } from 'vitest';
import { buildOverlayIndex, translateRows, searchAllConventions, getResourceCount } from './use-terraform-overlay';
import type { CfnAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import type { TerraformOverlayData } from '@capability-insights/shared/types/terraform-overlay';

// --- Test Data ---

const testOverlayData: TerraformOverlayData = {
  metadata: {
    generatedAt: '2024-01-01T00:00:00.000Z',
    awsccProviderCommitSha: 'abc123',
    classicAwsProviderCommitSha: 'def456',
    awsccResourceCount: 2,
    classicAwsResourceCount: 3,
  },
  awscc: [
    { terraformType: 'awscc_s3_bucket', cfnType: 'AWS::S3::Bucket' },
    { terraformType: 'awscc_ec2_instance', cfnType: 'AWS::EC2::Instance' },
  ],
  classicAws: [
    { terraformType: 'aws_s3_bucket', cfnType: 'AWS::S3::Bucket' },
    { terraformType: 'aws_instance', cfnType: 'AWS::EC2::Instance' },
    { terraformType: 'aws_vpc_peering', cfnType: null }, // unmapped
  ],
};

const testRows: CfnAvailability[] = [
  {
    id: 'cfn-S3',
    parentId: null,
    name: 'S3',
    regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
    serviceName: 'S3',
  },
  {
    id: 'cfn-S3-Bucket',
    parentId: 'cfn-S3',
    name: 'Bucket',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
  },
  {
    id: 'cfn-EC2',
    parentId: null,
    name: 'EC2',
    regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
    serviceName: 'EC2',
  },
  {
    id: 'cfn-EC2-Instance',
    parentId: 'cfn-EC2',
    name: 'Instance',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
  },
  {
    id: 'cfn-Lambda',
    parentId: null,
    name: 'Lambda',
    regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
    serviceName: 'Lambda',
  },
  {
    id: 'cfn-Lambda-Function',
    parentId: 'cfn-Lambda',
    name: 'Function',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
  },
];

// --- Tests ---

describe('buildOverlayIndex', () => {
  it('produces correct lookup maps from known data', () => {
    const index = buildOverlayIndex(testOverlayData);

    // cfnToAwscc
    expect(index.cfnToAwscc.get('AWS::S3::Bucket')).toBe('awscc_s3_bucket');
    expect(index.cfnToAwscc.get('AWS::EC2::Instance')).toBe('awscc_ec2_instance');
    expect(index.cfnToAwscc.size).toBe(2);

    // cfnToClassicAws
    expect(index.cfnToClassicAws.get('AWS::S3::Bucket')).toBe('aws_s3_bucket');
    expect(index.cfnToClassicAws.get('AWS::EC2::Instance')).toBe('aws_instance');
    expect(index.cfnToClassicAws.size).toBe(2);

    // awsccToCfn
    expect(index.awsccToCfn.get('awscc_s3_bucket')).toBe('AWS::S3::Bucket');
    expect(index.awsccToCfn.get('awscc_ec2_instance')).toBe('AWS::EC2::Instance');
    expect(index.awsccToCfn.size).toBe(2);

    // classicAwsToCfn
    expect(index.classicAwsToCfn.get('aws_s3_bucket')).toBe('AWS::S3::Bucket');
    expect(index.classicAwsToCfn.get('aws_instance')).toBe('AWS::EC2::Instance');
    expect(index.classicAwsToCfn.get('aws_vpc_peering')).toBeNull();
    expect(index.classicAwsToCfn.size).toBe(3);

    // unmappedClassicAws
    expect(index.unmappedClassicAws).toHaveLength(1);
    expect(index.unmappedClassicAws[0].terraformType).toBe('aws_vpc_peering');
    expect(index.unmappedClassicAws[0].cfnType).toBeNull();

    // allAwscc
    expect(index.allAwscc).toHaveLength(2);
    expect(index.allAwscc).toEqual(testOverlayData.awscc);
  });
});

describe('translateRows', () => {
  const index = buildOverlayIndex(testOverlayData);

  it('with cloudformation convention returns rows unchanged', () => {
    const result = translateRows(testRows, 'cloudformation', index);

    expect(result).toEqual(testRows);
  });

  it('with terraform-awscc translates CFN names to AWSCC names', () => {
    const result = translateRows(testRows, 'terraform-awscc', index);

    const names = result.map((r) => r.name);
    expect(names).toContain('awscc_s3_bucket');
    expect(names).toContain('awscc_ec2_instance');

    // Verify the translated rows retain their original IDs
    const s3Row = result.find((r) => r.id === 'cfn-S3-Bucket');
    expect(s3Row).toBeDefined();
    expect(s3Row!.name).toBe('awscc_s3_bucket');

    const ec2Row = result.find((r) => r.id === 'cfn-EC2-Instance');
    expect(ec2Row).toBeDefined();
    expect(ec2Row!.name).toBe('awscc_ec2_instance');
  });

  it('with terraform-aws translates CFN names to classic AWS names', () => {
    const result = translateRows(testRows, 'terraform-aws', index);

    const s3Row = result.find((r) => r.id === 'cfn-S3-Bucket');
    expect(s3Row).toBeDefined();
    expect(s3Row!.name).toBe('aws_s3_bucket');

    const ec2Row = result.find((r) => r.id === 'cfn-EC2-Instance');
    expect(ec2Row).toBeDefined();
    expect(ec2Row!.name).toBe('aws_instance');
  });

  it('with terraform-awscc excludes unmapped CFN resources', () => {
    const result = translateRows(testRows, 'terraform-awscc', index);

    // AWS::Lambda::Function has no AWSCC mapping, so it should be excluded
    const lambdaRow = result.find((r) => r.id === 'cfn-Lambda-Function');
    expect(lambdaRow).toBeUndefined();

    // Only mapped resource type rows should appear
    const resourceTypeRows = result.filter((r) => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE);
    expect(resourceTypeRows).toHaveLength(2);
  });

  it('with terraform-aws does not include unmapped classic AWS resources (no availability data)', () => {
    const result = translateRows(testRows, 'terraform-aws', index);

    // aws_vpc_peering is unmapped (cfnType: null) — should NOT be included since it has no availability data
    const vpcPeeringRow = result.find((r) => r.name === 'aws_vpc_peering');
    expect(vpcPeeringRow).toBeUndefined();
  });

  it('with terraform-aws excludes unmapped CFN resources', () => {
    const result = translateRows(testRows, 'terraform-aws', index);

    // AWS::Lambda::Function has no classic AWS mapping, so it should be excluded
    const lambdaRow = result.find((r) => r.id === 'cfn-Lambda-Function');
    expect(lambdaRow).toBeUndefined();
  });
});

describe('searchAllConventions', () => {
  const index = buildOverlayIndex(testOverlayData);

  it('matches via CFN name (search "s3" finds S3 service and Bucket)', () => {
    const result = searchAllConventions(testRows, 's3', index, 'cloudformation');

    // "s3" matches the service name "S3" and the resource "Bucket" (via parent)
    const s3Service = result.find((r) => r.id === 'cfn-S3');
    expect(s3Service).toBeDefined();
  });

  it('matches via AWSCC name (search "awscc" finds resources with AWSCC mapping)', () => {
    const result = searchAllConventions(testRows, 'awscc', index, 'cloudformation');

    // Both S3::Bucket and EC2::Instance have AWSCC mappings containing "awscc"
    expect(result.length).toBeGreaterThanOrEqual(2);
    const bucketRow = result.find((r) => r.id === 'cfn-S3-Bucket');
    const instanceRow = result.find((r) => r.id === 'cfn-EC2-Instance');
    expect(bucketRow).toBeDefined();
    expect(instanceRow).toBeDefined();
  });

  it('matches via classic AWS name (search "aws_instance" finds EC2)', () => {
    const result = searchAllConventions(testRows, 'aws_instance', index, 'cloudformation');

    const ec2Row = result.find((r) => r.id === 'cfn-EC2-Instance');
    expect(ec2Row).toBeDefined();
  });

  it('returns results using the active convention labels', () => {
    const result = searchAllConventions(testRows, 'bucket', index, 'terraform-awscc');

    // The Bucket row should be translated to its AWSCC name
    const s3Row = result.find((r) => r.id === 'cfn-S3-Bucket');
    expect(s3Row).toBeDefined();
    expect(s3Row!.name).toBe('awscc_s3_bucket');
  });

  it('case-insensitive matching', () => {
    const result = searchAllConventions(testRows, 'BUCKET', index, 'cloudformation');

    const bucketRow = result.find((r) => r.id === 'cfn-S3-Bucket');
    expect(bucketRow).toBeDefined();
  });

  it('empty query returns all translated rows', () => {
    const result = searchAllConventions(testRows, '', index, 'cloudformation');
    const translated = translateRows(testRows, 'cloudformation', index);

    expect(result.length).toBe(translated.length);
  });

  it('does not include unmapped classic AWS resources in search results', () => {
    const result = searchAllConventions(testRows, 'vpc_peering', index, 'terraform-aws');

    // Unmapped resources have no availability data, so they shouldn't appear
    const vpcRow = result.find((r) => r.name === 'aws_vpc_peering');
    expect(vpcRow).toBeUndefined();
  });
});

describe('getResourceCount', () => {
  const index = buildOverlayIndex(testOverlayData);

  it('returns correct count for cloudformation convention', () => {
    const count = getResourceCount(testRows, 'cloudformation', index);

    // 3 resource type rows (Bucket, Instance, Function)
    expect(count).toBe(3);
  });

  it('returns correct count for terraform-awscc convention', () => {
    const count = getResourceCount(testRows, 'terraform-awscc', index);

    // 2 mapped rows (S3::Bucket, EC2::Instance) — Lambda::Function has no AWSCC mapping
    expect(count).toBe(2);
  });

  it('returns correct count for terraform-aws convention', () => {
    const count = getResourceCount(testRows, 'terraform-aws', index);

    // 2 mapped rows (S3::Bucket, EC2::Instance) — Lambda::Function has no classic AWS mapping
    expect(count).toBe(2);
  });

  it('equals the count of RESOURCE_TYPE rows in translateRows output', () => {
    for (const convention of ['cloudformation', 'terraform-aws', 'terraform-awscc'] as const) {
      const count = getResourceCount(testRows, convention, index);
      const translated = translateRows(testRows, convention, index);
      const resourceTypeCount = translated.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE).length;
      expect(count).toBe(resourceTypeCount);
    }
  });
});
