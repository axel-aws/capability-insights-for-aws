import { describe, it, expect } from 'vitest';
import { parseResourceGoFile } from './classic-resource-parser';

describe('parseResourceGoFile', () => {
  it('extracts a single SDK method call', () => {
    const content = `
package s3

func resourceBucketCreate(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  input := &s3.CreateBucketInput{}
  _, err := conn.CreateBucket(input)
  return err
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['CreateBucket']);
  });

  it('extracts multiple distinct SDK method calls', () => {
    const content = `
package s3

func resourceBucketCreate(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  _, err := conn.CreateBucket(input)
  if err != nil {
    return err
  }
  _, err = conn.PutBucketPolicy(policyInput)
  return err
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toContain('CreateBucket');
    expect(result).toContain('PutBucketPolicy');
    expect(result).toHaveLength(2);
  });

  it('strips WithContext suffix from SDK v1 method names', () => {
    const content = `
package s3

func resourceBucketCreate(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  _, err := conn.CreateBucketWithContext(ctx, input)
  return err
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['CreateBucket']);
  });

  it('filters out String() method', () => {
    const content = `
package s3

func resourceBucketCreate(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  _, err := conn.CreateBucket(input)
  log.Printf("input: %s", conn.String())
  return err
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['CreateBucket']);
    expect(result).not.toContain('String');
  });

  it('filters out GoString() method', () => {
    const content = `
package s3

func resourceBucketRead(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  output, _ := conn.HeadBucket(input)
  log.Printf("output: %s", conn.GoString())
  return nil
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['HeadBucket']);
    expect(result).not.toContain('GoString');
  });

  it('includes Set* API operations called on SDK client variables', () => {
    const content = `
package sqs

func resourceQueueUpdate(ctx context.Context, d *schema.ResourceData, meta any) diag.Diagnostics {
  conn := meta.(*conns.AWSClient).SQSClient(ctx)
  _, err = conn.SetQueueAttributes(ctx, input)
  _, err := conn.CreateQueue(ctx, input)
  return err
}
`;

    const result = parseResourceGoFile(content);

    // Set* methods on conn/client/svc are real AWS API operations, not struct setters
    expect(result).toContain('SetQueueAttributes');
    expect(result).toContain('CreateQueue');
  });

  it('deduplicates same method called multiple times', () => {
    const content = `
package s3

func resourceBucketUpdate(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  _, err := conn.PutBucketPolicy(input1)
  if err != nil {
    return err
  }
  _, err = conn.PutBucketPolicy(input2)
  return err
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['PutBucketPolicy']);
  });

  it('returns empty array for file with no SDK calls', () => {
    const content = `
package s3

import "fmt"

func helperFunction() string {
  return fmt.Sprintf("hello %s", "world")
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual([]);
  });

  it('returns empty array for empty content', () => {
    expect(parseResourceGoFile('')).toEqual([]);
  });

  it('returns empty array for whitespace-only content', () => {
    expect(parseResourceGoFile('   \n\t  ')).toEqual([]);
  });

  it('matches client.MethodName( pattern', () => {
    const content = `
package ec2

func resourceInstanceCreate(d *schema.ResourceData, meta interface{}) error {
  client := meta.(*conns.AWSClient).EC2Client()
  _, err := client.RunInstances(input)
  return err
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['RunInstances']);
  });

  it('matches svc.MethodName( pattern', () => {
    const content = `
package lambda

func resourceFunctionCreate(d *schema.ResourceData, meta interface{}) error {
  svc := meta.(*conns.AWSClient).LambdaConn()
  _, err := svc.CreateFunction(input)
  return err
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['CreateFunction']);
  });

  it('returns results sorted alphabetically', () => {
    const content = `
package s3

func resourceBucket(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  conn.PutBucketPolicy(input)
  conn.DeleteBucket(input)
  conn.CreateBucket(input)
  conn.HeadBucket(input)
  return nil
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['CreateBucket', 'DeleteBucket', 'HeadBucket', 'PutBucketPolicy']);
  });

  it('handles WithContext and non-WithContext calls for same operation', () => {
    const content = `
package s3

func resourceBucket(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  conn.CreateBucket(input)
  conn.CreateBucketWithContext(ctx, input)
  return nil
}
`;

    const result = parseResourceGoFile(content);

    // Both resolve to CreateBucket, should be deduplicated
    expect(result).toEqual(['CreateBucket']);
  });

  it('filters out Validate method', () => {
    const content = `
package s3

func resourceBucket(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  conn.Validate()
  conn.CreateBucket(input)
  return nil
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['CreateBucket']);
    expect(result).not.toContain('Validate');
  });

  it('filters out very short method names (< 3 chars)', () => {
    const content = `
package s3

func resourceBucket(d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()
  conn.Do(input)
  conn.CreateBucket(input)
  return nil
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['CreateBucket']);
    expect(result).not.toContain('Do');
  });

  it('handles a realistic resource file with mixed patterns', () => {
    const content = `
package s3

import (
  "context"
  "github.com/aws/aws-sdk-go/service/s3"
)

func resourceBucketCreate(ctx context.Context, d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()

  input := &s3.CreateBucketInput{
    Bucket: aws.String(d.Get("bucket").(string)),
  }

  _, err := conn.CreateBucketWithContext(ctx, input)
  if err != nil {
    return fmt.Errorf("creating S3 Bucket: %w", err)
  }

  d.SetId(d.Get("bucket").(string))

  if v, ok := d.GetOk("policy"); ok {
    policyInput := &s3.PutBucketPolicyInput{
      Bucket: aws.String(d.Id()),
      Policy: aws.String(v.(string)),
    }
    _, err := conn.PutBucketPolicyWithContext(ctx, policyInput)
    if err != nil {
      return fmt.Errorf("putting S3 Bucket policy: %w", err)
    }
  }

  return nil
}

func resourceBucketRead(ctx context.Context, d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()

  _, err := conn.HeadBucketWithContext(ctx, &s3.HeadBucketInput{
    Bucket: aws.String(d.Id()),
  })
  if err != nil {
    return fmt.Errorf("reading S3 Bucket: %w", err)
  }

  return nil
}

func resourceBucketDelete(ctx context.Context, d *schema.ResourceData, meta interface{}) error {
  conn := meta.(*conns.AWSClient).S3Conn()

  _, err := conn.DeleteBucketWithContext(ctx, &s3.DeleteBucketInput{
    Bucket: aws.String(d.Id()),
  })
  return err
}
`;

    const result = parseResourceGoFile(content);

    expect(result).toEqual(['CreateBucket', 'DeleteBucket', 'HeadBucket', 'PutBucketPolicy']);
  });
});
