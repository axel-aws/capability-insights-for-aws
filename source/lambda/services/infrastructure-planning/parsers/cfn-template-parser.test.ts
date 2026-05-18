import { describe, it, expect } from 'vitest';
import { parseCfnTemplate } from './cfn-template-parser';

describe('parseCfnTemplate', () => {
  describe('YAML parsing', () => {
    it('should parse a valid YAML CloudFormation template', () => {
      const template = `
AWSTemplateFormatVersion: '2010-09-09'
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      Runtime: nodejs18.x
`;
      const result = parseCfnTemplate(template);
      expect(result).toEqual(['AWS::Lambda::Function', 'AWS::S3::Bucket']);
    });

    it('should handle templates with intrinsic functions', () => {
      const template = `
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub "\${AWS::StackName}-bucket"
  MyFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: !Ref FunctionName
`;
      const result = parseCfnTemplate(template);
      expect(result).toEqual(['AWS::Lambda::Function', 'AWS::S3::Bucket']);
    });
  });

  describe('JSON parsing', () => {
    it('should parse a valid JSON CloudFormation template', () => {
      const template = JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Resources: {
          MyTable: {
            Type: 'AWS::DynamoDB::Table',
            Properties: { TableName: 'test' },
          },
          MyQueue: {
            Type: 'AWS::SQS::Queue',
          },
        },
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual(['AWS::DynamoDB::Table', 'AWS::SQS::Queue']);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate resource types', () => {
      const template = JSON.stringify({
        Resources: {
          Bucket1: { Type: 'AWS::S3::Bucket' },
          Bucket2: { Type: 'AWS::S3::Bucket' },
          Function1: { Type: 'AWS::Lambda::Function' },
        },
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual(['AWS::Lambda::Function', 'AWS::S3::Bucket']);
    });
  });

  describe('sorting', () => {
    it('should return resource types in sorted order', () => {
      const template = JSON.stringify({
        Resources: {
          MyQueue: { Type: 'AWS::SQS::Queue' },
          MyBucket: { Type: 'AWS::S3::Bucket' },
          MyFunction: { Type: 'AWS::Lambda::Function' },
          MyTable: { Type: 'AWS::DynamoDB::Table' },
        },
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual([
        'AWS::DynamoDB::Table',
        'AWS::Lambda::Function',
        'AWS::S3::Bucket',
        'AWS::SQS::Queue',
      ]);
    });
  });

  describe('filtering', () => {
    it('should only include AWS:: prefixed types', () => {
      const template = JSON.stringify({
        Resources: {
          MyBucket: { Type: 'AWS::S3::Bucket' },
          CustomResource: { Type: 'Custom::MyResource' },
          ModuleResource: { Type: 'Module::MyModule' },
        },
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual(['AWS::S3::Bucket']);
    });

    it('should skip resources without a Type field', () => {
      const template = JSON.stringify({
        Resources: {
          MyBucket: { Type: 'AWS::S3::Bucket' },
          Incomplete: { Properties: { Foo: 'bar' } },
        },
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual(['AWS::S3::Bucket']);
    });

    it('should skip resources with non-string Type field', () => {
      const template = JSON.stringify({
        Resources: {
          MyBucket: { Type: 'AWS::S3::Bucket' },
          BadType: { Type: 123 },
        },
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual(['AWS::S3::Bucket']);
    });
  });

  describe('error handling', () => {
    it('should throw for invalid content (not YAML or JSON)', () => {
      expect(() => parseCfnTemplate('{{{{not valid at all!!!!')).toThrow(
        'Failed to parse template: content is not valid YAML or JSON'
      );
    });

    it('should throw for content that parses to a non-object', () => {
      expect(() => parseCfnTemplate('"just a string"')).toThrow(
        'Failed to parse template: content does not represent a valid CloudFormation template object'
      );
    });

    it('should throw for content that parses to an array', () => {
      expect(() => parseCfnTemplate('[1, 2, 3]')).toThrow(
        'Failed to parse template: content does not represent a valid CloudFormation template object'
      );
    });

    it('should throw for content that parses to null', () => {
      expect(() => parseCfnTemplate('null')).toThrow(
        'Failed to parse template: content does not represent a valid CloudFormation template object'
      );
    });

    it('should throw when Resources section is missing', () => {
      const template = JSON.stringify({
        AWSTemplateFormatVersion: '2010-09-09',
        Description: 'No resources here',
      });
      expect(() => parseCfnTemplate(template)).toThrow(
        'Invalid CloudFormation template: missing "Resources" section'
      );
    });

    it('should throw when Resources section is null', () => {
      const template = JSON.stringify({
        Resources: null,
      });
      expect(() => parseCfnTemplate(template)).toThrow(
        'Invalid CloudFormation template: missing "Resources" section'
      );
    });

    it('should throw when Resources section is not an object', () => {
      const template = JSON.stringify({
        Resources: 'not an object',
      });
      expect(() => parseCfnTemplate(template)).toThrow(
        'Invalid CloudFormation template: "Resources" section must be an object'
      );
    });

    it('should throw when Resources section is an array', () => {
      const template = JSON.stringify({
        Resources: ['item1', 'item2'],
      });
      expect(() => parseCfnTemplate(template)).toThrow(
        'Invalid CloudFormation template: "Resources" section must be an object'
      );
    });
  });

  describe('edge cases', () => {
    it('should return empty array when Resources section has no AWS:: types', () => {
      const template = JSON.stringify({
        Resources: {
          Custom: { Type: 'Custom::MyResource' },
        },
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual([]);
    });

    it('should handle empty Resources section', () => {
      const template = JSON.stringify({
        Resources: {},
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual([]);
    });

    it('should handle resource entries that are null', () => {
      const template = JSON.stringify({
        Resources: {
          MyBucket: { Type: 'AWS::S3::Bucket' },
          NullResource: null,
        },
      });
      const result = parseCfnTemplate(template);
      expect(result).toEqual(['AWS::S3::Bucket']);
    });
  });
});
