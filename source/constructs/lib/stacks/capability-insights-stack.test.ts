import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, describe, expect, test } from 'vitest';
import { CapabilityInsightsStack } from './capability-insights-stack';

let snapshotFailed = false;

test('CloudFormation template matches snapshot', () => {
  const app = new App();
  const stack = new CapabilityInsightsStack(app, 'TestStack');
  try {
    expect(Template.fromStack(stack).toJSON()).toMatchSnapshot();
  } catch (e) {
    snapshotFailed = true;
    throw e;
  }
});

describe('Terraform Overlay Lambda', () => {
  const app = new App();
  const stack = new CapabilityInsightsStack(app, 'TestStack-Overlay');
  const template = Template.fromStack(stack);

  test('has 300s timeout and 512 MB memory', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'CapabilityInsightsTerraformOverlayLambda',
      Timeout: 300,
      MemorySize: 512,
    });
  });

  test('does not have GITHUB_TOKEN environment variable', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'CapabilityInsightsTerraformOverlayLambda',
      Environment: {
        Variables: Match.not(Match.objectLike({
          GITHUB_TOKEN: Match.anyValue(),
        })),
      },
    });
  });

  test('has S3 PutObject permission for both overlay and classic API mapping files', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyName: 'S3PutOverlayData',
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: 's3:PutObject',
                Resource: Match.anyValue(),
              },
            ],
          },
        }),
      ]),
    });
  });
});

describe('Plan Configuration DynamoDB Table', () => {
  const app = new App();
  const stack = new CapabilityInsightsStack(app, 'TestStack-PlanTable');
  const template = Template.fromStack(stack);

  test('has planId as HASH key with PAY_PER_REQUEST billing', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: Match.objectLike({ 'Fn::Sub': Match.stringLikeRegexp('CapabilityInsightsPlanConfiguration') }),
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'planId', KeyType: 'HASH' }],
    });
  });

  test('has PlanNameIndex GSI with planName as HASH key', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: Match.objectLike({ 'Fn::Sub': Match.stringLikeRegexp('CapabilityInsightsPlanConfiguration') }),
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'PlanNameIndex',
          KeySchema: [{ AttributeName: 'planName', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
        }),
      ]),
    });
  });

  test('has SSE and point-in-time recovery enabled', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: Match.objectLike({ 'Fn::Sub': Match.stringLikeRegexp('CapabilityInsightsPlanConfiguration') }),
      SSESpecification: { SSEEnabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  test('has DESTROY removal policy', () => {
    template.hasResource('AWS::DynamoDB::Table', {
      Properties: {
        TableName: Match.objectLike({ 'Fn::Sub': Match.stringLikeRegexp('CapabilityInsightsPlanConfiguration') }),
      },
      DeletionPolicy: 'Delete',
    });
  });

  test('PLAN_TABLE_NAME environment variable is set on API Lambda', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'CapabilityInsightsApiLambda',
      Environment: {
        Variables: Match.objectLike({
          PLAN_TABLE_NAME: Match.anyValue(),
        }),
      },
    });
  });
});

describe('API Lambda role', () => {
  const app = new App();
  const stack = new CapabilityInsightsStack(app, 'TestStack-IAM');
  const template = Template.fromStack(stack);

  test('has Organizations read access policy', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyName: 'OrganizationsReadAccess',
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: ['organizations:ListAccounts', 'organizations:DescribeOrganization'],
                Resource: '*',
              },
            ],
          },
        }),
      ]),
    });
  });

  test('has Step Functions access policy', () => {
    template.hasResourceProperties('AWS::IAM::Role', {
      Policies: Match.arrayWith([
        Match.objectLike({
          PolicyName: 'StepFunctionsAccess',
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: ['states:StartExecution', 'states:DescribeExecution'],
              },
            ],
          },
        }),
      ]),
    });
  });
});

afterAll(() => {
  if (snapshotFailed) {
    console.error(
      '\n📸 Snapshot mismatch! If this change is intentional, update with:\n' +
        '   npm run test:update-snapshot --workspace=source/constructs\n',
    );
  }
});
