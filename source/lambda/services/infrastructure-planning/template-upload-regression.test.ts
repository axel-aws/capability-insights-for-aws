/**
 * Regression tests for template upload flows.
 *
 * These tests verify that the PlanProcessor's `processCloudFormation` and `processTerraform`
 * methods work end-to-end without making external network calls. They ensure that:
 * 1. CloudFormation JSON templates are parsed correctly
 * 2. CloudFormation YAML templates are parsed correctly
 * 3. Terraform templates work with S3 overlay fetch (mocked)
 * 4. Invalid templates produce appropriate errors (not network errors)
 * 5. No external HTTP/fetch calls are made during CFN processing
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlanProcessor } from './plan-processor';
import type { TerraformOverlayData } from '../../../shared/types/terraform-overlay';

// --- Test Helpers ---

/**
 * Creates a PlanProcessor with mocked dependencies suitable for template upload testing.
 * The getOverlayData mock simulates fetching overlay data from S3 via VPC endpoint.
 */
function createTestProcessor(overlayData?: TerraformOverlayData): PlanProcessor {
  const defaultOverlay: TerraformOverlayData = {
    metadata: {
      generatedAt: '2025-01-01T00:00:00Z',
      awsccProviderCommitSha: 'abc123',
      classicAwsProviderCommitSha: 'def456',
      awsccResourceCount: 100,
      classicAwsResourceCount: 200,
    },
    awscc: [
      { terraformType: 'awscc_s3_bucket', cfnType: 'AWS::S3::Bucket' },
      { terraformType: 'awscc_lambda_function', cfnType: 'AWS::Lambda::Function' },
    ],
    classicAws: [
      { terraformType: 'aws_s3_bucket', cfnType: 'AWS::S3::Bucket' },
      { terraformType: 'aws_lambda_function', cfnType: 'AWS::Lambda::Function' },
      { terraformType: 'aws_dynamodb_table', cfnType: 'AWS::DynamoDB::Table' },
      { terraformType: 'aws_sqs_queue', cfnType: 'AWS::SQS::Queue' },
      { terraformType: 'aws_sns_topic', cfnType: 'AWS::SNS::Topic' },
      { terraformType: 'aws_iam_role', cfnType: 'AWS::IAM::Role' },
    ],
  };

  return new PlanProcessor({
    getOverlayData: async () => overlayData ?? defaultOverlay,
    getGitHubPat: async () => 'unused-pat',
    invokeGitHubFetch: async () => {
      throw new Error('GitHub fetch should not be called during template upload');
    },
  });
}

/**
 * Encodes a string to base64 (simulating what the frontend sends).
 */
function toBase64(content: string): string {
  return Buffer.from(content, 'utf8').toString('base64');
}

// --- Test Data ---

const VALID_CFN_JSON_TEMPLATE = JSON.stringify({
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Test CloudFormation template',
  Resources: {
    MyBucket: {
      Type: 'AWS::S3::Bucket',
      Properties: {
        BucketName: 'my-test-bucket',
      },
    },
    MyFunction: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        FunctionName: 'my-function',
        Runtime: 'nodejs20.x',
        Handler: 'index.handler',
      },
    },
    MyTable: {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: 'my-table',
        AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      },
    },
  },
});

const VALID_CFN_YAML_TEMPLATE = `AWSTemplateFormatVersion: '2010-09-09'
Description: Test CloudFormation YAML template
Resources:
  MyQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: my-queue
  MyTopic:
    Type: AWS::SNS::Topic
    Properties:
      TopicName: my-topic
  MyRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: my-role
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: lambda.amazonaws.com
            Action: sts:AssumeRole
`;

const VALID_TERRAFORM_TEMPLATE = `
provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "main" {
  bucket = "my-terraform-bucket"
}

resource "aws_lambda_function" "processor" {
  function_name = "my-processor"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.lambda_role.arn
}

resource "aws_iam_role" "lambda_role" {
  name = "lambda-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

data "aws_caller_identity" "current" {}
`;

// --- Tests ---

describe('Template Upload Regression Tests', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Save original fetch and replace with a spy that should NOT be called
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(() => {
      throw new Error('REGRESSION: Unexpected fetch() call during template processing');
    });
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('CloudFormation JSON template upload', () => {
    it('processes a valid JSON CFN template end-to-end without network calls', async () => {
      const processor = createTestProcessor();

      const result = await processor.process({
        planName: 'json-cfn-plan',
        sourceType: 'cloudformation',
        templateContent: toBase64(VALID_CFN_JSON_TEMPLATE),
      });

      // Verify correct resource types extracted
      expect(result.cfnResourceTypes).toContain('AWS::S3::Bucket');
      expect(result.cfnResourceTypes).toContain('AWS::Lambda::Function');
      expect(result.cfnResourceTypes).toContain('AWS::DynamoDB::Table');
      expect(result.cfnResourceTypes).toHaveLength(3);

      // Verify service names derived
      expect(result.serviceNames).toContain('S3');
      expect(result.serviceNames).toContain('Lambda');
      expect(result.serviceNames).toContain('DynamoDB');

      // Verify no terraform types (this is a CFN template)
      expect(result.terraformResourceTypes).toEqual([]);
      expect(result.terraformToCfnMapping).toEqual({});

      // Verify fetch was NOT called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('CloudFormation YAML template upload', () => {
    it('processes a valid YAML CFN template end-to-end without network calls', async () => {
      const processor = createTestProcessor();

      const result = await processor.process({
        planName: 'yaml-cfn-plan',
        sourceType: 'cloudformation',
        templateContent: toBase64(VALID_CFN_YAML_TEMPLATE),
      });

      // Verify correct resource types extracted
      expect(result.cfnResourceTypes).toContain('AWS::SQS::Queue');
      expect(result.cfnResourceTypes).toContain('AWS::SNS::Topic');
      expect(result.cfnResourceTypes).toContain('AWS::IAM::Role');
      expect(result.cfnResourceTypes).toHaveLength(3);

      // Verify service names derived
      expect(result.serviceNames).toContain('SQS');
      expect(result.serviceNames).toContain('SNS');
      expect(result.serviceNames).toContain('IAM');

      // Verify no terraform types
      expect(result.terraformResourceTypes).toEqual([]);
      expect(result.terraformToCfnMapping).toEqual({});

      // Verify fetch was NOT called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Terraform template upload with S3 overlay fetch', () => {
    it('processes a valid Terraform template with overlay mapping', async () => {
      const processor = createTestProcessor();

      const result = await processor.process({
        planName: 'terraform-plan',
        sourceType: 'terraform',
        templateContent: toBase64(VALID_TERRAFORM_TEMPLATE),
      });

      // Verify terraform resource types extracted
      expect(result.terraformResourceTypes).toContain('aws_s3_bucket');
      expect(result.terraformResourceTypes).toContain('aws_lambda_function');
      expect(result.terraformResourceTypes).toContain('aws_iam_role');
      expect(result.terraformResourceTypes).toHaveLength(3);

      // Verify CFN types mapped via overlay
      expect(result.cfnResourceTypes).toContain('AWS::S3::Bucket');
      expect(result.cfnResourceTypes).toContain('AWS::Lambda::Function');
      expect(result.cfnResourceTypes).toContain('AWS::IAM::Role');

      // Verify terraform-to-CFN mapping populated
      expect(result.terraformToCfnMapping['aws_s3_bucket']).toBe('AWS::S3::Bucket');
      expect(result.terraformToCfnMapping['aws_lambda_function']).toBe('AWS::Lambda::Function');
      expect(result.terraformToCfnMapping['aws_iam_role']).toBe('AWS::IAM::Role');

      // Verify service names derived from CFN types
      expect(result.serviceNames).toContain('S3');
      expect(result.serviceNames).toContain('Lambda');
      expect(result.serviceNames).toContain('IAM');

      // Verify fetch was NOT called (overlay data comes from S3 via VPC endpoint, mocked here)
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Invalid templates produce 400 errors', () => {
    it('rejects invalid JSON content with a parse error', async () => {
      const processor = createTestProcessor();
      const invalidJson = 'this is not valid JSON or YAML { broken [';

      await expect(
        processor.process({
          planName: 'invalid-plan',
          sourceType: 'cloudformation',
          templateContent: toBase64(invalidJson),
        })
      ).rejects.toThrow('Failed to parse template');

      // Verify fetch was NOT called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects YAML content without Resources section', async () => {
      const processor = createTestProcessor();
      const noResources = `
AWSTemplateFormatVersion: '2010-09-09'
Description: Template without Resources
Parameters:
  Env:
    Type: String
    Default: dev
`;

      await expect(
        processor.process({
          planName: 'no-resources-plan',
          sourceType: 'cloudformation',
          templateContent: toBase64(noResources),
        })
      ).rejects.toThrow('Resources');

      // Verify fetch was NOT called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects empty template content', async () => {
      const processor = createTestProcessor();

      await expect(
        processor.process({
          planName: 'empty-plan',
          sourceType: 'cloudformation',
          templateContent: toBase64(''),
        })
      ).rejects.toThrow();

      // Verify fetch was NOT called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects template exceeding 1MB size limit', async () => {
      const processor = createTestProcessor();
      // Create content larger than 1MB (1,048,576 bytes)
      const largeContent = 'x'.repeat(1_100_000);

      await expect(
        processor.process({
          planName: 'large-plan',
          sourceType: 'cloudformation',
          templateContent: toBase64(largeContent),
        })
      ).rejects.toThrow('Template exceeds maximum size of 1MB');

      // Verify fetch was NOT called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects missing templateContent for cloudformation source type', async () => {
      const processor = createTestProcessor();

      await expect(
        processor.process({
          planName: 'missing-content-plan',
          sourceType: 'cloudformation',
        })
      ).rejects.toThrow('Template content is required');

      // Verify fetch was NOT called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('rejects Terraform template with no AWS resource blocks', async () => {
      const processor = createTestProcessor();
      const noAwsResources = `
provider "google" {
  project = "my-project"
}

resource "google_compute_instance" "vm" {
  name         = "test"
  machine_type = "e2-medium"
}
`;

      await expect(
        processor.process({
          planName: 'no-aws-tf-plan',
          sourceType: 'terraform',
          templateContent: toBase64(noAwsResources),
        })
      ).rejects.toThrow('No AWS resources found');

      // Verify fetch was NOT called
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe('No fetch() or HTTP calls during CFN processing', () => {
    it('verifies global.fetch is never invoked during CloudFormation JSON processing', async () => {
      const processor = createTestProcessor();

      await processor.process({
        planName: 'no-fetch-json',
        sourceType: 'cloudformation',
        templateContent: toBase64(VALID_CFN_JSON_TEMPLATE),
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('verifies global.fetch is never invoked during CloudFormation YAML processing', async () => {
      const processor = createTestProcessor();

      await processor.process({
        planName: 'no-fetch-yaml',
        sourceType: 'cloudformation',
        templateContent: toBase64(VALID_CFN_YAML_TEMPLATE),
      });

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('verifies global.fetch is never invoked during Terraform processing', async () => {
      const processor = createTestProcessor();

      await processor.process({
        planName: 'no-fetch-terraform',
        sourceType: 'terraform',
        templateContent: toBase64(VALID_TERRAFORM_TEMPLATE),
      });

      // Terraform processing uses getOverlayData (S3 via VPC endpoint), not fetch
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
