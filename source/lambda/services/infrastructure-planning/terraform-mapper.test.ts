import { describe, it, expect } from 'vitest';
import { TerraformMapper } from './terraform-mapper';
import { TerraformOverlayData } from '../../../shared/types/terraform-overlay';

function createOverlayData(
  classicAws: { terraformType: string; cfnType: string | null }[] = []
): TerraformOverlayData {
  return {
    metadata: {
      generatedAt: '2025-01-01T00:00:00Z',
      awsccProviderCommitSha: 'abc123',
      classicAwsProviderCommitSha: 'def456',
      awsccResourceCount: 0,
      classicAwsResourceCount: classicAws.length,
    },
    awscc: [],
    classicAws,
  };
}

describe('TerraformMapper', () => {
  const mapper = new TerraformMapper();

  describe('AWSCC type conversion via naming convention', () => {
    it('converts awscc_s3_bucket to AWS::S3::Bucket', () => {
      const overlay = createOverlayData();
      const result = mapper.mapToCfn(['awscc_s3_bucket'], overlay);

      expect(result.cfnTypes).toEqual(['AWS::S3::Bucket']);
      expect(result.mapping).toEqual({ awscc_s3_bucket: 'AWS::S3::Bucket' });
    });

    it('converts awscc_lambda_function to AWS::Lambda::Function', () => {
      const overlay = createOverlayData();
      const result = mapper.mapToCfn(['awscc_lambda_function'], overlay);

      expect(result.cfnTypes).toEqual(['AWS::Lambda::Function']);
      expect(result.mapping).toEqual({ awscc_lambda_function: 'AWS::Lambda::Function' });
    });

    it('converts awscc_dynamodb_table to AWS::Dynamodb::Table', () => {
      const overlay = createOverlayData();
      const result = mapper.mapToCfn(['awscc_dynamodb_table'], overlay);

      expect(result.cfnTypes).toEqual(['AWS::Dynamodb::Table']);
      expect(result.mapping).toEqual({ awscc_dynamodb_table: 'AWS::Dynamodb::Table' });
    });

    it('handles single-segment service names', () => {
      const overlay = createOverlayData();
      const result = mapper.mapToCfn(['awscc_iam_role'], overlay);

      expect(result.cfnTypes).toEqual(['AWS::Iam::Role']);
      expect(result.mapping).toEqual({ awscc_iam_role: 'AWS::Iam::Role' });
    });

    it('handles multi-segment resource names', () => {
      const overlay = createOverlayData();
      const result = mapper.mapToCfn(['awscc_ec2_vpc_endpoint'], overlay);

      expect(result.cfnTypes).toEqual(['AWS::Ec2::Vpc::Endpoint']);
      expect(result.mapping).toEqual({ awscc_ec2_vpc_endpoint: 'AWS::Ec2::Vpc::Endpoint' });
    });
  });

  describe('AWS classic type lookup via overlay', () => {
    it('maps aws_* types using overlay classicAws data', () => {
      const overlay = createOverlayData([
        { terraformType: 'aws_s3_bucket', cfnType: 'AWS::S3::Bucket' },
        { terraformType: 'aws_lambda_function', cfnType: 'AWS::Lambda::Function' },
      ]);

      const result = mapper.mapToCfn(['aws_s3_bucket', 'aws_lambda_function'], overlay);

      expect(result.cfnTypes).toEqual(['AWS::S3::Bucket', 'AWS::Lambda::Function']);
      expect(result.mapping).toEqual({
        aws_s3_bucket: 'AWS::S3::Bucket',
        aws_lambda_function: 'AWS::Lambda::Function',
      });
    });

    it('does not include unmapped aws_* types (cfnType is null) in cfnTypes', () => {
      const overlay = createOverlayData([
        { terraformType: 'aws_s3_bucket', cfnType: 'AWS::S3::Bucket' },
        { terraformType: 'aws_some_unmapped_resource', cfnType: null },
      ]);

      const result = mapper.mapToCfn(
        ['aws_s3_bucket', 'aws_some_unmapped_resource'],
        overlay
      );

      expect(result.cfnTypes).toEqual(['AWS::S3::Bucket']);
      expect(result.mapping).toEqual({ aws_s3_bucket: 'AWS::S3::Bucket' });
    });

    it('does not include aws_* types not found in overlay', () => {
      const overlay = createOverlayData([
        { terraformType: 'aws_s3_bucket', cfnType: 'AWS::S3::Bucket' },
      ]);

      const result = mapper.mapToCfn(['aws_s3_bucket', 'aws_unknown_resource'], overlay);

      expect(result.cfnTypes).toEqual(['AWS::S3::Bucket']);
      expect(result.mapping).toEqual({ aws_s3_bucket: 'AWS::S3::Bucket' });
    });
  });

  describe('mixed types', () => {
    it('handles a mix of awscc_* and aws_* types', () => {
      const overlay = createOverlayData([
        { terraformType: 'aws_lambda_function', cfnType: 'AWS::Lambda::Function' },
      ]);

      const result = mapper.mapToCfn(
        ['awscc_s3_bucket', 'aws_lambda_function', 'aws_unmapped_thing'],
        overlay
      );

      expect(result.cfnTypes).toEqual(['AWS::S3::Bucket', 'AWS::Lambda::Function']);
      expect(result.mapping).toEqual({
        awscc_s3_bucket: 'AWS::S3::Bucket',
        aws_lambda_function: 'AWS::Lambda::Function',
      });
    });

    it('returns empty results for empty input', () => {
      const overlay = createOverlayData();
      const result = mapper.mapToCfn([], overlay);

      expect(result.cfnTypes).toEqual([]);
      expect(result.mapping).toEqual({});
    });

    it('ignores types that do not start with aws_ or awscc_', () => {
      const overlay = createOverlayData();
      const result = mapper.mapToCfn(['google_compute_instance', 'azurerm_resource_group'], overlay);

      expect(result.cfnTypes).toEqual([]);
      expect(result.mapping).toEqual({});
    });
  });
});
