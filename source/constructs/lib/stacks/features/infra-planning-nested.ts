import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface InfraPlanningNestedProps extends cdk.NestedStackProps {
  deploymentAssetsBucketName: string;
  lambdaCodeZipPath: string;
}

/**
 * Infrastructure Planning feature — DynamoDB table + GitHub Fetch Lambda.
 */
export class InfraPlanningNestedStack extends cdk.NestedStack {
  public readonly tableName: string;
  public readonly githubFetchFunctionName: string;

  constructor(scope: Construct, id: string, props: InfraPlanningNestedProps) {
    super(scope, id, props);

    const prefix = 'CapabilityInsights';

    // Plan Configuration DynamoDB Table
    const planTableName = `${prefix}PlanConfiguration`;
    const planTable = new dynamodb.CfnTable(this, planTableName, {
      tableName: cdk.Fn.sub(`${planTableName}-\${AWS::Region}`),
      billingMode: 'PAY_PER_REQUEST',
      sseSpecification: { sseEnabled: true },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      keySchema: [{ attributeName: 'planId', keyType: 'HASH' }],
      attributeDefinitions: [
        { attributeName: 'planId', attributeType: 'S' },
        { attributeName: 'planName', attributeType: 'S' },
      ],
      globalSecondaryIndexes: [
        {
          indexName: 'PlanNameIndex',
          keySchema: [{ attributeName: 'planName', keyType: 'HASH' }],
          projection: { projectionType: 'ALL' },
        },
      ],
    });
    planTable.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    this.tableName = cdk.Fn.ref(planTable.logicalId);

    // GitHub Fetch Lambda — runs outside VPC (needs internet for GitHub API)
    const githubFetchLambdaName = `${prefix}GitHubFetchLambda`;
    const githubFetchRole = new iam.CfnRole(this, `${githubFetchLambdaName}Role`, {
      roleName: cdk.Fn.sub(`${githubFetchLambdaName}Role-\${AWS::Region}`),
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
        cdk.Fn.sub(
          'arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });

    new lambda.CfnFunction(this, githubFetchLambdaName, {
      functionName: githubFetchLambdaName,
      runtime: 'nodejs24.x',
      handler: 'lambda/github-fetch-lambda-main.handler',
      role: cdk.Fn.getAtt(githubFetchRole.logicalId, 'Arn').toString(),
      code: {
        s3Bucket: props.deploymentAssetsBucketName,
        s3Key: props.lambdaCodeZipPath,
      },
      memorySize: 512,
      timeout: 120,
    });

    this.githubFetchFunctionName = githubFetchLambdaName;
  }
}
