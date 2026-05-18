import { describe, it, expect } from 'vitest';
import { assembleClassicApiMapping, deriveRegistryPath } from './classic-api-mapping-assembler';
import type { ResourceApiMapping } from './classic-api-mapping-assembler';

describe('deriveRegistryPath', () => {
  it('strips aws_ prefix from terraform type', () => {
    expect(deriveRegistryPath('aws_s3_bucket')).toBe('s3_bucket');
  });

  it('strips aws_ prefix from ec2 instance type', () => {
    expect(deriveRegistryPath('aws_instance')).toBe('instance');
  });

  it('strips aws_ prefix from multi-word resource', () => {
    expect(deriveRegistryPath('aws_lambda_function')).toBe('lambda_function');
  });

  it('returns full type name when no aws_ prefix', () => {
    expect(deriveRegistryPath('custom_resource')).toBe('custom_resource');
  });

  it('handles aws_ prefix only (edge case)', () => {
    expect(deriveRegistryPath('aws_')).toBe('');
  });
});

describe('assembleClassicApiMapping', () => {
  it('produces correct structure with known S3 and EC2 inputs', () => {
    const serviceResources = new Map<string, ResourceApiMapping[]>();
    serviceResources.set('s3', [
      {
        terraformType: 'aws_s3_bucket',
        sdkService: 'S3',
        apiOperations: ['CreateBucket', 'PutBucketPolicy', 'DeleteBucket', 'HeadBucket'],
      },
    ]);
    serviceResources.set('ec2', [
      {
        terraformType: 'aws_instance',
        sdkService: 'EC2',
        apiOperations: ['RunInstances', 'DescribeInstances', 'TerminateInstances'],
      },
    ]);

    const result = assembleClassicApiMapping({
      serviceResources,
      commitSha: 'abc123def456',
    });

    // Verify resources
    expect(result.resources).toHaveLength(2);

    const s3Resource = result.resources.find((r) => r.terraformType === 'aws_s3_bucket');
    expect(s3Resource).toBeDefined();
    expect(s3Resource!.sdkService).toBe('S3');
    expect(s3Resource!.requiredApis).toEqual(['CreateBucket', 'PutBucketPolicy', 'DeleteBucket', 'HeadBucket']);
    expect(s3Resource!.registryPath).toBe('s3_bucket');

    const ec2Resource = result.resources.find((r) => r.terraformType === 'aws_instance');
    expect(ec2Resource).toBeDefined();
    expect(ec2Resource!.sdkService).toBe('EC2');
    expect(ec2Resource!.requiredApis).toEqual(['RunInstances', 'DescribeInstances', 'TerminateInstances']);
    expect(ec2Resource!.registryPath).toBe('instance');
  });

  it('populates metadata fields correctly', () => {
    const serviceResources = new Map<string, ResourceApiMapping[]>();
    serviceResources.set('s3', [
      { terraformType: 'aws_s3_bucket', sdkService: 'S3', apiOperations: ['CreateBucket'] },
      { terraformType: 'aws_s3_bucket_policy', sdkService: 'S3', apiOperations: ['PutBucketPolicy'] },
    ]);
    serviceResources.set('ec2', [
      { terraformType: 'aws_instance', sdkService: 'EC2', apiOperations: ['RunInstances'] },
    ]);

    const result = assembleClassicApiMapping({
      serviceResources,
      commitSha: 'commit-sha-123',
    });

    // generatedAt is a valid ISO string
    expect(() => new Date(result.metadata.generatedAt).toISOString()).not.toThrow();
    expect(new Date(result.metadata.generatedAt).toISOString()).toBe(result.metadata.generatedAt);

    // providerCommitSha matches input
    expect(result.metadata.providerCommitSha).toBe('commit-sha-123');

    // resourceCount is correct
    expect(result.metadata.resourceCount).toBe(3);

    // serviceCount is correct (S3 and EC2 = 2 distinct services)
    expect(result.metadata.serviceCount).toBe(2);
  });

  it('counts distinct services correctly when multiple resources share a service', () => {
    const serviceResources = new Map<string, ResourceApiMapping[]>();
    serviceResources.set('s3', [
      { terraformType: 'aws_s3_bucket', sdkService: 'S3', apiOperations: ['CreateBucket'] },
      { terraformType: 'aws_s3_bucket_policy', sdkService: 'S3', apiOperations: ['PutBucketPolicy'] },
      { terraformType: 'aws_s3_object', sdkService: 'S3', apiOperations: ['PutObject'] },
    ]);

    const result = assembleClassicApiMapping({
      serviceResources,
      commitSha: 'sha123',
    });

    expect(result.metadata.resourceCount).toBe(3);
    expect(result.metadata.serviceCount).toBe(1); // All S3
  });

  it('produces empty resources array with empty input', () => {
    const serviceResources = new Map<string, ResourceApiMapping[]>();

    const result = assembleClassicApiMapping({
      serviceResources,
      commitSha: 'empty-sha',
    });

    expect(result.resources).toEqual([]);
    expect(result.metadata.resourceCount).toBe(0);
    expect(result.metadata.serviceCount).toBe(0);
    expect(result.metadata.providerCommitSha).toBe('empty-sha');
  });

  it('derives registryPath correctly for various terraform types', () => {
    const serviceResources = new Map<string, ResourceApiMapping[]>();
    serviceResources.set('mixed', [
      { terraformType: 'aws_s3_bucket', sdkService: 'S3', apiOperations: [] },
      { terraformType: 'aws_instance', sdkService: 'EC2', apiOperations: [] },
      { terraformType: 'aws_lambda_function', sdkService: 'Lambda', apiOperations: [] },
      { terraformType: 'aws_iam_role', sdkService: 'IAM', apiOperations: [] },
      { terraformType: 'aws_vpc', sdkService: 'EC2', apiOperations: [] },
    ]);

    const result = assembleClassicApiMapping({
      serviceResources,
      commitSha: 'sha456',
    });

    const registryPaths = result.resources.map((r) => r.registryPath);
    expect(registryPaths).toContain('s3_bucket');
    expect(registryPaths).toContain('instance');
    expect(registryPaths).toContain('lambda_function');
    expect(registryPaths).toContain('iam_role');
    expect(registryPaths).toContain('vpc');
  });
});
