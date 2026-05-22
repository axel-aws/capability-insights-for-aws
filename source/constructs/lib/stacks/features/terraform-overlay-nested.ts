import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface TerraformOverlayNestedProps extends cdk.NestedStackProps {
  websiteBucketArn: string;
  deploymentAssetsBucketName: string;
  lambdaCodeZipPath: string;
  websiteBucketName: string;
}

/**
 * Terraform Overlay feature — Overlay Lambda + Secrets Manager for GitHub PAT.
 */
export class TerraformOverlayNestedStack extends cdk.NestedStack {
  public readonly overlayFunctionName: string;
  public readonly githubTokenSecretName: string;

  constructor(scope: Construct, id: string, props: TerraformOverlayNestedProps) {
    super(scope, id, props);

    const prefix = 'CapabilityInsights';

    // GitHub PAT Secret
    const secretName = `${prefix}GitHubPAT`;
    const githubPatSecret = new secretsmanager.CfnSecret(this, secretName, {
      name: cdk.Fn.sub(`${secretName}-\${AWS::Region}`),
      description: 'GitHub Personal Access Token for Terraform overlay',
    });
    githubPatSecret.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    this.githubTokenSecretName = cdk.Fn.ref(githubPatSecret.logicalId);

    // Terraform Overlay Lambda
    const overlayLambdaName = `${prefix}TerraformOverlayLambda`;
    const overlayRole = new iam.CfnRole(this, `${overlayLambdaName}Role`, {
      roleName: cdk.Fn.sub(`${overlayLambdaName}Role-\${AWS::Region}`),
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
                  `${props.websiteBucketArn}/data/json/terraform_overlay.json`,
                  `${props.websiteBucketArn}/data/json/terraform_classic_api_mapping.json`,
                ],
              },
            ],
          },
        },
      ],
    });

    new lambda.CfnFunction(this, overlayLambdaName, {
      functionName: overlayLambdaName,
      runtime: 'nodejs24.x',
      handler: 'lambda/terraform-overlay/handler.handler',
      role: cdk.Fn.getAtt(overlayRole.logicalId, 'Arn').toString(),
      code: {
        s3Bucket: props.deploymentAssetsBucketName,
        s3Key: props.lambdaCodeZipPath,
      },
      memorySize: 512,
      timeout: 300,
      environment: {
        variables: {
          DATA_BUCKET_NAME: props.websiteBucketName,
        },
      },
    });

    this.overlayFunctionName = overlayLambdaName;
  }
}
