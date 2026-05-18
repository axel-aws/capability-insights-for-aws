import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import type { GitHubClient, TreeEntry, DirectoryEntry } from './github-client';
import type { FetchResult } from './concurrent-fetcher';
import type { TerraformOverlayData } from '../../shared/types/terraform-overlay';

// Mock the github-client module
vi.mock('./github-client', () => ({
  createGitHubClient: vi.fn(),
}));

// Mock the concurrent-fetcher module
vi.mock('./concurrent-fetcher', () => ({
  fetchFilesConcurrently: vi.fn(),
}));

import { createGitHubClient } from './github-client';
import { fetchFilesConcurrently } from './concurrent-fetcher';
import { handler, deriveClassicAwsFromAwscc, factoryNameToFilename } from './handler';

const s3Mock = mockClient(S3Client);
const mockedCreateGitHubClient = vi.mocked(createGitHubClient);
const mockedFetchFilesConcurrently = vi.mocked(fetchFilesConcurrently);

/** Realistic AWSCC schema tree entries */
const awsccTreeEntries: TreeEntry[] = [
  { path: 'internal/service/cloudformation/schemas/AWS_S3_Bucket.json', type: 'blob', sha: 'aaa111' },
  { path: 'internal/service/cloudformation/schemas/AWS_EC2_Instance.json', type: 'blob', sha: 'aaa222' },
  { path: 'internal/service/cloudformation/schemas/AWS_Lambda_Function.json', type: 'blob', sha: 'aaa333' },
];

/** Classic AWS provider tree entries including service_package_gen.go files */
const classicAwsTreeEntries: TreeEntry[] = [
  { path: 'internal/service/s3/service_package_gen.go', type: 'blob', sha: 'bbb111' },
  { path: 'internal/service/ec2/service_package_gen.go', type: 'blob', sha: 'bbb222' },
  { path: 'internal/service/s3/resource_bucket.go', type: 'blob', sha: 'bbb333' },
  { path: 'internal/service/ec2/resource_instance.go', type: 'blob', sha: 'bbb444' },
];

/** Classic AWS service directory listing (from Contents API) */
const classicAwsServiceDirectories: DirectoryEntry[] = [
  { name: 's3', path: 'internal/service/s3', type: 'dir' },
  { name: 'ec2', path: 'internal/service/ec2', type: 'dir' },
];

/** JSON content for AWSCC schema files */
const awsccSchemaContents: Record<string, string> = {
  'internal/service/cloudformation/schemas/AWS_S3_Bucket.json': JSON.stringify({ typeName: 'AWS::S3::Bucket' }),
  'internal/service/cloudformation/schemas/AWS_EC2_Instance.json': JSON.stringify({ typeName: 'AWS::EC2::Instance' }),
  'internal/service/cloudformation/schemas/AWS_Lambda_Function.json': JSON.stringify({
    typeName: 'AWS::Lambda::Function',
  }),
};

/** Mock service_package_gen.go content */
const s3ServicePackageContent = `
package s3

func (p *servicePackage) Resources() []servicepackage.Resource {
  return []servicepackage.Resource{
    {
      Factory:  resourceBucket,
      TypeName: "aws_s3_bucket",
      Name:     "Bucket",
    },
  }
}
`;

const ec2ServicePackageContent = `
package ec2

func (p *servicePackage) Resources() []servicepackage.Resource {
  return []servicepackage.Resource{
    {
      Factory:  resourceInstance,
      TypeName: "aws_instance",
      Name:     "Instance",
    },
  }
}
`;

/** Mock resource Go file content */
const s3BucketGoContent = `
package s3

func resourceBucket() *schema.Resource {
  return &schema.Resource{}
}

func resourceBucketCreate(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Client()
  conn.CreateBucket(input)
  conn.PutBucketPolicy(input)
  return nil
}
`;

const ec2InstanceGoContent = `
package ec2

func resourceInstance() *schema.Resource {
  return &schema.Resource{}
}

func resourceInstanceCreate(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).EC2Client()
  conn.RunInstances(input)
  conn.DescribeInstances(input)
  return nil
}
`;

/** Default fetch results for AWSCC concurrent fetcher */
function createAwsccFetchResults(): FetchResult<string>[] {
  return awsccTreeEntries.map((entry) => ({
    path: entry.path,
    result: awsccSchemaContents[entry.path] ?? null,
  }));
}

/** Default fetch results for classic AWS service_package_gen.go files */
function createServicePackageFetchResults(): FetchResult<string>[] {
  return [
    { path: 'internal/service/s3/service_package_gen.go', result: s3ServicePackageContent },
    { path: 'internal/service/ec2/service_package_gen.go', result: ec2ServicePackageContent },
  ];
}

/** Default fetch results for classic AWS resource Go files */
function createResourceGoFileFetchResults(): FetchResult<string>[] {
  return [
    { path: 'internal/service/s3/resource_bucket.go', result: s3BucketGoContent },
    { path: 'internal/service/ec2/resource_instance.go', result: ec2InstanceGoContent },
  ];
}

/** Default fetch results for service directory file listings */
function createServiceDirectoryListResults(): FetchResult<DirectoryEntry[]>[] {
  return [
    {
      path: 'internal/service/s3',
      result: [
        { name: 'resource_bucket.go', path: 'internal/service/s3/resource_bucket.go', type: 'file' },
        { name: 'service_package_gen.go', path: 'internal/service/s3/service_package_gen.go', type: 'file' },
      ],
    },
    {
      path: 'internal/service/ec2',
      result: [
        { name: 'resource_instance.go', path: 'internal/service/ec2/resource_instance.go', type: 'file' },
        { name: 'service_package_gen.go', path: 'internal/service/ec2/service_package_gen.go', type: 'file' },
      ],
    },
  ];
}

const AWSCC_COMMIT_SHA = 'abc123def456abc123def456abc123def456abc1';
const CLASSIC_AWS_COMMIT_SHA = 'def456abc123def456abc123def456abc123def4';

function createMockGitHubClient(overrides?: Partial<GitHubClient>): GitHubClient {
  return {
    getLatestCommitSha: vi.fn()
      .mockResolvedValueOnce(AWSCC_COMMIT_SHA)   // First call: AWSCC
      .mockResolvedValueOnce(CLASSIC_AWS_COMMIT_SHA), // Second call: classic AWS
    getTree: vi.fn()
      .mockResolvedValueOnce(awsccTreeEntries),      // Only call: AWSCC
    listDirectory: vi.fn()
      .mockResolvedValueOnce(classicAwsServiceDirectories), // Only call: classic AWS
    getFileContent: vi.fn().mockResolvedValue(''),
    ...overrides,
  };
}

beforeEach(() => {
  s3Mock.reset();
  vi.clearAllMocks();
  // Default: AWSCC schemas, service packages, service directory listings, resource Go files
  mockedFetchFilesConcurrently
    .mockResolvedValueOnce(createAwsccFetchResults())
    .mockResolvedValueOnce(createServicePackageFetchResults())
    .mockResolvedValueOnce(createServiceDirectoryListResults())
    .mockResolvedValueOnce(createResourceGoFileFetchResults());
});

describe('deriveClassicAwsFromAwscc', () => {
  it('derives classic AWS mappings by replacing awscc_ prefix with aws_', () => {
    const awsccMappings = [
      { terraformType: 'awscc_s3_bucket', cfnType: 'AWS::S3::Bucket' },
      { terraformType: 'awscc_ec2_instance', cfnType: 'AWS::EC2::Instance' },
    ];

    const result = deriveClassicAwsFromAwscc(awsccMappings);

    expect(result).toEqual([
      { terraformType: 'aws_s3_bucket', cfnType: 'AWS::S3::Bucket' },
      { terraformType: 'aws_ec2_instance', cfnType: 'AWS::EC2::Instance' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(deriveClassicAwsFromAwscc([])).toEqual([]);
  });
});

describe('factoryNameToFilename', () => {
  it('converts camelCase factory name to snake_case', () => {
    expect(factoryNameToFilename('resourceBucket')).toBe('resource_bucket');
  });

  it('handles multiple uppercase letters', () => {
    expect(factoryNameToFilename('resourceS3BucketPolicy')).toBe('resource_s3_bucket_policy');
  });

  it('handles single word', () => {
    expect(factoryNameToFilename('resource')).toBe('resource');
  });

  it('handles leading uppercase', () => {
    expect(factoryNameToFilename('ResourceBucket')).toBe('resource_bucket');
  });
});

describe('handler integration tests', () => {
  describe('full success', () => {
    it('writes correct terraform_overlay.json structure to S3 and returns 200', async () => {
      const mockClient = createMockGitHubClient();
      mockedCreateGitHubClient.mockReturnValue(mockClient);
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await handler({ dataBucketName: 'test-bucket' });

      expect(result.statusCode).toBe(200);
      expect(result.awsccCount).toBe(3);
      expect(result.classicAwsCount).toBe(3);
      expect(result.classicApiMappingCount).toBe(2); // s3_bucket + instance
      expect(result.errors).toBeUndefined();

      // Verify S3 writes occurred (overlay + classic API mapping)
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(2);

      // First write: terraform_overlay.json
      const overlayInput = s3Calls[0].args[0].input;
      expect(overlayInput.Bucket).toBe('test-bucket');
      expect(overlayInput.Key).toBe('data/json/terraform_overlay.json');
      expect(overlayInput.ContentType).toBe('application/json');

      // Verify the written JSON structure
      const writtenData: TerraformOverlayData = JSON.parse(overlayInput.Body as string);

      // Metadata
      expect(writtenData.metadata.awsccProviderCommitSha).toBe(AWSCC_COMMIT_SHA);
      expect(writtenData.metadata.awsccResourceCount).toBe(3);
      expect(writtenData.metadata.classicAwsResourceCount).toBe(3);
      expect(writtenData.metadata.generatedAt).toBeDefined();

      // AWSCC mappings
      expect(writtenData.awscc).toHaveLength(3);
      expect(writtenData.awscc).toContainEqual({ terraformType: 'awscc_s3_bucket', cfnType: 'AWS::S3::Bucket' });
      expect(writtenData.awscc).toContainEqual({ terraformType: 'awscc_ec2_instance', cfnType: 'AWS::EC2::Instance' });
      expect(writtenData.awscc).toContainEqual({ terraformType: 'awscc_lambda_function', cfnType: 'AWS::Lambda::Function' });

      // Classic AWS mappings (derived from AWSCC)
      expect(writtenData.classicAws).toHaveLength(3);
      expect(writtenData.classicAws).toContainEqual({ terraformType: 'aws_s3_bucket', cfnType: 'AWS::S3::Bucket' });
      expect(writtenData.classicAws).toContainEqual({ terraformType: 'aws_ec2_instance', cfnType: 'AWS::EC2::Instance' });
      expect(writtenData.classicAws).toContainEqual({ terraformType: 'aws_lambda_function', cfnType: 'AWS::Lambda::Function' });

      // Second write: terraform_classic_api_mapping.json
      const classicInput = s3Calls[1].args[0].input;
      expect(classicInput.Bucket).toBe('test-bucket');
      expect(classicInput.Key).toBe('data/json/terraform_classic_api_mapping.json');
      expect(classicInput.ContentType).toBe('application/json');
    });

    it('makes GitHub API calls for both AWSCC and classic AWS providers', async () => {
      const mockClient = createMockGitHubClient();
      mockedCreateGitHubClient.mockReturnValue(mockClient);
      s3Mock.on(PutObjectCommand).resolves({});

      await handler({ dataBucketName: 'test-bucket' });

      // Should call getLatestCommitSha twice (AWSCC + classic AWS)
      expect(mockClient.getLatestCommitSha).toHaveBeenCalledTimes(2);
      // Should call getTree once (AWSCC only) and listDirectory once (classic AWS)
      expect(mockClient.getTree).toHaveBeenCalledTimes(1);
      expect(mockClient.listDirectory).toHaveBeenCalledTimes(1);
      // fetchFilesConcurrently called 4 times: AWSCC schemas, service packages, directory listings, resource Go files
      expect(mockedFetchFilesConcurrently).toHaveBeenCalledTimes(4);

      // First call: AWSCC schema paths
      const awsccPaths = mockedFetchFilesConcurrently.mock.calls[0][0];
      expect(awsccPaths).toHaveLength(3);
      expect(awsccPaths).toContain('internal/service/cloudformation/schemas/AWS_S3_Bucket.json');

      // Second call: service_package_gen.go paths
      const servicePackagePaths = mockedFetchFilesConcurrently.mock.calls[1][0];
      expect(servicePackagePaths).toHaveLength(2);
      expect(servicePackagePaths).toContain('internal/service/s3/service_package_gen.go');
      expect(servicePackagePaths).toContain('internal/service/ec2/service_package_gen.go');

      // Third call: service directory listings
      const dirListPaths = mockedFetchFilesConcurrently.mock.calls[2][0];
      expect(dirListPaths).toHaveLength(2);
      expect(dirListPaths).toContain('internal/service/s3');
      expect(dirListPaths).toContain('internal/service/ec2');

      // Fourth call: resource Go file paths
      const resourcePaths = mockedFetchFilesConcurrently.mock.calls[3][0];
      expect(resourcePaths).toHaveLength(2);
    });
  });

  describe('AWSCC fetch failure', () => {
    it('does NOT write to S3 and returns 500 when AWSCC fetch fails', async () => {
      const mockClient = createMockGitHubClient({
        getLatestCommitSha: vi.fn().mockRejectedValue(new Error('GitHub API unreachable')),
      });
      mockedCreateGitHubClient.mockReturnValue(mockClient);

      const result = await handler({ dataBucketName: 'test-bucket' });

      expect(result.statusCode).toBe(500);
      expect(result.awsccCount).toBe(0);
      expect(result.classicAwsCount).toBe(0);
      expect(result.classicApiMappingCount).toBe(0);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('AWSCC fetch failed');

      // Verify NO S3 write occurred — existing file is retained
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(0);
    });
  });

  describe('S3 write failure', () => {
    it('returns 500 with error when S3 PutObject throws for overlay', async () => {
      const mockClient = createMockGitHubClient();
      mockedCreateGitHubClient.mockReturnValue(mockClient);
      s3Mock.on(PutObjectCommand).rejects(new Error('Access Denied'));

      const result = await handler({ dataBucketName: 'test-bucket' });

      expect(result.statusCode).toBe(500);
      expect(result.awsccCount).toBe(3);
      expect(result.classicAwsCount).toBe(3);
      expect(result.classicApiMappingCount).toBe(0);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.includes('S3 write failed'))).toBe(true);
    });
  });

  describe('classic API mapping failure isolation', () => {
    it('returns 200 with errors when classic API mapping fails but AWSCC succeeds', async () => {
      // Override fetchFilesConcurrently for this test — only AWSCC fetch happens
      mockedFetchFilesConcurrently.mockReset();
      mockedFetchFilesConcurrently.mockResolvedValueOnce(createAwsccFetchResults());

      // Classic AWS getLatestCommitSha fails on second call
      const mockClient = createMockGitHubClient({
        getLatestCommitSha: vi.fn()
          .mockResolvedValueOnce(AWSCC_COMMIT_SHA)
          .mockRejectedValueOnce(new Error('Classic AWS fetch failed')),
        getTree: vi.fn().mockResolvedValueOnce(awsccTreeEntries),
        listDirectory: vi.fn().mockRejectedValueOnce(new Error('Classic AWS fetch failed')),
      });
      mockedCreateGitHubClient.mockReturnValue(mockClient);
      s3Mock.on(PutObjectCommand).resolves({});

      const result = await handler({ dataBucketName: 'test-bucket' });

      // AWSCC overlay still succeeds — status 200
      expect(result.statusCode).toBe(200);
      expect(result.awsccCount).toBe(3);
      expect(result.classicAwsCount).toBe(3);
      expect(result.classicApiMappingCount).toBe(0);
      // Error is recorded but doesn't affect status code
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.includes('Classic API mapping failed'))).toBe(true);

      // Overlay S3 write still occurred
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls).toHaveLength(1);
      expect(s3Calls[0].args[0].input.Key).toBe('data/json/terraform_overlay.json');
    });
  });
});
