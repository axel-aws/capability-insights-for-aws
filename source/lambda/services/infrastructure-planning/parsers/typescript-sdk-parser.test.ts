import { describe, it, expect } from 'vitest';
import { parseTypeScriptFile } from './typescript-sdk-parser';

describe('parseTypeScriptFile', () => {
  describe('v3 Command patterns', () => {
    it('should extract operation name from new Command pattern', () => {
      const content = `const result = new PutObjectCommand(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['PutObject']);
    });

    it('should extract operation name from client.send(new Command) pattern', () => {
      const content = `const response = await client.send(new GetItemCommand({ TableName: 'my-table' }));`;
      expect(parseTypeScriptFile(content)).toEqual(['GetItem']);
    });

    it('should extract multiple v3 Command patterns', () => {
      const content = `
        await client.send(new PutObjectCommand(params));
        await client.send(new GetItemCommand({ TableName: 'table' }));
        const cmd = new ListBucketsCommand({});
      `;
      expect(parseTypeScriptFile(content)).toEqual(['GetItem', 'ListBuckets', 'PutObject']);
    });

    it('should handle Command with whitespace before parenthesis', () => {
      const content = `new PutObjectCommand (params);`;
      expect(parseTypeScriptFile(content)).toEqual(['PutObject']);
    });

    it('should handle Command with newline-style spacing', () => {
      const content = `new   PutObjectCommand(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['PutObject']);
    });

    it('should extract multi-word operation names', () => {
      const content = `
        new CreateMultipartUploadCommand(params);
        new CompleteMultipartUploadCommand(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual([
        'CompleteMultipartUpload',
        'CreateMultipartUpload',
      ]);
    });
  });

  describe('v2-style patterns', () => {
    it('should extract method from s3Client variable', () => {
      const content = `s3Client.putObject(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['PutObject']);
    });

    it('should extract method from dynamodb variable', () => {
      const content = `dynamodb.getItem(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['GetItem']);
    });

    it('should extract method from lambda variable', () => {
      const content = `lambda.invoke(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['Invoke']);
    });

    it('should extract method from sqs variable', () => {
      const content = `sqs.sendMessage(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['SendMessage']);
    });

    it('should extract method from sns variable', () => {
      const content = `sns.publish(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['Publish']);
    });

    it('should extract method from service prefix with Client suffix', () => {
      const content = `ec2Client.describeInstances(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['DescribeInstances']);
    });

    it('should extract method from service prefix with client suffix (lowercase)', () => {
      const content = `iamclient.listRoles(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['ListRoles']);
    });

    it('should extract methods from multiple v2-style calls', () => {
      const content = `
        s3Client.putObject(params);
        dynamodb.getItem(params);
        sqs.sendMessage(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['GetItem', 'PutObject', 'SendMessage']);
    });

    it('should handle dynamoDb (camelCase) prefix', () => {
      const content = `dynamoDb.query(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['Query']);
    });

    it('should handle cloudwatch prefix', () => {
      const content = `cloudwatch.putMetricData(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['PutMetricData']);
    });

    it('should handle cloudformation prefix', () => {
      const content = `cloudformation.createStack(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['CreateStack']);
    });

    it('should handle kinesis prefix', () => {
      const content = `kinesis.putRecord(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['PutRecord']);
    });

    it('should handle stepfunctions prefix', () => {
      const content = `stepfunctions.startExecution(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['StartExecution']);
    });

    it('should handle sts prefix', () => {
      const content = `sts.assumeRole(params);`;
      expect(parseTypeScriptFile(content)).toEqual(['AssumeRole']);
    });
  });

  describe('mixed v3 and v2 patterns', () => {
    it('should extract operations from both v3 and v2 patterns', () => {
      const content = `
        await client.send(new PutObjectCommand(params));
        dynamodb.getItem(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['GetItem', 'PutObject']);
    });

    it('should deduplicate operations found via both patterns', () => {
      const content = `
        new PutObjectCommand(params);
        s3Client.putObject(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['PutObject']);
    });
  });

  describe('exclusion filtering', () => {
    it('should exclude import lines with v3 Command patterns', () => {
      const content = `
        import { PutObjectCommand } from '@aws-sdk/client-s3';
        new PutObjectCommand(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['PutObject']);
    });

    it('should exclude require lines', () => {
      const content = `
        const { GetItemCommand } = require('@aws-sdk/client-dynamodb');
        new GetItemCommand(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['GetItem']);
    });

    it('should exclude type annotation lines with typeof', () => {
      const content = `
        const cmd: typeof PutObjectCommand = something;
        new GetItemCommand(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['GetItem']);
    });

    it('should exclude type annotation lines with as cast', () => {
      const content = `
        const cmd = something as PutObjectCommand;
        new GetItemCommand(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['GetItem']);
    });

    it('should filter out method names shorter than 3 characters', () => {
      const content = `s3Client.ab(params);`;
      expect(parseTypeScriptFile(content)).toEqual([]);
    });

    it('should not match bare Command without operation prefix', () => {
      // The regex requires [A-Z][a-zA-Z]+ before Command, so bare "new Command(" won't match
      const content = `new Command(params);`;
      expect(parseTypeScriptFile(content)).toEqual([]);
    });

    it('should not match variables that are not known service prefixes', () => {
      const content = `myCustomClient.doSomething(params);`;
      expect(parseTypeScriptFile(content)).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should return empty array for empty input', () => {
      expect(parseTypeScriptFile('')).toEqual([]);
    });

    it('should return empty array for whitespace-only input', () => {
      expect(parseTypeScriptFile('   \n\t\n   ')).toEqual([]);
    });

    it('should return empty array for content with no matches', () => {
      const content = `
        const x = 42;
        function hello() { return 'world'; }
        console.log('no SDK calls here');
      `;
      expect(parseTypeScriptFile(content)).toEqual([]);
    });

    it('should return sorted results', () => {
      const content = `
        new ZetaCommand(params);
        new AlphaCommand(params);
        new MidCommand(params);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['Alpha', 'Mid', 'Zeta']);
    });

    it('should deduplicate repeated operations', () => {
      const content = `
        new PutObjectCommand(params1);
        new PutObjectCommand(params2);
        new PutObjectCommand(params3);
      `;
      expect(parseTypeScriptFile(content)).toEqual(['PutObject']);
    });

    it('should handle multiple operations on the same line', () => {
      const content = `const [a, b] = await Promise.all([client.send(new PutObjectCommand(p1)), client.send(new GetObjectCommand(p2))]);`;
      expect(parseTypeScriptFile(content)).toEqual(['GetObject', 'PutObject']);
    });
  });
});
