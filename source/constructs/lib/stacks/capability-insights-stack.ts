import * as cdk from 'aws-cdk-lib';
import * as api from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface CapabilityInsightsStackProps extends cdk.StackProps {
  privateVpcId?: string;
  backendSubnetId?: string;
  apiAccessSubnetId?: string;
  deploymentAssetsBucketName?: string;
  sourceAccessPointArn?: string;
  sourceFolders?: string;
  analysisStateMachineArn?: string;
  cloudTrailAnalyzerLambdaName?: string;
}

export enum CapabilityInsightsStackOutputs {
  WebsiteBucketName = 'WebsiteBucketName',
  WebsiteBucketArn = 'WebsiteBucketArn',
}

/**
 * Main Capability Insights application stack.
 *
 * Creates the website S3 bucket, private API Gateway, API Lambda, data fetch Lambda,
 * VPC endpoints, and supporting resources. Accepts optional parameters from the
 * Usage Analysis stack (AnalysisStateMachineArn, CloudTrailAnalyzerLambdaName)
 * to enable the personalization features.
 *
 * Deployment order: Environment → Insights → Usage Analysis → Update Insights (with analysis params)
 */
export class CapabilityInsightsStack extends cdk.Stack {
  constructor(app: cdk.App, id: string, props?: CapabilityInsightsStackProps) {
    super(app, id, props);

    const prefix = 'CapabilityInsights';

    const vpcIdParameter = new cdk.CfnParameter(this, 'PrivateVpcId', {
      type: 'AWS::EC2::VPC::Id',
      description:
        'ID of VPC from where the Capability Insights website (hosted on S3 bucket) will be accessible from.',
      default: props?.privateVpcId,
    });
    const privateSubnetIdParameter = new cdk.CfnParameter(this, 'BackendSubnetId', {
      type: 'AWS::EC2::Subnet::Id',
      description: 'ID of subnet (ideally a private subnet) where the Lambda function will be running.',
      default: props?.backendSubnetId,
    });
    const publicSubnetIdParameter = new cdk.CfnParameter(this, 'ApiAccessSubnetId', {
      type: 'AWS::EC2::Subnet::Id',
      description:
        'ID of Subnet where users will browse Capability Insights website from, calls to back-end API will come from here. A VPC Endpoint to API Gateway will be created in this subnet to enable this.',
      default: props?.apiAccessSubnetId,
    });
    const deploymentAssetsBucketNameParameter = new cdk.CfnParameter(this, 'DeploymentAssetsBucketName', {
      type: 'String',
      description: 'Name of S3 bucket where Capability Insights deployment assets will be located.',
      default: props?.deploymentAssetsBucketName,
    });
    const deploymentAssetsBucketApiLambdaFunctionCodeZipPathParameter = new cdk.CfnParameter(
      this,
      'DeploymentAssetsBucketApiLambdaFunctionCodeZipPath',
      {
        type: 'String',
        description:
          "Path in the CapabilityInsights deployment assets bucket where Capability Insights's API Lambda function code zip is located.",
        default: 'lambdaAssets.zip',
      },
    );
    const sourceAccessPointArnParameter = new cdk.CfnParameter(this, 'SourceAccessPointArn', {
      type: 'String',
      description: 'ARN of the S3 access point that provides the capability data source.',
      default: props?.sourceAccessPointArn,
    });
    const analysisStateMachineArnParameter = new cdk.CfnParameter(this, 'AnalysisStateMachineArn', {
      type: 'String',
      description:
        'ARN of the Usage Analysis Step Functions state machine. Leave empty if Usage Analysis stack is not yet deployed.',
      default: props?.analysisStateMachineArn ?? '',
    });

    const hasAnalysisStateMachine = new cdk.CfnCondition(this, 'HasAnalysisStateMachine', {
      expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(analysisStateMachineArnParameter.valueAsString, '')),
    });

    const cloudTrailAnalyzerLambdaNameParameter = new cdk.CfnParameter(this, 'CloudTrailAnalyzerLambdaName', {
      type: 'String',
      description: 'Name of the CloudTrail Analyzer Lambda function.',
      default: props?.cloudTrailAnalyzerLambdaName ?? '',
    });

    const sourceFoldersParameter = new cdk.CfnParameter(this, 'SourceFolders', {
      type: 'String',
      description: 'Comma-separated list of folder names in the S3 access point to fetch data from.',
      default: props?.sourceFolders ?? 'public',
      allowedPattern: '^[a-zA-Z0-9_-]+(,[a-zA-Z0-9_-]+)*$',
      constraintDescription:
        'Must be a comma-separated list of folder names (letters, numbers, hyphens, underscores). No spaces or trailing commas.',
    });


    // Website bucket name: "capability-insights-website-{account}-{region}"
    // Also referenced in: deployment/deploy.sh, deployment/dev.sh, README.md
    const websiteBucketResourceName = `capability-insights-website`;
    const websiteBucket = new s3.CfnBucket(this, websiteBucketResourceName, {
      bucketName: cdk.Fn.sub('capability-insights-website-${AWS::AccountId}-${AWS::Region}'),
      publicAccessBlockConfiguration: {
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      },
      websiteConfiguration: {
        indexDocument: 'index.html',
        errorDocument: 'index.html',
      },
      corsConfiguration: {
        corsRules: [
          {
            allowedOrigins: ['*'],
            allowedMethods: ['GET', 'PUT', 'POST', 'HEAD'],
            allowedHeaders: ['*'],
            exposedHeaders: ['ETag'],
            maxAge: 3600,
          },
        ],
      },
      bucketEncryption: {
        serverSideEncryptionConfiguration: [
          {
            serverSideEncryptionByDefault: {
              sseAlgorithm: 'AES256',
            },
          },
        ],
      },
    });
    new s3.CfnBucketPolicy(this, `${websiteBucketResourceName}-Policy`, {
      bucket: websiteBucket.ref,
      policyDocument: {
        Statement: [
          {
            Sid: 'AllowVPCEndpointAccess',
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: [
              cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
              cdk.Fn.sub('${BucketArn}/*', {
                BucketArn: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
              }),
            ],
            Condition: {
              StringEquals: {
                'aws:SourceVpc': vpcIdParameter.valueAsString,
              },
            },
          },
        ],
      },
    });

    // API Gateway
    const apigwName = `${prefix}ApiGw`;
    const apigwSecurityGroup = new ec2.CfnSecurityGroup(this, `${prefix}ApiGwSecurityGroup`, {
      groupName: `${prefix}ApiGwSecurityGroup`,
      groupDescription: `Security Group for ${prefix} API Gateway`,
      vpcId: vpcIdParameter.valueAsString,
      securityGroupIngress: [
        {
          ipProtocol: 'tcp',
          fromPort: 443,
          toPort: 443,
          cidrIp: '0.0.0.0/0',
        },
      ],
    });

    const vpcApigwEndpoint = new ec2.CfnVPCEndpoint(this, `${prefix}ApiGwVpcEndpoint`, {
      vpcId: vpcIdParameter.valueAsString,
      vpcEndpointType: 'Interface',
      serviceName: cdk.Fn.sub('com.amazonaws.${AWS::Region}.execute-api'),
      privateDnsEnabled: true,
      subnetIds: [publicSubnetIdParameter.valueAsString],
      securityGroupIds: [apigwSecurityGroup.ref],
      tags: [{ key: 'Name', value: `${prefix}ApiGwVpcEndpoint` }],
    });

    // Allows the API Lambda (in the private subnet) to invoke other Lambda functions
    // via the AWS Lambda service API without needing internet access.
    new ec2.CfnVPCEndpoint(this, `${prefix}LambdaVpcEndpoint`, {
      vpcId: vpcIdParameter.valueAsString,
      vpcEndpointType: 'Interface',
      serviceName: cdk.Fn.sub('com.amazonaws.${AWS::Region}.lambda'),
      privateDnsEnabled: true,
      subnetIds: [privateSubnetIdParameter.valueAsString],
      securityGroupIds: [apigwSecurityGroup.ref],
      tags: [{ key: 'Name', value: `${prefix}LambdaVpcEndpoint` }],
    });

    // Allows the API Lambda to invoke Step Functions
    new ec2.CfnVPCEndpoint(this, `${prefix}StepFunctionsVpcEndpoint`, {
      vpcId: vpcIdParameter.valueAsString,
      vpcEndpointType: 'Interface',
      serviceName: cdk.Fn.sub('com.amazonaws.${AWS::Region}.states'),
      privateDnsEnabled: true,
      subnetIds: [privateSubnetIdParameter.valueAsString],
      securityGroupIds: [apigwSecurityGroup.ref],
      tags: [{ key: 'Name', value: `${prefix}StepFunctionsVpcEndpoint` }],
    });

    // Allows the API Lambda (in the private subnet) to call CloudFormation APIs
    // (ListStacks, ListStackResources, GetTemplate) without needing internet access.
    new ec2.CfnVPCEndpoint(this, `${prefix}CloudFormationVpcEndpoint`, {
      vpcId: vpcIdParameter.valueAsString,
      vpcEndpointType: 'Interface',
      serviceName: cdk.Fn.sub('com.amazonaws.${AWS::Region}.cloudformation'),
      privateDnsEnabled: true,
      subnetIds: [privateSubnetIdParameter.valueAsString],
      securityGroupIds: [apigwSecurityGroup.ref],
      tags: [{ key: 'Name', value: `${prefix}CloudFormationVpcEndpoint` }],
    });

    const apigw = new api.CfnRestApi(this, apigwName, {
      name: apigwName,
      description: 'Private REST API for Capability Insights',
      endpointConfiguration: {
        types: ['PRIVATE'],
        vpcEndpointIds: [vpcApigwEndpoint.ref],
      },
      policy: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: 'execute-api:Invoke',
            Resource: '*',
            Condition: {
              StringEquals: {
                'aws:SourceVpce': vpcApigwEndpoint.ref,
              },
            },
          },
        ],
      },
    });

    // Policy Configuration DynamoDB Table
    const policyTableName = `${prefix}PolicyConfiguration`;
    const policyTable = new dynamodb.CfnTable(this, policyTableName, {
      tableName: cdk.Fn.sub(`${policyTableName}-\${AWS::Region}`),
      billingMode: 'PAY_PER_REQUEST',
      sseSpecification: {
        sseEnabled: true,
      },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      keySchema: [
        {
          attributeName: 'policyId',
          keyType: 'HASH',
        },
      ],
      attributeDefinitions: [
        {
          attributeName: 'policyId',
          attributeType: 'S',
        },
        {
          attributeName: 'policyName',
          attributeType: 'S',
        },
        {
          attributeName: 'accountId',
          attributeType: 'S',
        },
        {
          attributeName: 'createdAt',
          attributeType: 'S',
        },
      ],
      globalSecondaryIndexes: [
        {
          indexName: 'PolicyNameIndex',
          keySchema: [
            {
              attributeName: 'policyName',
              keyType: 'HASH',
            },
          ],
          projection: {
            projectionType: 'ALL',
          },
        },
        {
          indexName: 'AccountIdIndex',
          keySchema: [
            {
              attributeName: 'accountId',
              keyType: 'HASH',
            },
            {
              attributeName: 'createdAt',
              keyType: 'RANGE',
            },
          ],
          projection: {
            projectionType: 'ALL',
          },
        },
      ],
    });
    policyTable.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Plan Configuration DynamoDB Table
    const planTableName = `${prefix}PlanConfiguration`;
    const planTable = new dynamodb.CfnTable(this, planTableName, {
      tableName: cdk.Fn.sub(`${planTableName}-\${AWS::Region}`),
      billingMode: 'PAY_PER_REQUEST',
      sseSpecification: {
        sseEnabled: true,
      },
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      keySchema: [
        {
          attributeName: 'planId',
          keyType: 'HASH',
        },
      ],
      attributeDefinitions: [
        {
          attributeName: 'planId',
          attributeType: 'S',
        },
        {
          attributeName: 'planName',
          attributeType: 'S',
        },
      ],
      globalSecondaryIndexes: [
        {
          indexName: 'PlanNameIndex',
          keySchema: [
            {
              attributeName: 'planName',
              keyType: 'HASH',
            },
          ],
          projection: {
            projectionType: 'ALL',
          },
        },
      ],
    });
    planTable.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Data Uploads DynamoDB Table
    const dataUploadsTableName = `${prefix}DataUploads`;
    const dataUploadsTable = new dynamodb.CfnTable(this, dataUploadsTableName, {
      tableName: cdk.Fn.sub(`${dataUploadsTableName}-\${AWS::Region}`),
      billingMode: 'PAY_PER_REQUEST',
      sseSpecification: { sseEnabled: true },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      keySchema: [{ attributeName: 'uploadId', keyType: 'HASH' }],
      attributeDefinitions: [
        { attributeName: 'uploadId', attributeType: 'S' },
        { attributeName: 'fileName', attributeType: 'S' },
        { attributeName: 'uploadedAt', attributeType: 'S' },
      ],
      globalSecondaryIndexes: [
        {
          indexName: 'FileNameIndex',
          keySchema: [
            { attributeName: 'fileName', keyType: 'HASH' },
            { attributeName: 'uploadedAt', keyType: 'RANGE' },
          ],
          projection: { projectionType: 'ALL' },
        },
      ],
    });
    dataUploadsTable.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Data Sources DynamoDB Table
    const dataSourcesTableName = `${prefix}DataSources`;
    const dataSourcesTable = new dynamodb.CfnTable(this, dataSourcesTableName, {
      tableName: cdk.Fn.sub(`${dataSourcesTableName}-\${AWS::Region}`),
      billingMode: 'PAY_PER_REQUEST',
      sseSpecification: { sseEnabled: true },
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      keySchema: [{ attributeName: 'id', keyType: 'HASH' }],
      attributeDefinitions: [
        { attributeName: 'id', attributeType: 'S' },
        { attributeName: 'arn', attributeType: 'S' },
      ],
      globalSecondaryIndexes: [
        {
          indexName: 'ArnIndex',
          keySchema: [{ attributeName: 'arn', keyType: 'HASH' }],
          projection: { projectionType: 'ALL' },
        },
      ],
    });
    dataSourcesTable.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // GitHub PAT Secret — stores the GitHub Personal Access Token in Secrets Manager
    const secretName = `${prefix}GitHubPAT`;
    const githubPatSecret = new secretsmanager.CfnSecret(this, secretName, {
      name: cdk.Fn.sub(`${secretName}-\${AWS::Region}`),
      description: 'GitHub Personal Access Token for Terraform overlay',
    });
    githubPatSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    // Data Fetch Lambda
    const terraformOverlayLambdaName = `${prefix}TerraformOverlayLambda`;
    const dataFetchLambdaName = `${prefix}DataFetchLambda`;
    const dataFetchLambdaRoleName = `${prefix}DataFetchLambdaRole`;
    const dataFetchLambdaRoleNameFn = cdk.Fn.sub(`${dataFetchLambdaRoleName}-\${AWS::Region}`);
    const dataFetchLambdaRole = new iam.CfnRole(this, dataFetchLambdaRoleName, {
      roleName: dataFetchLambdaRoleNameFn,
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      managedPolicyArns: [cdk.Fn.sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')],
      policies: [
        {
          policyName: 'S3ReadWritePolicy',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 's3:GetObject',
                Resource: '*',
              },
              {
                Effect: 'Allow',
                Action: ['s3:PutObject', 's3:GetObject'],
                Resource: cdk.Fn.sub('${BucketArn}/data/*', {
                  BucketArn: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
                }),
              },
              {
                Effect: 'Allow',
                Action: 's3:ListBucket',
                Resource: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
                Condition: {
                  StringLike: { 's3:prefix': 'data/uploads/*' },
                },
              },
            ],
          },
        },
        {
          policyName: 'InvokeTerraformOverlayLambda',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'lambda:InvokeFunction',
                Resource: cdk.Fn.sub(
                  'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${FunctionName}',
                  { FunctionName: terraformOverlayLambdaName },
                ),
              },
            ],
          },
        },
        {
          policyName: 'DynamoDBReadPolicy',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'dynamodb:GetItem',
                Resource: cdk.Fn.getAtt(policyTable.logicalId, 'Arn').toString(),
              },
            ],
          },
        },
        {
          policyName: 'SecretsManagerReadAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'secretsmanager:GetSecretValue',
                Resource: cdk.Fn.getAtt(githubPatSecret.logicalId, 'Id'),
              },
            ],
          },
        },
        {
          policyName: 'DynamoDBDataSourcesAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['dynamodb:Scan', 'dynamodb:UpdateItem'],
                Resource: cdk.Fn.getAtt(dataSourcesTable.logicalId, 'Arn').toString(),
              },
            ],
          },
        },
      ],
    });
    const dataFetchLambdaFunction = new lambda.CfnFunction(this, dataFetchLambdaName, {
      functionName: dataFetchLambdaName,
      runtime: 'nodejs24.x',
      role: cdk.Fn.getAtt(dataFetchLambdaRole.logicalId, 'Arn').toString(),
      handler: 'lambda/data-fetch-lambda-main.handler',
      memorySize: 2048,
      timeout: 120,
      code: {
        s3Bucket: deploymentAssetsBucketNameParameter.valueAsString,
        s3Key: deploymentAssetsBucketApiLambdaFunctionCodeZipPathParameter.valueAsString,
      },
      environment: {
        variables: {
          DATA_BUCKET_NAME: cdk.Fn.ref(websiteBucket.logicalId),
          DATA_BUCKET_PATH: 'data',
          SOURCE_ACCESS_POINT_ARN: sourceAccessPointArnParameter.valueAsString,
          SOURCE_FOLDERS: sourceFoldersParameter.valueAsString,
          TERRAFORM_OVERLAY_FUNCTION_NAME: terraformOverlayLambdaName,
          POLICY_TABLE_NAME: cdk.Fn.ref(policyTable.logicalId),
          GITHUB_TOKEN_SECRET_NAME: cdk.Fn.ref(githubPatSecret.logicalId),
          DATA_SOURCES_TABLE_NAME: cdk.Fn.ref(dataSourcesTable.logicalId),
        },
      },
    });
    const dataFetchLambdaScheduleRule = new events.CfnRule(this, `${prefix}DataFetchLambdaScheduleRule`, {
      description: `Daily trigger for ${dataFetchLambdaName} lambda function.`,
      scheduleExpression: 'rate(1 day)',
      state: 'ENABLED',
      targets: [
        {
          arn: cdk.Fn.getAtt(dataFetchLambdaFunction.logicalId, 'Arn').toString(),
          id: 'ScheduledLambdaTarget',
        },
      ],
    });
    new lambda.CfnPermission(this, `${prefix}DataFetchLambdaInvokePermission`, {
      functionName: cdk.Fn.ref(dataFetchLambdaFunction.logicalId),
      action: 'lambda:InvokeFunction',
      principal: 'events.amazonaws.com',
      sourceArn: cdk.Fn.getAtt(dataFetchLambdaScheduleRule.logicalId, 'Arn').toString(),
    });

    // Terraform Overlay Lambda — runs outside VPC (needs internet access for GitHub API)
    const terraformOverlayRoleName = `${prefix}TerraformOverlayLambdaRole`;
    const terraformOverlayRole = new iam.CfnRole(this, terraformOverlayRoleName, {
      roleName: cdk.Fn.sub(`${terraformOverlayRoleName}-\${AWS::Region}`),
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      },
      managedPolicyArns: [cdk.Fn.sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')],
      policies: [
        {
          policyName: 'S3PutOverlayData',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 's3:PutObject',
                Resource: [
                  cdk.Fn.sub('${BucketArn}/data/json/terraform_overlay.json', {
                    BucketArn: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
                  }),
                  cdk.Fn.sub('${BucketArn}/data/json/terraform_classic_api_mapping.json', {
                    BucketArn: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
                  }),
                ],
              },
            ],
          },
        },
      ],
    });
    const terraformOverlayLambdaFunction = new lambda.CfnFunction(this, terraformOverlayLambdaName, {
      functionName: terraformOverlayLambdaName,
      runtime: 'nodejs24.x',
      handler: 'lambda/terraform-overlay/handler.handler',
      role: cdk.Fn.getAtt(terraformOverlayRole.logicalId, 'Arn').toString(),
      code: {
        s3Bucket: deploymentAssetsBucketNameParameter.valueAsString,
        s3Key: deploymentAssetsBucketApiLambdaFunctionCodeZipPathParameter.valueAsString,
      },
      memorySize: 512,
      timeout: 300,
      environment: {
        variables: {
          DATA_BUCKET_NAME: cdk.Fn.ref(websiteBucket.logicalId),
        },
      },
    });

    // GitHub Fetch Lambda — runs outside VPC (needs internet access for GitHub API)
    const githubFetchLambdaName = `${prefix}GitHubFetchLambda`;
    const githubFetchRoleName = `${prefix}GitHubFetchLambdaRole`;
    const githubFetchRole = new iam.CfnRole(this, githubFetchRoleName, {
      roleName: cdk.Fn.sub(`${githubFetchRoleName}-\${AWS::Region}`),
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      },
      managedPolicyArns: [cdk.Fn.sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')],
    });
    new lambda.CfnFunction(this, githubFetchLambdaName, {
      functionName: githubFetchLambdaName,
      runtime: 'nodejs24.x',
      handler: 'lambda/github-fetch-lambda-main.handler',
      role: cdk.Fn.getAtt(githubFetchRole.logicalId, 'Arn').toString(),
      code: {
        s3Bucket: deploymentAssetsBucketNameParameter.valueAsString,
        s3Key: deploymentAssetsBucketApiLambdaFunctionCodeZipPathParameter.valueAsString,
      },
      memorySize: 512,
      timeout: 120,
    });

    // IAM Policy Helper Lambda — runs outside VPC to reach global IAM endpoint
    const iamHelperLambdaName = `${prefix}IAMPolicyHelper`;
    const iamHelperRoleName = `${prefix}IAMPolicyHelperRole`;
    const iamHelperRole = new iam.CfnRole(this, iamHelperRoleName, {
      roleName: cdk.Fn.sub(`${iamHelperRoleName}-\${AWS::Region}`),
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
      },
      managedPolicyArns: ['arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
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
                Resource: cdk.Fn.sub('arn:${AWS::Partition}:iam::${AWS::AccountId}:policy/PolicyEnforcer-*'),
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
        s3Bucket: deploymentAssetsBucketNameParameter.valueAsString,
        s3Key: deploymentAssetsBucketApiLambdaFunctionCodeZipPathParameter.valueAsString,
      },
      memorySize: 128,
      timeout: 30,
    });

    // API Lambda
    const apiLambdaName = `${prefix}ApiLambda`;
    const apiLambdaSecurityGroup = new ec2.CfnSecurityGroup(this, `${prefix}ApiLambdaSecurityGroup`, {
      groupDescription: `Security group for ${prefix} API Lambda`,
      vpcId: vpcIdParameter.valueAsString,
      securityGroupEgress: [
        {
          ipProtocol: '-1',
          cidrIp: '0.0.0.0/0',
        },
      ],
    });

    // Secrets Manager VPC Endpoint — allows API Lambda to access Secrets Manager
    // without traversing the public internet.
    const secretsManagerSecurityGroup = new ec2.CfnSecurityGroup(this, `${prefix}SecretsManagerVpceSg`, {
      groupDescription: 'Security group for Secrets Manager VPC endpoint',
      vpcId: vpcIdParameter.valueAsString,
      securityGroupIngress: [
        {
          ipProtocol: 'tcp',
          fromPort: 443,
          toPort: 443,
          sourceSecurityGroupId: apiLambdaSecurityGroup.ref,
        },
      ],
    });

    new ec2.CfnVPCEndpoint(this, `${prefix}SecretsManagerVpcEndpoint`, {
      vpcId: vpcIdParameter.valueAsString,
      vpcEndpointType: 'Interface',
      serviceName: cdk.Fn.sub('com.amazonaws.${AWS::Region}.secretsmanager'),
      privateDnsEnabled: true,
      subnetIds: [privateSubnetIdParameter.valueAsString],
      securityGroupIds: [secretsManagerSecurityGroup.ref],
      tags: [{ key: 'Name', value: `${prefix}SecretsManagerVpcEndpoint` }],
    });

    const apiLambdaRoleName = `${prefix}ApiLambdaRole`;
    const apiLambdaRoleNameFn = cdk.Fn.sub(`${apiLambdaRoleName}-\${AWS::Region}`);
    const apiLambdaRole = new iam.CfnRole(this, apiLambdaRoleName, {
      roleName: apiLambdaRoleNameFn,
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      managedPolicyArns: [
        cdk.Fn.sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
      policies: [
        {
          policyName: 'LambdaLogging',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                Resource: cdk.Fn.sub(
                  'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${FunctionName}:*',
                  { FunctionName: apiLambdaName },
                ),
              },
            ],
          },
        },
        {
          policyName: 'InvokeDataFetchLambda',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'lambda:InvokeFunction',
                Resource: [
                  cdk.Fn.sub(
                    'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${FunctionName}',
                    { FunctionName: dataFetchLambdaName },
                  ),
                  cdk.Fn.sub(
                    'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${FunctionName}',
                    { FunctionName: iamHelperLambdaName },
                  ),
                  cdk.Fn.sub(
                    'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${FunctionName}',
                    { FunctionName: githubFetchLambdaName },
                  ),
                ],
              },
            ],
          },
        },
        {
          policyName: 'StepFunctionsAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['states:StartExecution', 'states:DescribeExecution'],
                Resource: cdk.Fn.conditionIf(
                  hasAnalysisStateMachine.logicalId,
                  analysisStateMachineArnParameter.valueAsString,
                  cdk.Fn.sub('arn:${AWS::Partition}:states:${AWS::Region}:${AWS::AccountId}:stateMachine:none'),
                ),
              },
            ],
          },
        },
        {
          policyName: 'OrganizationsReadAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['organizations:ListAccounts', 'organizations:DescribeOrganization'],
                Resource: '*',
              },
            ],
          },
        },
        {
          policyName: 'CloudFormationReadAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'cloudformation:ListStacks',
                  'cloudformation:ListStackResources',
                  'cloudformation:GetTemplate',
                ],
                Resource: '*',
              },
            ],
          },
        },
        {
          policyName: 'S3ReadCapabilityData',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 's3:GetObject',
                Resource: cdk.Fn.sub('${BucketArn}/data/*', {
                  BucketArn: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
                }),
              },
              {
                Effect: 'Allow',
                Action: 's3:ListBucket',
                Resource: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
                Condition: {
                  StringLike: { 's3:prefix': 'data/*' },
                },
              },
            ],
          },
        },
        {
          policyName: 'S3PlanDataWriteDelete',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:PutObject', 's3:DeleteObject'],
                Resource: cdk.Fn.sub('${BucketArn}/data/*', {
                  BucketArn: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
                }),
              },
            ],
          },
        },
        {
          policyName: 'DynamoDBPolicyTableAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'dynamodb:GetItem',
                  'dynamodb:PutItem',
                  'dynamodb:UpdateItem',
                  'dynamodb:DeleteItem',
                  'dynamodb:Query',
                  'dynamodb:Scan',
                ],
                Resource: [
                  cdk.Fn.getAtt(policyTable.logicalId, 'Arn').toString(),
                  cdk.Fn.sub('${TableArn}/index/*', {
                    TableArn: cdk.Fn.getAtt(policyTable.logicalId, 'Arn').toString(),
                  }),
                ],
              },
            ],
          },
        },
        {
          policyName: 'DynamoDBPlanTableAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'dynamodb:GetItem',
                  'dynamodb:PutItem',
                  'dynamodb:UpdateItem',
                  'dynamodb:DeleteItem',
                  'dynamodb:Query',
                  'dynamodb:Scan',
                ],
                Resource: [
                  cdk.Fn.getAtt(planTable.logicalId, 'Arn').toString(),
                  cdk.Fn.sub('${TableArn}/index/*', {
                    TableArn: cdk.Fn.getAtt(planTable.logicalId, 'Arn').toString(),
                  }),
                ],
              },
            ],
          },
        },
        {
          policyName: 'DynamoDBDataUploadsTableAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'dynamodb:GetItem',
                  'dynamodb:PutItem',
                  'dynamodb:DeleteItem',
                  'dynamodb:Query',
                  'dynamodb:Scan',
                ],
                Resource: [
                  cdk.Fn.getAtt(dataUploadsTable.logicalId, 'Arn').toString(),
                  cdk.Fn.sub('${TableArn}/index/*', {
                    TableArn: cdk.Fn.getAtt(dataUploadsTable.logicalId, 'Arn').toString(),
                  }),
                ],
              },
            ],
          },
        },
        {
          policyName: 'DynamoDBDataSourcesTableAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: [
                  'dynamodb:GetItem',
                  'dynamodb:PutItem',
                  'dynamodb:UpdateItem',
                  'dynamodb:DeleteItem',
                  'dynamodb:Query',
                  'dynamodb:Scan',
                ],
                Resource: [
                  cdk.Fn.getAtt(dataSourcesTable.logicalId, 'Arn').toString(),
                  cdk.Fn.sub('${TableArn}/index/*', {
                    TableArn: cdk.Fn.getAtt(dataSourcesTable.logicalId, 'Arn').toString(),
                  }),
                ],
              },
            ],
          },
        },
        {
          policyName: 'SecretsManagerAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue'],
                Resource: cdk.Fn.getAtt(githubPatSecret.logicalId, 'Id'),
              },
            ],
          },
        },
      ],
    });
    const apiLambdaFunction = new lambda.CfnFunction(this, apiLambdaName, {
      functionName: apiLambdaName,
      runtime: 'nodejs24.x',
      handler: 'lambda/api-lambda-main.handler',
      role: cdk.Fn.getAtt(apiLambdaRole.logicalId, 'Arn').toString(),
      code: {
        s3Bucket: deploymentAssetsBucketNameParameter.valueAsString,
        s3Key: deploymentAssetsBucketApiLambdaFunctionCodeZipPathParameter.valueAsString,
      },
      vpcConfig: {
        securityGroupIds: [apiLambdaSecurityGroup.ref],
        subnetIds: [privateSubnetIdParameter.valueAsString],
      },
      memorySize: 512,
      timeout: 60, // 1 min
      environment: {
        variables: {
          WEBSITE_BUCKET_NAME: cdk.Fn.ref(websiteBucket.logicalId),
          DATA_FETCH_LAMBDA_NAME: dataFetchLambdaName,
          CLOUDTRAIL_ANALYZER_LAMBDA_NAME: cloudTrailAnalyzerLambdaNameParameter.valueAsString,
          ANALYSIS_STATE_MACHINE_ARN: analysisStateMachineArnParameter.valueAsString,
          POLICY_TABLE_NAME: cdk.Fn.ref(policyTable.logicalId),
          PLAN_TABLE_NAME: cdk.Fn.ref(planTable.logicalId),
          IAM_HELPER_LAMBDA_NAME: iamHelperLambdaName,
          GITHUB_TOKEN_SECRET_NAME: cdk.Fn.ref(githubPatSecret.logicalId),
          GITHUB_FETCH_FUNCTION_NAME: githubFetchLambdaName,
          DATA_UPLOADS_TABLE_NAME: cdk.Fn.ref(dataUploadsTable.logicalId),
          DATA_SOURCES_TABLE_NAME: cdk.Fn.ref(dataSourcesTable.logicalId),
        },
      },
    });
    new lambda.CfnPermission(this, `${prefix}ApiLambdaInvokePermission`, {
      functionName: apiLambdaFunction.ref,
      action: 'lambda:InvokeFunction',
      principal: 'apigateway.amazonaws.com',
      sourceArn: cdk.Fn.sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${ApiId}/*', {
        ApiId: apigw.attrRestApiId,
      }),
    });

    // API Gateway proxy resource — routes all requests to Lambda
    const apigwProxyResource = new api.CfnResource(this, `${prefix}ApiGwProxyResource`, {
      restApiId: apigw.ref,
      parentId: cdk.Fn.getAtt(apigw.logicalId, 'RootResourceId').toString(),
      pathPart: '{proxy+}',
    });
    const apigwProxyMethod = new api.CfnMethod(this, `${prefix}ApiGwProxyMethod`, {
      restApiId: apigw.attrRestApiId,
      resourceId: apigwProxyResource.ref,
      httpMethod: 'ANY',
      authorizationType: 'NONE',
      integration: {
        type: 'AWS_PROXY',
        integrationHttpMethod: 'POST',
        uri: cdk.Fn.sub(
          'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${LambdaArn}/invocations',
          {
            LambdaArn: cdk.Fn.getAtt(apiLambdaFunction.logicalId, 'Arn').toString(),
          },
        ),
      },
    });
    const apigwProxyOptionsMethod = new api.CfnMethod(this, `${prefix}ApiGwProxyOptionsMethod`, {
      restApiId: apigw.attrRestApiId,
      resourceId: apigwProxyResource.ref,
      httpMethod: 'OPTIONS',
      authorizationType: 'NONE',
      integration: {
        type: 'MOCK',
        requestTemplates: {
          'application/json': '{"statusCode": 200}',
        },
        integrationResponses: [
          {
            statusCode: '200',
            responseParameters: {
              'method.response.header.Access-Control-Allow-Headers':
                "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
              'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,DELETE,OPTIONS'",
              'method.response.header.Access-Control-Allow-Origin': "'*'",
            },
            responseTemplates: {
              'application/json': '',
            },
          },
        ],
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Origin': true,
          },
        },
      ],
    });
    const apiDeployment = new api.CfnDeployment(this, `${prefix}ApiGwDeployment`, {
      restApiId: apigw.attrRestApiId,
      description: `Deployment for ${prefix} API Gateway`,
    });
    apiDeployment.addDependency(apigwProxyMethod);
    apiDeployment.addDependency(apigwProxyOptionsMethod);

    // API Gateway Logging
    // Only need one of these per account to enable API gateway logging
    const apiGwCloudWatchLogsRoleNameFn = cdk.Fn.sub(`${prefix}ApiGwCloudWatchLogsRole-\${AWS::Region}`);
    const apiGwCloudWatchLogsRole = new iam.CfnRole(this, `${prefix}ApiGwCloudWatchLogsRole`, {
      roleName: apiGwCloudWatchLogsRoleNameFn,
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'apigateway.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      managedPolicyArns: [
        cdk.Fn.sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs'),
      ],
    });
    const apiGwAccount = new api.CfnAccount(this, `${prefix}ApiGwAccount`, {
      cloudWatchRoleArn: cdk.Fn.getAtt(apiGwCloudWatchLogsRole.logicalId, 'Arn').toString(),
    });
    apiGwAccount.addDependency(apiGwCloudWatchLogsRole);
    const apiAccessLogGroup = new logs.CfnLogGroup(this, `${prefix}ApiGwAccessLogGroup`, {
      logGroupName: cdk.Fn.sub('/aws/apigateway/${ApiId}/access-logs', {
        ApiId: apigw.attrRestApiId,
      }),
      retentionInDays: 30,
    });
    // CloudWatch Log Group for API Execution Logs
    new cdk.aws_logs.CfnLogGroup(this, `${prefix}ApiGwExecutionLogGroup`, {
      logGroupName: cdk.Fn.sub('API-Gateway-Execution-Logs_${ApiId}/prod', {
        ApiId: apigw.attrRestApiId,
      }),
      retentionInDays: 30,
    });
    // API Stage with CloudWatch Logging
    const apiStage = new api.CfnStage(this, `${prefix}ApiGwStage`, {
      restApiId: apigw.attrRestApiId,
      deploymentId: apiDeployment.attrDeploymentId,
      stageName: 'prod',
      description: 'Production stage with CloudWatch logging',
      methodSettings: [
        {
          resourcePath: '/*',
          httpMethod: '*',
          loggingLevel: 'INFO',
          dataTraceEnabled: false,
          metricsEnabled: true,
        },
      ],
      accessLogSetting: {
        destinationArn: cdk.Fn.getAtt(apiAccessLogGroup.logicalId, 'Arn').toString(),
        format:
          '$context.requestId $context.extendedRequestId $context.identity.sourceIp $context.requestTime $context.routeKey $context.status',
      },
    });
    apiStage.addDependency(apiGwAccount);

    // Write Config Lambda — writes the API Gateway URL to S3 as api-config.json
    const writeConfigLambdaName = `${prefix}WriteConfigLambda`;
    const writeConfigLambdaRoleName = `${prefix}WriteConfigLambdaRole`;
    const writeConfigLambdaRoleNameFn = cdk.Fn.sub(`${writeConfigLambdaRoleName}-\${AWS::Region}`);
    const writeConfigLambdaRole = new iam.CfnRole(this, writeConfigLambdaRoleName, {
      roleName: writeConfigLambdaRoleNameFn,
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      managedPolicyArns: [cdk.Fn.sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')],
      policies: [
        {
          policyName: 'S3WriteAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['s3:PutObject'],
                Resource: cdk.Fn.sub('${BucketArn}/*', {
                  BucketArn: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
                }),
              },
            ],
          },
        },
      ],
    });

    const writeConfigLambdaFunction = new cdk.aws_lambda.CfnFunction(this, writeConfigLambdaName, {
      functionName: writeConfigLambdaName,
      runtime: 'python3.11',
      handler: 'index.lambda_handler',
      role: cdk.Fn.getAtt(writeConfigLambdaRole.logicalId, 'Arn').toString(),
      code: {
        zipFile: `import json
import boto3
import cfnresponse

s3 = boto3.client('s3')

def lambda_handler(event, context):
    try:
        if event['RequestType'] == 'Delete':
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            return
        
        bucket = event['ResourceProperties']['Bucket']
        api_url = event['ResourceProperties']['ApiUrl']
        
        config = {
            'apiBaseUrl': api_url
        }
        
        s3.put_object(
            Bucket=bucket,
            Key='api-config.json',
            Body=json.dumps(config),
            ContentType='application/json'
        )
        
        cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {})`,
      },
      timeout: 30, // 30 seconds
    });
    // Custom Resource to invoke the Lambda function
    const writeConfigCustomResource = new cdk.CfnCustomResource(this, `${prefix}WriteConfigLambdaCustomResource`, {
      serviceToken: cdk.Fn.getAtt(writeConfigLambdaFunction.logicalId, 'Arn').toString(),
    });
    writeConfigCustomResource.addPropertyOverride('Bucket', cdk.Fn.ref(websiteBucket.logicalId));
    writeConfigCustomResource.addPropertyOverride(
      'ApiUrl',
      cdk.Fn.sub('https://${ApiId}.execute-api.${AWS::Region}.amazonaws.com/prod', {
        ApiId: apigw.attrRestApiId,
      }),
    );

    // Data Source Seed Lambda — seeds the default data source on stack create/update
    const dataSourceSeedLambdaName = `${prefix}DataSourceSeedLambda`;
    const dataSourceSeedLambdaRoleName = `${prefix}DataSourceSeedLambdaRole`;
    const dataSourceSeedLambdaRole = new iam.CfnRole(this, dataSourceSeedLambdaRoleName, {
      roleName: cdk.Fn.sub(`${dataSourceSeedLambdaRoleName}-\${AWS::Region}`),
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
      managedPolicyArns: [cdk.Fn.sub('arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole')],
      policies: [
        {
          policyName: 'DynamoDBDataSourcesSeedAccess',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['dynamodb:Scan', 'dynamodb:PutItem'],
                Resource: cdk.Fn.getAtt(dataSourcesTable.logicalId, 'Arn').toString(),
              },
            ],
          },
        },
      ],
    });
    const dataSourceSeedLambdaFunction = new lambda.CfnFunction(this, dataSourceSeedLambdaName, {
      functionName: dataSourceSeedLambdaName,
      runtime: 'nodejs24.x',
      handler: 'lambda/data-source-seed-lambda.handler',
      role: cdk.Fn.getAtt(dataSourceSeedLambdaRole.logicalId, 'Arn').toString(),
      code: {
        s3Bucket: deploymentAssetsBucketNameParameter.valueAsString,
        s3Key: deploymentAssetsBucketApiLambdaFunctionCodeZipPathParameter.valueAsString,
      },
      memorySize: 128,
      timeout: 30,
      environment: {
        variables: {
          DATA_SOURCES_TABLE_NAME: cdk.Fn.ref(dataSourcesTable.logicalId),
        },
      },
    });
    // Custom Resource that invokes the Seed Lambda on stack create/update
    const dataSourceSeedCustomResource = new cdk.CfnCustomResource(
      this,
      `${prefix}DataSourceSeedCustomResource`,
      {
        serviceToken: cdk.Fn.getAtt(dataSourceSeedLambdaFunction.logicalId, 'Arn').toString(),
      },
    );
    dataSourceSeedCustomResource.addPropertyOverride('TableName', cdk.Fn.ref(dataSourcesTable.logicalId));
    dataSourceSeedCustomResource.addPropertyOverride(
      'SourceAccessPointArn',
      sourceAccessPointArnParameter.valueAsString,
    );
    dataSourceSeedCustomResource.addPropertyOverride('SourceFolders', sourceFoldersParameter.valueAsString);

    // Outputs for cross-stack references
    new cdk.CfnOutput(this, CapabilityInsightsStackOutputs.WebsiteBucketName, {
      value: cdk.Fn.ref(websiteBucket.logicalId),
    });
    new cdk.CfnOutput(this, CapabilityInsightsStackOutputs.WebsiteBucketArn, {
      value: cdk.Fn.getAtt(websiteBucket.logicalId, 'Arn').toString(),
    });

    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: cdk.Fn.sub(
        'http://capability-insights-website-${AWS::AccountId}-${AWS::Region}.s3-website.${AWS::Region}.amazonaws.com',
      ),
      description: 'URL of the Capability Insights website (accessible from within the VPC)',
    });
  }
}
