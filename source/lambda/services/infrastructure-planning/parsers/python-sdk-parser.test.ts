import { describe, it, expect } from 'vitest';
import { parsePythonFile, snakeToPascal } from './python-sdk-parser';

describe('parsePythonFile', () => {
  describe('boto3 client patterns', () => {
    it('should extract method from variable ending with "client"', () => {
      const content = `s3_client.put_object(Bucket='my-bucket', Key='key')`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['PutObject']);
    });

    it('should extract method from bare "client" variable', () => {
      const content = `client.get_item(TableName='my-table', Key={'id': {'S': '123'}})`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['GetItem']);
    });

    it('should extract method from "conn" variable', () => {
      const content = `conn.describe_instances(Filters=[{'Name': 'tag:Name', 'Values': ['web']}])`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['DescribeInstances']);
    });

    it('should extract method from "svc" variable', () => {
      const content = `svc.list_functions(MaxItems=50)`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['ListFunctions']);
    });

    it('should extract multiple methods from different client patterns', () => {
      const content = `
s3_client.put_object(Bucket='bucket', Key='key', Body=data)
dynamodb_client.get_item(TableName='table', Key={'id': {'S': '1'}})
conn.describe_instances()
svc.list_functions()
`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['DescribeInstances', 'GetItem', 'ListFunctions', 'PutObject']);
    });

    it('should extract method from multi-word client variable', () => {
      const content = `my_s3_client.list_buckets()`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['ListBuckets']);
    });
  });

  describe('resource patterns', () => {
    it('should extract method from variable ending with "resource"', () => {
      const content = `s3_resource.Object('my-bucket', 'my-key')`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['Object']);
    });

    it('should extract method from bare "resource" variable', () => {
      const content = `resource.Table('my-table')`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['Table']);
    });

    it('should extract method from multi-word resource variable', () => {
      const content = `my_s3_resource.Bucket('my-bucket')`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['Bucket']);
    });
  });

  describe('exclusion list filtering', () => {
    it('should exclude get_paginator', () => {
      const content = `client.get_paginator('list_objects_v2')`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude get_waiter', () => {
      const content = `client.get_waiter('instance_running')`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude can_paginate', () => {
      const content = `client.can_paginate('list_objects')`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude generate_presigned_url', () => {
      const content = `s3_client.generate_presigned_url('get_object', Params={'Bucket': 'b', 'Key': 'k'})`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude generate_presigned_post', () => {
      const content = `s3_client.generate_presigned_post('my-bucket', 'my-key')`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should keep valid methods while filtering excluded ones', () => {
      const content = `
s3_client.put_object(Bucket='b', Key='k', Body=data)
s3_client.get_paginator('list_objects_v2')
s3_client.generate_presigned_url('get_object')
s3_client.list_objects_v2(Bucket='b')
`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['ListObjectsV2', 'PutObject']);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty input', () => {
      const result = parsePythonFile('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace-only input', () => {
      const result = parsePythonFile('   \n\t\n   ');
      expect(result).toEqual([]);
    });

    it('should return empty array when no patterns match', () => {
      const content = `
import boto3
x = 42
print("hello world")
def my_function():
    return True
`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude methods starting with underscore', () => {
      const content = `client._make_request(operation='GetItem')`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude multiple underscore-prefixed methods', () => {
      const content = `
client._make_api_call('PutObject', params)
client.__private_method()
client._internal_setup()
`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude methods shorter than 3 characters after conversion', () => {
      const content = `client.do(something)`;
      const result = parsePythonFile(content);
      expect(result).toEqual([]);
    });

    it('should deduplicate repeated operations', () => {
      const content = `
s3_client.put_object(Bucket='b1', Key='k1', Body=d1)
s3_client.put_object(Bucket='b2', Key='k2', Body=d2)
s3_client.put_object(Bucket='b3', Key='k3', Body=d3)
`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['PutObject']);
    });

    it('should return results in sorted order', () => {
      const content = `
client.put_object(Bucket='b')
client.delete_object(Bucket='b', Key='k')
client.get_object(Bucket='b', Key='k')
client.list_objects(Bucket='b')
`;
      const result = parsePythonFile(content);
      expect(result).toEqual(['DeleteObject', 'GetObject', 'ListObjects', 'PutObject']);
    });
  });

  describe('snakeToPascal conversion', () => {
    it('should convert simple snake_case to PascalCase', () => {
      expect(snakeToPascal('put_object')).toBe('PutObject');
    });

    it('should convert single word to PascalCase', () => {
      expect(snakeToPascal('describe')).toBe('Describe');
    });

    it('should convert multi-segment snake_case', () => {
      expect(snakeToPascal('describe_instances')).toBe('DescribeInstances');
    });

    it('should handle segments with numbers', () => {
      expect(snakeToPascal('list_objects_v2')).toBe('ListObjectsV2');
    });

    it('should handle already capitalized segments', () => {
      expect(snakeToPascal('Object')).toBe('Object');
    });

    it('should handle three-segment names', () => {
      expect(snakeToPascal('get_bucket_location')).toBe('GetBucketLocation');
    });

    it('should handle four-segment names', () => {
      expect(snakeToPascal('put_bucket_lifecycle_configuration')).toBe(
        'PutBucketLifecycleConfiguration'
      );
    });
  });
});
