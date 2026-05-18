import { describe, it, expect, beforeEach } from 'vitest';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import {
  serializeClassicApiMapping,
  deserializeClassicApiMapping,
  writeClassicApiMappingToS3,
} from './classic-api-mapping-writer';
import type { ClassicApiMappingData } from '../../shared/types/terraform-classic-api-mapping';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

const sampleData: ClassicApiMappingData = {
  metadata: {
    generatedAt: '2025-01-15T10:30:00.000Z',
    providerCommitSha: 'abc123def456',
    resourceCount: 2,
    serviceCount: 2,
  },
  resources: [
    {
      terraformType: 'aws_s3_bucket',
      sdkService: 'S3',
      requiredApis: ['CreateBucket', 'PutBucketPolicy', 'DeleteBucket', 'HeadBucket'],
      registryPath: 's3_bucket',
    },
    {
      terraformType: 'aws_instance',
      sdkService: 'EC2',
      requiredApis: ['RunInstances', 'DescribeInstances', 'TerminateInstances'],
      registryPath: 'instance',
    },
  ],
};

describe('serializeClassicApiMapping', () => {
  it('produces valid JSON', () => {
    const json = serializeClassicApiMapping(sampleData);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('produces JSON with correct structure', () => {
    const json = serializeClassicApiMapping(sampleData);
    const parsed = JSON.parse(json);

    expect(parsed.metadata).toBeDefined();
    expect(parsed.metadata.generatedAt).toBe('2025-01-15T10:30:00.000Z');
    expect(parsed.metadata.providerCommitSha).toBe('abc123def456');
    expect(parsed.metadata.resourceCount).toBe(2);
    expect(parsed.metadata.serviceCount).toBe(2);
    expect(parsed.resources).toHaveLength(2);
  });

  it('round-trips correctly with deserialize', () => {
    const json = serializeClassicApiMapping(sampleData);
    const parsed = deserializeClassicApiMapping(json);
    expect(parsed).toEqual(sampleData);
  });

  it('uses 2-space indentation', () => {
    const json = serializeClassicApiMapping(sampleData);
    // JSON.stringify with 2-space indent produces lines starting with "  "
    const lines = json.split('\n');
    // Second line should start with 2 spaces (first level indent)
    expect(lines[1]).toMatch(/^ {2}/);
  });
});

describe('deserializeClassicApiMapping', () => {
  it('parses valid JSON correctly', () => {
    const json = JSON.stringify(sampleData);
    const result = deserializeClassicApiMapping(json);

    expect(result.metadata.generatedAt).toBe('2025-01-15T10:30:00.000Z');
    expect(result.metadata.providerCommitSha).toBe('abc123def456');
    expect(result.metadata.resourceCount).toBe(2);
    expect(result.metadata.serviceCount).toBe(2);
    expect(result.resources).toHaveLength(2);
    expect(result.resources[0].terraformType).toBe('aws_s3_bucket');
  });

  it('throws on malformed JSON', () => {
    expect(() => deserializeClassicApiMapping('not valid json')).toThrow();
  });

  it('throws on missing metadata field', () => {
    const invalid = JSON.stringify({ resources: [] });
    expect(() => deserializeClassicApiMapping(invalid)).toThrow(
      'Invalid ClassicApiMappingData: missing required fields (metadata, resources)',
    );
  });

  it('throws on missing resources field', () => {
    const invalid = JSON.stringify({ metadata: { generatedAt: '', providerCommitSha: '', resourceCount: 0, serviceCount: 0 } });
    expect(() => deserializeClassicApiMapping(invalid)).toThrow(
      'Invalid ClassicApiMappingData: missing required fields (metadata, resources)',
    );
  });

  it('throws on resources not being an array', () => {
    const invalid = JSON.stringify({
      metadata: { generatedAt: '', providerCommitSha: '', resourceCount: 0, serviceCount: 0 },
      resources: 'not-an-array',
    });
    expect(() => deserializeClassicApiMapping(invalid)).toThrow(
      'Invalid ClassicApiMappingData: missing required fields (metadata, resources)',
    );
  });
});

describe('writeClassicApiMappingToS3', () => {
  it('calls S3 PutObject with correct bucket, key, and content type', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await writeClassicApiMappingToS3({
      data: sampleData,
      bucketName: 'test-bucket',
      s3Client: new S3Client({}),
    });

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);

    const input = calls[0].args[0].input;
    expect(input.Bucket).toBe('test-bucket');
    expect(input.Key).toBe('data/json/terraform_classic_api_mapping.json');
    expect(input.ContentType).toBe('application/json');
  });

  it('writes serialized data as the Body', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await writeClassicApiMappingToS3({
      data: sampleData,
      bucketName: 'my-bucket',
      s3Client: new S3Client({}),
    });

    const calls = s3Mock.commandCalls(PutObjectCommand);
    const body = calls[0].args[0].input.Body as string;

    // Body should be valid JSON that matches the input data
    const parsed = JSON.parse(body);
    expect(parsed).toEqual(sampleData);
  });

  it('writes with 2-space indented JSON', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await writeClassicApiMappingToS3({
      data: sampleData,
      bucketName: 'my-bucket',
      s3Client: new S3Client({}),
    });

    const calls = s3Mock.commandCalls(PutObjectCommand);
    const body = calls[0].args[0].input.Body as string;

    // Should match the output of serializeClassicApiMapping
    expect(body).toBe(serializeClassicApiMapping(sampleData));
  });
});
