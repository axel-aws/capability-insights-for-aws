/**
 * CloudFormation Deployment Template Generator for Policy Enforcer.
 *
 * Generates a self-contained CloudFormation template (JSON) that customers deploy
 * to their AWS account. The template creates all resources needed for automated
 * policy refresh: Lambda, DynamoDB config table, EventBridge schedule, IAM role,
 * managed policy, and an initial refresh custom resource.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 7a.6
 */

export interface TemplateParameters {
  catalogApiEndpoint: string;
  refreshIntervalHours: number;
  vpcDeployment: boolean;
  policyType: 'IAM' | 'SCP';
  policyConfigId: string;
  tags?: Array<{ key: string; value: string }>;
}

interface CloudFormationTemplate {
  AWSTemplateFormatVersion: string;
  Description: string;
  Parameters: Record<string, CloudFormationParameter>;
  Conditions?: Record<string, unknown>;
  Resources: Record<string, CloudFormationResource>;
  Outputs: Record<string, CloudFormationOutput>;
}

interface CloudFormationParameter {
  Type: string;
  Description: string;
  Default?: string | number;
  AllowedValues?: string[];
}

interface CloudFormationResource {
  Type: string;
  Properties: Record<string, unknown>;
  DependsOn?: string | string[];
  Condition?: string;
}

interface CloudFormationOutput {
  Description: string;
  Value: Record<string, unknown> | string;
  Export?: { Name: Record<string, unknown> };
}

/**
 * Generates a CloudFormation deployment template for the Policy Enforcer stack.
 *
 * The template includes:
 * - RefreshLambda: Node.js 24.x, arm64, 256 MB, 300s timeout
 * - ConfigTable: DynamoDB PAY_PER_REQUEST with encryption at rest
 * - LambdaExecutionRole: IAM role with least-privilege permissions
 * - RefreshSchedule: EventBridge rule for periodic refresh
 * - ManagedPolicy: Initially empty IAM policy or SCP placeholder
 * - InitialRefreshCustomResource: Triggers first policy generation on stack creation
 * - (Optional) VPC endpoints for DynamoDB, IAM, Organizations, Catalog API
 *
 * Tags from the policy configuration are propagated to all resources.
 */
export function generateDeploymentTemplate(params: TemplateParameters): string {
  const template = buildTemplate(params);
  return JSON.stringify(template, null, 2);
}

function buildTemplate(params: TemplateParameters): CloudFormationTemplate {
  const { policyType, vpcDeployment, tags } = params;

  const resourceTags = buildResourceTags(params);

  const template: CloudFormationTemplate = {
    AWSTemplateFormatVersion: '2010-09-09',
    Description:
      'Policy Enforcer deployment stack. Creates a Lambda function that periodically refreshes ' +
      'an IAM Policy or SCP based on regional capability availability from the Service Catalog API.',
    Parameters: buildParameters(params),
    Resources: {
      ...buildConfigTable(resourceTags),
      ...buildLambdaExecutionRole(policyType, vpcDeployment, resourceTags),
      ...buildManagedPolicy(policyType, resourceTags),
      ...buildRefreshLambda(params, resourceTags),
      ...buildRefreshSchedule(resourceTags),
      ...buildInitialRefreshCustomResource(resourceTags),
    },
    Outputs: buildOutputs(policyType),
  };

  if (vpcDeployment) {
    template.Conditions = {
      IsVpcDeployment: { 'Fn::Equals': [{ Ref: 'VpcDeployment' }, 'true'] },
    };
    Object.assign(template.Resources, buildVpcEndpoints(resourceTags, tags));
  }

  return template;
}

function buildParameters(params: TemplateParameters): Record<string, CloudFormationParameter> {
  const parameters: Record<string, CloudFormationParameter> = {
    CatalogApiEndpoint: {
      Type: 'String',
      Description: 'The URL of the Catalog API endpoint for fetching regional availability data.',
      Default: params.catalogApiEndpoint,
    },
    RefreshIntervalHours: {
      Type: 'Number',
      Description: 'How often (in hours) the policy should be refreshed. Valid range: 1-24.',
      Default: params.refreshIntervalHours,
    },
    PolicyConfigId: {
      Type: 'String',
      Description: 'The unique identifier of the policy configuration.',
      Default: params.policyConfigId,
    },
    PolicyType: {
      Type: 'String',
      Description: 'The type of policy to generate (IAM managed policy or Service Control Policy).',
      Default: params.policyType,
      AllowedValues: ['IAM', 'SCP'],
    },
  };

  if (params.vpcDeployment) {
    parameters.VpcDeployment = {
      Type: 'String',
      Description: 'Whether to deploy within a VPC with VPC endpoints.',
      Default: 'true',
      AllowedValues: ['true', 'false'],
    };
    parameters.VpcId = {
      Type: 'String',
      Description: 'The VPC ID for VPC deployment.',
    };
    parameters.SubnetIds = {
      Type: 'String',
      Description: 'Comma-separated list of subnet IDs for the Lambda function.',
    };
    parameters.SecurityGroupId = {
      Type: 'String',
      Description: 'Security group ID for the Lambda function and VPC endpoints.',
    };
  }

  return parameters;
}

function buildResourceTags(
  params: TemplateParameters,
): Array<{ Key: string; Value: string | Record<string, unknown> }> {
  const tags: Array<{ Key: string; Value: string | Record<string, unknown> }> = [
    { Key: 'PolicyEnforcer:PolicyConfigId', Value: { Ref: 'PolicyConfigId' } },
    { Key: 'PolicyEnforcer:PolicyType', Value: { Ref: 'PolicyType' } },
    { Key: 'PolicyEnforcer:ManagedBy', Value: 'PolicyEnforcer' },
  ];

  if (params.tags) {
    for (const tag of params.tags) {
      tags.push({ Key: tag.key, Value: tag.value });
    }
  }

  return tags;
}

function buildConfigTable(
  resourceTags: Array<{ Key: string; Value: string | Record<string, unknown> }>,
): Record<string, CloudFormationResource> {
  return {
    ConfigTable: {
      Type: 'AWS::DynamoDB::Table',
      Properties: {
        TableName: { 'Fn::Sub': 'PolicyEnforcer-Config-${AWS::StackName}' },
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [{ AttributeName: 'policyId', AttributeType: 'S' }],
        KeySchema: [{ AttributeName: 'policyId', KeyType: 'HASH' }],
        SSESpecification: {
          SSEEnabled: true,
          SSEType: 'KMS',
        },
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
        Tags: resourceTags,
      },
    },
  };
}

function buildLambdaExecutionRole(
  policyType: 'IAM' | 'SCP',
  vpcDeployment: boolean,
  resourceTags: Array<{ Key: string; Value: string | Record<string, unknown> }>,
): Record<string, CloudFormationResource> {
  const policies: unknown[] = [
    {
      PolicyName: 'DynamoDBAccess',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'dynamodb:GetItem',
              'dynamodb:PutItem',
              'dynamodb:UpdateItem',
              'dynamodb:Query',
            ],
            Resource: { 'Fn::GetAtt': ['ConfigTable', 'Arn'] },
          },
        ],
      },
    },
    {
      PolicyName: 'CloudWatchMetrics',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['cloudwatch:PutMetricData'],
            Resource: '*',
            Condition: {
              StringEquals: {
                'cloudwatch:namespace': 'PolicyEnforcer',
              },
            },
          },
        ],
      },
    },
    {
      PolicyName: 'CloudWatchLogs',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: {
              'Fn::Sub': 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/*',
            },
          },
        ],
      },
    },
  ];

  if (policyType === 'IAM') {
    policies.push({
      PolicyName: 'IAMPolicyManagement',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'iam:CreatePolicyVersion',
              'iam:DeletePolicyVersion',
              'iam:GetPolicy',
              'iam:GetPolicyVersion',
              'iam:ListPolicyVersions',
            ],
            Resource: { 'Fn::GetAtt': ['ManagedPolicy', 'Arn'] },
          },
        ],
      },
    });
  } else {
    policies.push({
      PolicyName: 'SCPManagement',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'organizations:CreatePolicy',
              'organizations:UpdatePolicy',
              'organizations:DescribePolicy',
              'organizations:ListPolicies',
            ],
            Resource: '*',
          },
        ],
      },
    });
  }

  if (vpcDeployment) {
    policies.push({
      PolicyName: 'VPCAccess',
      PolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'ec2:CreateNetworkInterface',
              'ec2:DescribeNetworkInterfaces',
              'ec2:DeleteNetworkInterface',
            ],
            Resource: '*',
          },
        ],
      },
    });
  }

  return {
    LambdaExecutionRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        RoleName: { 'Fn::Sub': 'PolicyEnforcer-LambdaRole-${AWS::StackName}' },
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        Policies: policies,
        Tags: resourceTags,
      },
    },
  };
}

function buildManagedPolicy(
  policyType: 'IAM' | 'SCP',
  resourceTags: Array<{ Key: string; Value: string | Record<string, unknown> }>,
): Record<string, CloudFormationResource> {
  if (policyType === 'IAM') {
    return {
      ManagedPolicy: {
        Type: 'AWS::IAM::ManagedPolicy',
        Properties: {
          ManagedPolicyName: { 'Fn::Sub': 'PolicyEnforcer-Policy-${AWS::StackName}' },
          Description: 'Managed policy generated by Policy Enforcer. Updated on each refresh cycle.',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Sid: 'PolicyEnforcerPlaceholder',
                Effect: 'Deny',
                Action: 'none:Placeholder',
                Resource: '*',
              },
            ],
          },
          Tags: resourceTags,
        },
      },
    };
  }

  // For SCP, we create a placeholder that will be updated by the Lambda
  return {
    ManagedPolicy: {
      Type: 'AWS::IAM::ManagedPolicy',
      Properties: {
        ManagedPolicyName: { 'Fn::Sub': 'PolicyEnforcer-SCPReference-${AWS::StackName}' },
        Description:
          'Reference policy for SCP-based Policy Enforcer. The actual SCP is managed via Organizations API.',
        PolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'PolicyEnforcerSCPPlaceholder',
              Effect: 'Deny',
              Action: 'none:Placeholder',
              Resource: '*',
            },
          ],
        },
        Tags: resourceTags,
      },
    },
  };
}

function buildRefreshLambda(
  params: TemplateParameters,
  resourceTags: Array<{ Key: string; Value: string | Record<string, unknown> }>,
): Record<string, CloudFormationResource> {
  const environmentVariables: Record<string, unknown> = {
    CONFIG_TABLE_NAME: { Ref: 'ConfigTable' },
    CATALOG_API_ENDPOINT: { Ref: 'CatalogApiEndpoint' },
    POLICY_CONFIG_ID: { Ref: 'PolicyConfigId' },
    POLICY_TYPE: { Ref: 'PolicyType' },
    POLICY_ARN: { 'Fn::GetAtt': ['ManagedPolicy', 'Arn'] },
  };

  const lambdaProperties: Record<string, unknown> = {
    FunctionName: { 'Fn::Sub': 'PolicyEnforcer-Refresh-${AWS::StackName}' },
    Runtime: 'nodejs24.x',
    Architectures: ['arm64'],
    Handler: 'refresh-lambda-main.handler',
    MemorySize: 256,
    Timeout: 300,
    Role: { 'Fn::GetAtt': ['LambdaExecutionRole', 'Arn'] },
    Environment: {
      Variables: environmentVariables,
    },
    Code: {
      ZipFile: buildRefreshLambdaInlineCode(),
    },
    Tags: resourceTags,
  };

  if (params.vpcDeployment) {
    lambdaProperties.VpcConfig = {
      SubnetIds: { 'Fn::Split': [',', { Ref: 'SubnetIds' }] },
      SecurityGroupIds: [{ Ref: 'SecurityGroupId' }],
    };
  }

  return {
    RefreshLambda: {
      Type: 'AWS::Lambda::Function',
      Properties: lambdaProperties,
      DependsOn: ['LambdaExecutionRole', 'ConfigTable', 'ManagedPolicy'],
    },
  };
}

function buildRefreshLambdaInlineCode(): string {
  // Minimal inline bootstrap code. In production, this would be replaced
  // with an S3 bucket reference containing the full Lambda package.
  return [
    "const https = require('https');",
    "exports.handler = async function(event) {",
    "  console.log('Policy Enforcer Refresh Lambda triggered', JSON.stringify(event));",
    "  const configTable = process.env.CONFIG_TABLE_NAME;",
    "  const catalogEndpoint = process.env.CATALOG_API_ENDPOINT;",
    "  const policyConfigId = process.env.POLICY_CONFIG_ID;",
    "  const policyType = process.env.POLICY_TYPE;",
    "  const policyArn = process.env.POLICY_ARN;",
    "  // Full implementation deployed via code package update",
    "  return { success: true, message: 'Placeholder - deploy full package for production use' };",
    '};',
  ].join('\n');
}

function buildRefreshSchedule(
  resourceTags: Array<{ Key: string; Value: string | Record<string, unknown> }>,
): Record<string, CloudFormationResource> {
  return {
    RefreshSchedule: {
      Type: 'AWS::Events::Rule',
      Properties: {
        Name: { 'Fn::Sub': 'PolicyEnforcer-Schedule-${AWS::StackName}' },
        Description: 'Triggers the Policy Enforcer Refresh Lambda on a periodic schedule.',
        ScheduleExpression: {
          'Fn::Sub': 'rate(${RefreshIntervalHours} hours)',
        },
        State: 'ENABLED',
        Targets: [
          {
            Id: 'RefreshLambdaTarget',
            Arn: { 'Fn::GetAtt': ['RefreshLambda', 'Arn'] },
          },
        ],
        Tags: resourceTags,
      },
      DependsOn: 'RefreshLambda',
    },
    RefreshSchedulePermission: {
      Type: 'AWS::Lambda::Permission',
      Properties: {
        FunctionName: { Ref: 'RefreshLambda' },
        Action: 'lambda:InvokeFunction',
        Principal: 'events.amazonaws.com',
        SourceArn: { 'Fn::GetAtt': ['RefreshSchedule', 'Arn'] },
      },
    },
  };
}

function buildInitialRefreshCustomResource(
  resourceTags: Array<{ Key: string; Value: string | Record<string, unknown> }>,
): Record<string, CloudFormationResource> {
  return {
    InitialRefreshTriggerRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'lambda.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        Policies: [
          {
            PolicyName: 'InvokeLambda',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [
                {
                  Effect: 'Allow',
                  Action: ['lambda:InvokeFunction'],
                  Resource: { 'Fn::GetAtt': ['RefreshLambda', 'Arn'] },
                },
                {
                  Effect: 'Allow',
                  Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                  Resource: {
                    'Fn::Sub':
                      'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/*',
                  },
                },
              ],
            },
          },
        ],
        Tags: resourceTags,
      },
    },
    InitialRefreshTriggerFunction: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        Runtime: 'nodejs24.x',
        Architectures: ['arm64'],
        Handler: 'index.handler',
        Timeout: 300,
        MemorySize: 128,
        Role: { 'Fn::GetAtt': ['InitialRefreshTriggerRole', 'Arn'] },
        Environment: {
          Variables: {
            REFRESH_LAMBDA_ARN: { 'Fn::GetAtt': ['RefreshLambda', 'Arn'] },
          },
        },
        Code: {
          ZipFile: buildCustomResourceInlineCode(),
        },
        Tags: resourceTags,
      },
      DependsOn: ['InitialRefreshTriggerRole', 'RefreshLambda'],
    },
    InitialRefreshCustomResource: {
      Type: 'AWS::CloudFormation::CustomResource',
      Properties: {
        ServiceToken: { 'Fn::GetAtt': ['InitialRefreshTriggerFunction', 'Arn'] },
        ServiceTimeout: 300,
      },
      DependsOn: ['InitialRefreshTriggerFunction', 'RefreshLambda', 'ConfigTable', 'ManagedPolicy'],
    },
  };
}

function buildCustomResourceInlineCode(): string {
  return [
    "const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');",
    "const https = require('https');",
    "const url = require('url');",
    '',
    'exports.handler = async function(event, context) {',
    "  console.log('Custom resource event:', JSON.stringify(event));",
    '  const responseData = {};',
    '  try {',
    "    if (event.RequestType === 'Create' || event.RequestType === 'Update') {",
    '      const client = new LambdaClient({});',
    '      const command = new InvokeCommand({',
    '        FunctionName: process.env.REFRESH_LAMBDA_ARN,',
    "        InvocationType: 'RequestResponse',",
    '      });',
    '      const result = await client.send(command);',
    "      console.log('Initial refresh result:', JSON.stringify(result));",
    '    }',
    "    await sendResponse(event, context, 'SUCCESS', responseData);",
    '  } catch (error) {',
    "    console.error('Initial refresh failed:', error);",
    "    await sendResponse(event, context, 'FAILED', { Error: error.message });",
    '  }',
    '};',
    '',
    'async function sendResponse(event, context, status, data) {',
    '  const body = JSON.stringify({',
    '    Status: status,',
    "    Reason: `See CloudWatch Log Stream: ${context.logStreamName}`,",
    '    PhysicalResourceId: context.logStreamName,',
    '    StackId: event.StackId,',
    '    RequestId: event.RequestId,',
    '    LogicalResourceId: event.LogicalResourceId,',
    '    Data: data,',
    '  });',
    '',
    '  const parsedUrl = url.parse(event.ResponseURL);',
    '  const options = {',
    '    hostname: parsedUrl.hostname,',
    '    port: 443,',
    '    path: parsedUrl.path,',
    "    method: 'PUT',",
    '    headers: {',
    "      'Content-Type': '',",
    "      'Content-Length': body.length,",
    '    },',
    '  };',
    '',
    '  return new Promise((resolve, reject) => {',
    '    const req = https.request(options, (res) => resolve(res));',
    "    req.on('error', (err) => reject(err));",
    '    req.write(body);',
    '    req.end();',
    '  });',
    '}',
  ].join('\n');
}

function buildVpcEndpoints(
  resourceTags: Array<{ Key: string; Value: string | Record<string, unknown> }>,
  _tags?: Array<{ key: string; value: string }>,
): Record<string, CloudFormationResource> {
  const condition = 'IsVpcDeployment';

  return {
    DynamoDBVpcEndpoint: {
      Type: 'AWS::EC2::VPCEndpoint',
      Condition: condition,
      Properties: {
        VpcId: { Ref: 'VpcId' },
        ServiceName: { 'Fn::Sub': 'com.amazonaws.${AWS::Region}.dynamodb' },
        VpcEndpointType: 'Gateway',
        RouteTableIds: [],
        Tags: resourceTags,
      },
    },
    IAMVpcEndpoint: {
      Type: 'AWS::EC2::VPCEndpoint',
      Condition: condition,
      Properties: {
        VpcId: { Ref: 'VpcId' },
        ServiceName: { 'Fn::Sub': 'com.amazonaws.${AWS::Region}.iam' },
        VpcEndpointType: 'Interface',
        SubnetIds: { 'Fn::Split': [',', { Ref: 'SubnetIds' }] },
        SecurityGroupIds: [{ Ref: 'SecurityGroupId' }],
        PrivateDnsEnabled: true,
        Tags: resourceTags,
      },
    },
    OrganizationsVpcEndpoint: {
      Type: 'AWS::EC2::VPCEndpoint',
      Condition: condition,
      Properties: {
        VpcId: { Ref: 'VpcId' },
        ServiceName: { 'Fn::Sub': 'com.amazonaws.${AWS::Region}.organizations' },
        VpcEndpointType: 'Interface',
        SubnetIds: { 'Fn::Split': [',', { Ref: 'SubnetIds' }] },
        SecurityGroupIds: [{ Ref: 'SecurityGroupId' }],
        PrivateDnsEnabled: true,
        Tags: resourceTags,
      },
    },
    CatalogApiVpcEndpoint: {
      Type: 'AWS::EC2::VPCEndpoint',
      Condition: condition,
      Properties: {
        VpcId: { Ref: 'VpcId' },
        ServiceName: { 'Fn::Sub': 'com.amazonaws.${AWS::Region}.execute-api' },
        VpcEndpointType: 'Interface',
        SubnetIds: { 'Fn::Split': [',', { Ref: 'SubnetIds' }] },
        SecurityGroupIds: [{ Ref: 'SecurityGroupId' }],
        PrivateDnsEnabled: true,
        Tags: resourceTags,
      },
    },
  };
}

function buildOutputs(policyType: 'IAM' | 'SCP'): Record<string, CloudFormationOutput> {
  const outputs: Record<string, CloudFormationOutput> = {
    PolicyArn: {
      Description:
        policyType === 'IAM'
          ? 'The ARN of the managed IAM policy generated by Policy Enforcer.'
          : 'The ARN of the reference policy for the SCP-based Policy Enforcer.',
      Value: { 'Fn::GetAtt': ['ManagedPolicy', 'Arn'] },
      Export: {
        Name: { 'Fn::Sub': '${AWS::StackName}-PolicyArn' },
      },
    },
    RefreshLambdaArn: {
      Description: 'The ARN of the Refresh Lambda function.',
      Value: { 'Fn::GetAtt': ['RefreshLambda', 'Arn'] },
    },
    ConfigTableName: {
      Description: 'The name of the DynamoDB configuration table.',
      Value: { Ref: 'ConfigTable' },
    },
    RefreshScheduleArn: {
      Description: 'The ARN of the EventBridge refresh schedule rule.',
      Value: { 'Fn::GetAtt': ['RefreshSchedule', 'Arn'] },
    },
  };

  return outputs;
}
