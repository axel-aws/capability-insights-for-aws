import { describe, it, expect } from 'vitest';
import {
  parseAwsccSchemaFilename,
  parseAwsccSchemaContent,
  cfnTypeToAwscc,
  awsccToCfnType,
} from './awscc-parser';

describe('parseAwsccSchemaFilename', () => {
  it('parses AWS_S3_Bucket.json correctly', () => {
    const result = parseAwsccSchemaFilename('AWS_S3_Bucket.json');
    expect(result).toEqual({
      terraformType: 'awscc_s3_bucket',
      cfnType: 'AWS::S3::Bucket',
    });
  });

  it('parses AWS_EC2_Instance.json correctly', () => {
    const result = parseAwsccSchemaFilename('AWS_EC2_Instance.json');
    expect(result).toEqual({
      terraformType: 'awscc_ec2_instance',
      cfnType: 'AWS::EC2::Instance',
    });
  });

  it('returns null for empty string', () => {
    expect(parseAwsccSchemaFilename('')).toBeNull();
  });

  it('returns null for invalid filename without .json suffix', () => {
    expect(parseAwsccSchemaFilename('invalid')).toBeNull();
  });

  it('returns null for filename missing .json suffix', () => {
    expect(parseAwsccSchemaFilename('AWS_S3_Bucket')).toBeNull();
  });

  it('returns null for filename missing AWS_ prefix', () => {
    expect(parseAwsccSchemaFilename('S3_Bucket.json')).toBeNull();
  });

  it('returns null for filename with only 2 parts (need at least 3)', () => {
    expect(parseAwsccSchemaFilename('AWS_S3.json')).toBeNull();
  });
});

describe('cfnTypeToAwscc', () => {
  it('converts AWS::S3::Bucket to awscc_s3_bucket', () => {
    expect(cfnTypeToAwscc('AWS::S3::Bucket')).toBe('awscc_s3_bucket');
  });

  it('converts AWS::EC2::Instance to awscc_ec2_instance', () => {
    expect(cfnTypeToAwscc('AWS::EC2::Instance')).toBe('awscc_ec2_instance');
  });
});

describe('awsccToCfnType', () => {
  it('converts awscc_s3_bucket to AWS::S3::Bucket', () => {
    expect(awsccToCfnType('awscc_s3_bucket')).toBe('AWS::S3::Bucket');
  });

  it('converts awscc_ec2_instance to AWS::Ec2::Instance (best-effort capitalization)', () => {
    expect(awsccToCfnType('awscc_ec2_instance')).toBe('AWS::Ec2::Instance');
  });
});

describe('parseAwsccSchemaContent', () => {
  it('parses JSON content with typeName "AWS::S3::Bucket" correctly', () => {
    const content = JSON.stringify({
      typeName: 'AWS::S3::Bucket',
      description: 'The AWS::S3::Bucket resource creates an S3 bucket.',
      properties: { BucketName: { type: 'string' } },
    });

    const result = parseAwsccSchemaContent(content);

    expect(result).toEqual({
      terraformType: 'awscc_s3_bucket',
      cfnType: 'AWS::S3::Bucket',
    });
  });

  it('parses JSON content with typeName "AWS::EC2::Instance" correctly', () => {
    const content = JSON.stringify({
      typeName: 'AWS::EC2::Instance',
      description: 'An EC2 instance.',
      properties: {},
    });

    const result = parseAwsccSchemaContent(content);

    expect(result).toEqual({
      terraformType: 'awscc_ec2_instance',
      cfnType: 'AWS::EC2::Instance',
    });
  });

  it('handles typeName with unusual casing (AWS::IoT::Thing)', () => {
    const content = JSON.stringify({
      typeName: 'AWS::IoT::Thing',
      description: 'An IoT thing.',
      properties: {},
    });

    const result = parseAwsccSchemaContent(content);

    expect(result).toEqual({
      terraformType: 'awscc_iot_thing',
      cfnType: 'AWS::IoT::Thing',
    });
  });

  it('handles typeName with mixed casing (AWS::DynamoDB::Table)', () => {
    const content = JSON.stringify({
      typeName: 'AWS::DynamoDB::Table',
      description: 'A DynamoDB table.',
      properties: {},
    });

    const result = parseAwsccSchemaContent(content);

    expect(result).toEqual({
      terraformType: 'awscc_dynamodb_table',
      cfnType: 'AWS::DynamoDB::Table',
    });
  });

  it('returns null for missing typeName field', () => {
    const content = JSON.stringify({
      description: 'No typeName here.',
      properties: {},
    });

    expect(parseAwsccSchemaContent(content)).toBeNull();
  });

  it('returns null when typeName is not a string', () => {
    const content = JSON.stringify({
      typeName: 123,
      description: 'typeName is a number.',
      properties: {},
    });

    expect(parseAwsccSchemaContent(content)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseAwsccSchemaContent('{ not valid json')).toBeNull();
  });

  it('returns null for empty content', () => {
    expect(parseAwsccSchemaContent('')).toBeNull();
  });

  it('returns null when typeName does not match AWS::Service::Resource pattern', () => {
    const content = JSON.stringify({
      typeName: 'NotAWS::Something',
      properties: {},
    });

    expect(parseAwsccSchemaContent(content)).toBeNull();
  });

  it('returns null when typeName has only two segments', () => {
    const content = JSON.stringify({
      typeName: 'AWS::S3',
      properties: {},
    });

    expect(parseAwsccSchemaContent(content)).toBeNull();
  });
});
