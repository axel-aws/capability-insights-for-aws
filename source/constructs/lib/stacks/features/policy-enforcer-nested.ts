import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface PolicyEnforcerNestedProps extends cdk.NestedStackProps {
  deploymentAssetsBucketName: string;
  lambdaCodeZipPath: string;
}

/**
 * Policy Enforcer feature — DynamoDB table + IAM Helper Lambda.
 */
export class PolicyEnforcerNestedStack extends cdk.NestedStack {
  public readonly tableName: string;
  public readonly iamHelperFunctionName: string;

  constructor(scope: Construct, id: string, props: PolicyEnforcerNestedProps) {
    super(scope, id, props);

    const prefix = 'CapabilityInsights';

    // Policy Configuration DynamoDB Table
    const policyTableName = `${prefix}PolicyConfiguration`;
    const policyTable = new dynamodb.CfnTable(this, policyTableName, {
      tableName: cdk.Fn.sub(`${policyTableName}-\${AWS::Region}`),
      billingMode: 'PAY_PER_REQUEST',
      sseSpecification: { sseEnabled: true },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      keySchema: [{ attributeName: 'policyId', keyType: 'HASH' }],
      attributeDefinitions: [
        { attributeName: 'policyId', attributeType: 'S' },
        { attributeName: 'policyName', attributeType: 'S' },
        { attributeName: 'accountId', attributeType: 'S' },
        { attributeName: 'createdAt', attributeType: 'S' },
      ],
      globalSecondaryIndexes: [
        {
          indexName: 'PolicyNameIndex',
          keySchema: [{ attributeName: 'policyName', keyType: 'HASH' }],
          projection: { projectionType: 'ALL' },
        },
        {
          indexName: 'AccountIdIndex',
          keySchema: [
            { attributeName: 'accountId', keyType: 'HASH' },
            { attributeName: 'createdAt', keyType: 'RANGE' },
          ],
          projection: { projectionType: 'ALL' },
        },
      ],
    });
    policyTable.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    this.tableName = cdk.Fn.ref(policyTable.logicalId);

    // IAM Policy Helper Lambda
    const iamHelperLambdaName = `${prefix}IAMPolicyHelper`;
    const iamHelperRole = new iam.CfnRole(this, `${iamHelperLambdaName}Role`, {
      roleName: cdk.Fn.sub(`${iamHelperLambdaName}Role-\${AWS::Region}`),
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'lambda.amazonaws.com' },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      managedPolicyArns: [
        'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      ],
      policies: [
        {
          policyName: 'IAMPolicyManagement',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'iam:CreatePolicy',
                  'iam:CreatePolicyVersion',
                  'iam:DeletePolicyVersion',
                  'iam:ListPolicyVersions',
                  'iam:DeletePolicy',
                  'iam:GetPolicy',
                  'iam:GetPolicyVersion',
                ],
                Resource: cdk.Fn.sub(
                  'arn:${AWS::Partition}:iam::${AWS::AccountId}:policy/PolicyEnforcer-*',
                ),
              },
            ],
          },
        },
      ],
    });

    new lambda.CfnFunction(this, iamHelperLambdaName, {
      functionName: iamHelperLambdaName,
      runtime: 'nodejs24.x',
      handler: 'lambda/iam-policy-helper.handler',
      role: cdk.Fn.getAtt(iamHelperRole.logicalId, 'Arn').toString(),
      code: {
        s3Bucket: props.deploymentAssetsBucketName,
        s3Key: props.lambdaCodeZipPath,
      },
      memorySize: 128,
      timeout: 30,
    });

    this.iamHelperFunctionName = iamHelperLambdaName;
  }
}
