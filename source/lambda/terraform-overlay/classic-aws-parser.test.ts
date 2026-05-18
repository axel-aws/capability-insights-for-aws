import { describe, it, expect } from 'vitest';
import { parseSdkResourceAnnotation, parseGoSourceFile } from './classic-aws-parser';

describe('parseSdkResourceAnnotation', () => {
  it('parses annotation with cfnType', () => {
    const result = parseSdkResourceAnnotation(
      '@SDKResource("aws_instance", name="Instance", cfnType="AWS::EC2::Instance")'
    );
    expect(result).toEqual({
      terraformType: 'aws_instance',
      cfnType: 'AWS::EC2::Instance',
    });
  });

  it('parses annotation without cfnType and returns null cfnType', () => {
    const result = parseSdkResourceAnnotation(
      '@SDKResource("aws_s3_bucket", name="Bucket")'
    );
    expect(result).toEqual({
      terraformType: 'aws_s3_bucket',
      cfnType: null,
    });
  });

  it('returns null for non-annotation string', () => {
    expect(parseSdkResourceAnnotation('not an annotation')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSdkResourceAnnotation('')).toBeNull();
  });

  it('parses annotation with spaces around cfnType equals sign', () => {
    const result = parseSdkResourceAnnotation(
      '@SDKResource("aws_vpc", name="VPC", cfnType = "AWS::EC2::VPC")'
    );
    expect(result).toEqual({
      terraformType: 'aws_vpc',
      cfnType: 'AWS::EC2::VPC',
    });
  });
});

describe('parseGoSourceFile', () => {
  it('parses multiple annotations in one file', () => {
    const content = `package ec2

// @SDKResource("aws_instance", name="Instance", cfnType="AWS::EC2::Instance")
func resourceInstance() {}

// @SDKResource("aws_vpc", name="VPC", cfnType="AWS::EC2::VPC")
func resourceVPC() {}
`;
    const result = parseGoSourceFile(content);
    expect(result).toEqual([
      { terraformType: 'aws_instance', cfnType: 'AWS::EC2::Instance' },
      { terraformType: 'aws_vpc', cfnType: 'AWS::EC2::VPC' },
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(parseGoSourceFile('')).toEqual([]);
  });

  it('returns empty array for file with no annotations', () => {
    const content = `package main

func main() {}
`;
    expect(parseGoSourceFile(content)).toEqual([]);
  });

  it('handles mix of annotations with and without cfnType', () => {
    const content = `package s3

// @SDKResource("aws_s3_bucket", name="Bucket")
func resourceBucket() {}

// @SDKResource("aws_s3_bucket_acl", name="BucketACL", cfnType="AWS::S3::BucketPolicy")
func resourceBucketACL() {}
`;
    const result = parseGoSourceFile(content);
    expect(result).toEqual([
      { terraformType: 'aws_s3_bucket', cfnType: null },
      { terraformType: 'aws_s3_bucket_acl', cfnType: 'AWS::S3::BucketPolicy' },
    ]);
  });
});
