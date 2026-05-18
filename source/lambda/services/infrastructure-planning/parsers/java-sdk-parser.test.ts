import { describe, it, expect } from 'vitest';
import { parseJavaFile } from './java-sdk-parser';

describe('parseJavaFile', () => {
  describe('real-world Java SDK v2 patterns', () => {
    it('should extract method from instance variable ending with Client (lowercase start)', () => {
      const content = `s3Client.putObject(request);`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['PutObject']);
    });

    it('should extract method from class name ending with Client (uppercase start)', () => {
      const content = `DynamoDbClient.getItem(request);`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['GetItem']);
    });

    it('should extract multiple operations from a realistic Java file', () => {
      const content = `
public class S3Service {
    private final S3Client s3Client;

    public void uploadFile(String bucket, String key, byte[] data) {
        s3Client.putObject(PutObjectRequest.builder().bucket(bucket).key(key).build(), RequestBody.fromBytes(data));
    }

    public void deleteFile(String bucket, String key) {
        s3Client.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
    }

    public List<S3Object> listFiles(String bucket) {
        ListObjectsV2Response response = s3Client.listObjectsV2(ListObjectsV2Request.builder().bucket(bucket).build());
        return response.contents();
    }
}`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['DeleteObject', 'ListObjectsV2', 'PutObject']);
    });

    it('should extract from DynamoDB client patterns', () => {
      const content = `
dynamoDbClient.getItem(getRequest);
dynamoDbClient.putItem(putRequest);
dynamoDbClient.query(queryRequest);
dynamoDbClient.scan(scanRequest);
`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['GetItem', 'PutItem', 'Query', 'Scan']);
    });

    it('should extract from Lambda client patterns', () => {
      const content = `lambdaClient.invoke(invokeRequest);`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['Invoke']);
    });

    it('should extract from SQS client patterns', () => {
      const content = `
sqsClient.sendMessage(sendRequest);
sqsClient.receiveMessage(receiveRequest);
sqsClient.deleteMessage(deleteRequest);
`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['DeleteMessage', 'ReceiveMessage', 'SendMessage']);
    });

    it('should handle static-style calls on class names', () => {
      const content = `
S3Client.putObject(request);
DynamoDbClient.getItem(request);
LambdaClient.invoke(request);
`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['GetItem', 'Invoke', 'PutObject']);
    });
  });

  describe('exclusion list filtering', () => {
    it('should exclude "create" method', () => {
      const content = `S3Client.create(config);`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude "builder" method', () => {
      const content = `S3Client.builder(config);`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude "build" method', () => {
      const content = `S3Client.build(config);`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude "close" method', () => {
      const content = `s3Client.close();`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude "serviceClientConfiguration" method', () => {
      const content = `s3Client.serviceClientConfiguration();`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude "serviceName" method', () => {
      const content = `s3Client.serviceName();`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude "waiter" method', () => {
      const content = `s3Client.waiter();`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should exclude methods shorter than 3 characters', () => {
      const content = `
s3Client.ab(request);
s3Client.x(request);
`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should keep valid methods while filtering excluded ones', () => {
      const content = `
s3Client.builder();
s3Client.putObject(request);
s3Client.close();
s3Client.deleteObject(request);
s3Client.create();
`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['DeleteObject', 'PutObject']);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty input', () => {
      const result = parseJavaFile('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace-only input', () => {
      const result = parseJavaFile('   \n\t\n   ');
      expect(result).toEqual([]);
    });

    it('should return empty array when no patterns match', () => {
      const content = `
public class MyService {
    private String name;
    public void doSomething() {
        System.out.println("Hello");
    }
}`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should handle very long lines without issues', () => {
      const longPrefix = 'a'.repeat(10000);
      const content = `${longPrefix}s3Client.putObject(request);`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['PutObject']);
    });

    it('should not match identifiers that do not end with Client', () => {
      const content = `
myService.putObject(request);
helper.getItem(request);
s3Handler.deleteObject(request);
`;
      const result = parseJavaFile(content);
      expect(result).toEqual([]);
    });

    it('should deduplicate repeated operations', () => {
      const content = `
s3Client.putObject(request1);
s3Client.putObject(request2);
s3Client.putObject(request3);
`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['PutObject']);
    });

    it('should return sorted results', () => {
      const content = `
s3Client.putObject(request);
s3Client.getObject(request);
s3Client.deleteObject(request);
s3Client.listBuckets(request);
`;
      const result = parseJavaFile(content);
      expect(result).toEqual(['DeleteObject', 'GetObject', 'ListBuckets', 'PutObject']);
    });
  });

  describe('camelCase to PascalCase conversion', () => {
    it('should convert putObject to PutObject', () => {
      const content = `s3Client.putObject(request);`;
      const result = parseJavaFile(content);
      expect(result).toContain('PutObject');
    });

    it('should convert getItem to GetItem', () => {
      const content = `dynamoDbClient.getItem(request);`;
      const result = parseJavaFile(content);
      expect(result).toContain('GetItem');
    });

    it('should convert createBucket to CreateBucket', () => {
      const content = `s3Client.createBucket(request);`;
      const result = parseJavaFile(content);
      expect(result).toContain('CreateBucket');
    });

    it('should keep already PascalCase names unchanged', () => {
      const content = `s3Client.PutObject(request);`;
      const result = parseJavaFile(content);
      expect(result).toContain('PutObject');
    });

    it('should convert single-word camelCase (invoke → Invoke)', () => {
      const content = `lambdaClient.invoke(request);`;
      const result = parseJavaFile(content);
      expect(result).toContain('Invoke');
    });

    it('should convert listObjectsV2 to ListObjectsV2', () => {
      const content = `s3Client.listObjectsV2(request);`;
      const result = parseJavaFile(content);
      expect(result).toContain('ListObjectsV2');
    });
  });
});
