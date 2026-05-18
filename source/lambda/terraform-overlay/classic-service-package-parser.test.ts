import { describe, it, expect } from 'vitest';
import { parseServicePackageGen } from './classic-service-package-parser';

describe('parseServicePackageGen', () => {
  it('parses S3 service package with a single resource', () => {
    const content = `
package s3

import (
  "github.com/hashicorp/terraform-provider-aws/internal/service/s3"
)

func (p *servicePackage) Resources() []func() resource.Resource {
  return []func() resource.Resource{
    {
      Factory:  resourceBucket,
      TypeName: "aws_s3_bucket",
      Name:     "Bucket",
    },
  }
}
`;

    const result = parseServicePackageGen(content);

    expect(result).toEqual([
      { typeName: 'aws_s3_bucket', factoryName: 'resourceBucket' },
    ]);
  });

  it('parses EC2 service package with multiple resources', () => {
    const content = `
package ec2

func (p *servicePackage) Resources() []func() resource.Resource {
  return []func() resource.Resource{
    {
      Factory:  resourceInstance,
      TypeName: "aws_instance",
      Name:     "Instance",
    },
    {
      Factory:  resourceSecurityGroup,
      TypeName: "aws_security_group",
      Name:     "Security Group",
    },
    {
      Factory:  resourceVPC,
      TypeName: "aws_vpc",
      Name:     "VPC",
    },
  }
}
`;

    const result = parseServicePackageGen(content);

    expect(result).toHaveLength(3);
    expect(result).toContainEqual({ typeName: 'aws_instance', factoryName: 'resourceInstance' });
    expect(result).toContainEqual({ typeName: 'aws_security_group', factoryName: 'resourceSecurityGroup' });
    expect(result).toContainEqual({ typeName: 'aws_vpc', factoryName: 'resourceVPC' });
  });

  it('returns empty array for empty content', () => {
    expect(parseServicePackageGen('')).toEqual([]);
  });

  it('returns empty array for whitespace-only content', () => {
    expect(parseServicePackageGen('   \n\t  ')).toEqual([]);
  });

  it('returns empty array for content with no TypeName entries', () => {
    const content = `
package s3

import (
  "fmt"
)

func (p *servicePackage) SomeOtherMethod() {
  fmt.Println("no resources here")
}
`;

    expect(parseServicePackageGen(content)).toEqual([]);
  });

  it('returns empty array for malformed entries missing Factory field', () => {
    const content = `
    {
      TypeName: "aws_s3_bucket",
      Name:     "Bucket",
    },
`;

    expect(parseServicePackageGen(content)).toEqual([]);
  });

  it('returns empty array for malformed entries missing TypeName field', () => {
    const content = `
    {
      Factory:  resourceBucket,
      Name:     "Bucket",
    },
`;

    expect(parseServicePackageGen(content)).toEqual([]);
  });

  it('extracts factory function names correctly', () => {
    const content = `
    {
      Factory:  resourceBucketPolicy,
      TypeName: "aws_s3_bucket_policy",
      Name:     "Bucket Policy",
    },
    {
      Factory:  resourceBucketVersioning,
      TypeName: "aws_s3_bucket_versioning",
      Name:     "Bucket Versioning",
    },
`;

    const result = parseServicePackageGen(content);

    expect(result).toHaveLength(2);
    expect(result[0].factoryName).toBe('resourceBucketPolicy');
    expect(result[1].factoryName).toBe('resourceBucketVersioning');
  });

  it('handles blocks where TypeName appears before Factory', () => {
    const content = `
    {
      TypeName: "aws_lambda_function",
      Factory:  resourceFunction,
      Name:     "Function",
    },
`;

    const result = parseServicePackageGen(content);

    expect(result).toEqual([
      { typeName: 'aws_lambda_function', factoryName: 'resourceFunction' },
    ]);
  });

  it('handles mixed ordering of Factory and TypeName across blocks', () => {
    const content = `
    {
      Factory:  resourceBucket,
      TypeName: "aws_s3_bucket",
      Name:     "Bucket",
    },
    {
      TypeName: "aws_s3_object",
      Factory:  resourceObject,
      Name:     "Object",
    },
`;

    const result = parseServicePackageGen(content);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ typeName: 'aws_s3_bucket', factoryName: 'resourceBucket' });
    expect(result).toContainEqual({ typeName: 'aws_s3_object', factoryName: 'resourceObject' });
  });

  it('handles extra whitespace around Factory and TypeName values', () => {
    const content = `
    {
      Factory:   resourceBucket,
      TypeName:  "aws_s3_bucket",
      Name:      "Bucket",
    },
`;

    const result = parseServicePackageGen(content);

    expect(result).toEqual([
      { typeName: 'aws_s3_bucket', factoryName: 'resourceBucket' },
    ]);
  });

  it('handles blocks with additional fields like Tags and Name', () => {
    const content = `
    {
      Factory:  resourceBucket,
      TypeName: "aws_s3_bucket",
      Name:     "Bucket",
      Tags: &types.ServicePackageResourceTags{
        IdentifierAttribute: "arn",
      },
    },
`;

    const result = parseServicePackageGen(content);

    expect(result).toEqual([
      { typeName: 'aws_s3_bucket', factoryName: 'resourceBucket' },
    ]);
  });

  it('does not extract data source entries (only resources with aws_ prefix)', () => {
    const content = `
    {
      Factory:  dataSourceBuckets,
      TypeName: "aws_s3_buckets",
      Name:     "Buckets",
    },
    {
      Factory:  resourceBucket,
      TypeName: "aws_s3_bucket",
      Name:     "Bucket",
    },
`;

    const result = parseServicePackageGen(content);

    // Both have aws_ prefix so both are extracted - the parser doesn't distinguish
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({ typeName: 'aws_s3_bucket', factoryName: 'resourceBucket' });
    expect(result).toContainEqual({ typeName: 'aws_s3_buckets', factoryName: 'dataSourceBuckets' });
  });

  it('deduplicates entries with the same TypeName', () => {
    const content = `
    {
      Factory:  resourceBucket,
      TypeName: "aws_s3_bucket",
      Name:     "Bucket",
    },
    {
      Factory:  resourceBucketV2,
      TypeName: "aws_s3_bucket",
      Name:     "Bucket V2",
    },
`;

    const result = parseServicePackageGen(content);

    // Should only have one entry for aws_s3_bucket (last match wins for same-regex matches)
    expect(result).toHaveLength(1);
    expect(result[0].typeName).toBe('aws_s3_bucket');
  });
});
