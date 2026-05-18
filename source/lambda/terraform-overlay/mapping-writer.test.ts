import { describe, it, expect, beforeEach } from 'vitest';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { assembleOverlayData, serializeOverlayData, deserializeOverlayData, writeOverlayToS3 } from './mapping-writer';
import type { TerraformOverlayData } from '../../shared/types/terraform-overlay';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

describe('assembleOverlayData', () => {
  it('produces correct structure with known inputs', () => {
    const result = assembleOverlayData({
      awsccMappings: [{ terraformType: 'awscc_s3_bucket', cfnType: 'AWS::S3::Bucket' }],
      classicAwsMappings: [{ terraformType: 'aws_instance', cfnType: 'AWS::EC2::Instance' }],
      awsccCommitSha: 'abc123def456abc123def456abc123def456abc1',
      classicAwsCommitSha: 'def456abc123def456abc123def456abc123def4',
    });

    // Verify metadata counts
    expect(result.metadata.awsccResourceCount).toBe(1);
    expect(result.metadata.classicAwsResourceCount).toBe(1);

    // Verify commit SHAs
    expect(result.metadata.awsccProviderCommitSha).toBe('abc123def456abc123def456abc123def456abc1');
    expect(result.metadata.classicAwsProviderCommitSha).toBe('def456abc123def456abc123def456abc123def4');

    // Verify generatedAt is a valid ISO timestamp
    expect(() => new Date(result.metadata.generatedAt).toISOString()).not.toThrow();
    expect(new Date(result.metadata.generatedAt).toISOString()).toBe(result.metadata.generatedAt);

    // Verify mapping arrays match inputs
    expect(result.awscc).toEqual([{ terraformType: 'awscc_s3_bucket', cfnType: 'AWS::S3::Bucket' }]);
    expect(result.classicAws).toEqual([{ terraformType: 'aws_instance', cfnType: 'AWS::EC2::Instance' }]);
  });

  it('produces correct counts with empty arrays', () => {
    const result = assembleOverlayData({
      awsccMappings: [],
      classicAwsMappings: [],
      awsccCommitSha: 'abc123def456abc123def456abc123def456abc1',
      classicAwsCommitSha: 'def456abc123def456abc123def456abc123def4',
    });

    expect(result.metadata.awsccResourceCount).toBe(0);
    expect(result.metadata.classicAwsResourceCount).toBe(0);
    expect(result.awscc).toEqual([]);
    expect(result.classicAws).toEqual([]);
  });
});

describe('writeOverlayToS3', () => {
  it('calls S3 PutObject with correct bucket, key, and content type', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const data: TerraformOverlayData = {
      metadata: {
        generatedAt: '2024-01-01T00:00:00.000Z',
        awsccProviderCommitSha: 'abc123def456abc123def456abc123def456abc1',
        classicAwsProviderCommitSha: 'def456abc123def456abc123def456abc123def4',
        awsccResourceCount: 1,
        classicAwsResourceCount: 1,
      },
      awscc: [{ terraformType: 'awscc_s3_bucket', cfnType: 'AWS::S3::Bucket' }],
      classicAws: [{ terraformType: 'aws_instance', cfnType: 'AWS::EC2::Instance' }],
    };

    await writeOverlayToS3({
      data,
      bucketName: 'test-bucket',
      s3Client: new S3Client({}),
    });

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;
    expect(input.Bucket).toBe('test-bucket');
    expect(input.Key).toBe('data/json/terraform_overlay.json');
    expect(input.ContentType).toBe('application/json');

    // Verify Body is valid JSON
    const parsed = JSON.parse(input.Body as string);
    expect(parsed).toEqual(data);
  });
});

describe('serializeOverlayData', () => {
  it('produces valid JSON', () => {
    const data: TerraformOverlayData = {
      metadata: {
        generatedAt: '2024-01-01T00:00:00.000Z',
        awsccProviderCommitSha: 'abc123',
        classicAwsProviderCommitSha: 'def456',
        awsccResourceCount: 0,
        classicAwsResourceCount: 0,
      },
      awscc: [],
      classicAws: [],
    };

    const json = serializeOverlayData(data);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual(data);
  });
});

describe('deserializeOverlayData', () => {
  it('throws error with invalid JSON', () => {
    expect(() => deserializeOverlayData('not valid json')).toThrow();
  });

  it('throws error with missing fields', () => {
    // Missing metadata
    expect(() => deserializeOverlayData(JSON.stringify({ awscc: [], classicAws: [] }))).toThrow(
      'Invalid TerraformOverlayData: missing required fields (metadata, awscc, classicAws)',
    );

    // Missing awscc array
    expect(() => deserializeOverlayData(JSON.stringify({ metadata: {}, classicAws: [] }))).toThrow(
      'Invalid TerraformOverlayData: missing required fields (metadata, awscc, classicAws)',
    );

    // Missing classicAws array
    expect(() => deserializeOverlayData(JSON.stringify({ metadata: {}, awscc: [] }))).toThrow(
      'Invalid TerraformOverlayData: missing required fields (metadata, awscc, classicAws)',
    );
  });
});
