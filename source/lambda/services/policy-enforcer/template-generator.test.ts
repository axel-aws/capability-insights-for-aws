import { describe, it, expect } from 'vitest';
import { generateDeploymentTemplate } from './template-generator';
import type { TemplateParameters } from './template-generator';

/**
 * Unit tests for generateDeploymentTemplate.
 * Validates: Requirements 9.1, 9.2, 9.3, 9.5, 9.6, 7a.6
 */

const DEFAULT_PARAMS: TemplateParameters = {
  catalogApiEndpoint: 'https://api.example.com/catalog',
  refreshIntervalHours: 24,
  vpcDeployment: false,
  policyType: 'IAM',
  policyConfigId: 'policy-config-123',
};

const VPC_PARAMS: TemplateParameters = {
  catalogApiEndpoint: 'https://api.example.com/catalog',
  refreshIntervalHours: 12,
  vpcDeployment: true,
  policyType: 'IAM',
  policyConfigId: 'policy-config-vpc-456',
};

const TAGGED_PARAMS: TemplateParameters = {
  ...DEFAULT_PARAMS,
  tags: [
    { key: 'team', value: 'payments' },
    { key: 'environment', value: 'production' },
    { key: 'application', value: 'order-service' },
  ],
};

describe('generateDeploymentTemplate', () => {
  describe('snapshot test with default parameters', () => {
    it('generates expected template with default parameters', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      expect(result).toMatchSnapshot();
    });
  });

  describe('snapshot test with VPC deployment enabled', () => {
    it('generates expected template with VPC deployment', () => {
      const result = generateDeploymentTemplate(VPC_PARAMS);
      expect(result).toMatchSnapshot();
    });
  });

  describe('all required resources are present in output', () => {
    it('contains all required CloudFormation resources', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);

      // Requirement 9.1: RefreshLambda (Node.js runtime on arm64/Graviton)
      expect(template.Resources.RefreshLambda).toBeDefined();
      expect(template.Resources.RefreshLambda.Type).toBe('AWS::Lambda::Function');
      expect(template.Resources.RefreshLambda.Properties.Runtime).toBe('nodejs24.x');
      expect(template.Resources.RefreshLambda.Properties.Architectures).toEqual(['arm64']);
      expect(template.Resources.RefreshLambda.Properties.MemorySize).toBe(256);
      expect(template.Resources.RefreshLambda.Properties.Timeout).toBe(300);

      // Requirement 9.1: ConfigTable (DynamoDB)
      expect(template.Resources.ConfigTable).toBeDefined();
      expect(template.Resources.ConfigTable.Type).toBe('AWS::DynamoDB::Table');
      expect(template.Resources.ConfigTable.Properties.BillingMode).toBe('PAY_PER_REQUEST');

      // Requirement 9.1: LambdaExecutionRole (IAM role)
      expect(template.Resources.LambdaExecutionRole).toBeDefined();
      expect(template.Resources.LambdaExecutionRole.Type).toBe('AWS::IAM::Role');

      // Requirement 9.1: RefreshSchedule (EventBridge rule)
      expect(template.Resources.RefreshSchedule).toBeDefined();
      expect(template.Resources.RefreshSchedule.Type).toBe('AWS::Events::Rule');

      // ManagedPolicy (initially empty)
      expect(template.Resources.ManagedPolicy).toBeDefined();
      expect(template.Resources.ManagedPolicy.Type).toBe('AWS::IAM::ManagedPolicy');

      // Requirement 9.8: InitialRefreshCustomResource
      expect(template.Resources.InitialRefreshCustomResource).toBeDefined();
      expect(template.Resources.InitialRefreshCustomResource.Type).toBe(
        'AWS::CloudFormation::CustomResource',
      );

      // EventBridge permission for Lambda invocation
      expect(template.Resources.RefreshSchedulePermission).toBeDefined();
      expect(template.Resources.RefreshSchedulePermission.Type).toBe('AWS::Lambda::Permission');
    });

    it('contains required parameters', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);

      // Requirement 9.2: Parameters for catalog API endpoint and refresh interval
      expect(template.Parameters.CatalogApiEndpoint).toBeDefined();
      expect(template.Parameters.CatalogApiEndpoint.Default).toBe(
        'https://api.example.com/catalog',
      );

      expect(template.Parameters.RefreshIntervalHours).toBeDefined();
      expect(template.Parameters.RefreshIntervalHours.Default).toBe(24);

      expect(template.Parameters.PolicyConfigId).toBeDefined();
      expect(template.Parameters.PolicyConfigId.Default).toBe('policy-config-123');

      expect(template.Parameters.PolicyType).toBeDefined();
      expect(template.Parameters.PolicyType.Default).toBe('IAM');
    });

    it('contains required outputs including Policy ARN', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);

      // Requirement 9.5: Output the Policy ARN
      expect(template.Outputs.PolicyArn).toBeDefined();
      expect(template.Outputs.PolicyArn.Value).toEqual({
        'Fn::GetAtt': ['ManagedPolicy', 'Arn'],
      });
      expect(template.Outputs.PolicyArn.Export).toBeDefined();

      expect(template.Outputs.RefreshLambdaArn).toBeDefined();
      expect(template.Outputs.ConfigTableName).toBeDefined();
      expect(template.Outputs.RefreshScheduleArn).toBeDefined();
    });

    it('configures DynamoDB with encryption at rest', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);

      // Requirement 9.3: Encryption at rest
      const configTable = template.Resources.ConfigTable.Properties;
      expect(configTable.SSESpecification).toBeDefined();
      expect(configTable.SSESpecification.SSEEnabled).toBe(true);
    });
  });

  describe('VPC deployment creates VPC endpoints', () => {
    it('includes VPC endpoints when vpcDeployment is true', () => {
      const result = generateDeploymentTemplate(VPC_PARAMS);
      const template = JSON.parse(result);

      // Requirement 9.6: VPC endpoints for DynamoDB, IAM, Organizations, Catalog API
      expect(template.Resources.DynamoDBVpcEndpoint).toBeDefined();
      expect(template.Resources.DynamoDBVpcEndpoint.Type).toBe('AWS::EC2::VPCEndpoint');

      expect(template.Resources.IAMVpcEndpoint).toBeDefined();
      expect(template.Resources.IAMVpcEndpoint.Type).toBe('AWS::EC2::VPCEndpoint');

      expect(template.Resources.OrganizationsVpcEndpoint).toBeDefined();
      expect(template.Resources.OrganizationsVpcEndpoint.Type).toBe('AWS::EC2::VPCEndpoint');

      expect(template.Resources.CatalogApiVpcEndpoint).toBeDefined();
      expect(template.Resources.CatalogApiVpcEndpoint.Type).toBe('AWS::EC2::VPCEndpoint');
    });

    it('includes VPC parameters when vpcDeployment is true', () => {
      const result = generateDeploymentTemplate(VPC_PARAMS);
      const template = JSON.parse(result);

      // Requirement 9.2: Optional VPC configuration parameters
      expect(template.Parameters.VpcDeployment).toBeDefined();
      expect(template.Parameters.VpcId).toBeDefined();
      expect(template.Parameters.SubnetIds).toBeDefined();
      expect(template.Parameters.SecurityGroupId).toBeDefined();
    });

    it('configures Lambda with VPC config when vpcDeployment is true', () => {
      const result = generateDeploymentTemplate(VPC_PARAMS);
      const template = JSON.parse(result);

      expect(template.Resources.RefreshLambda.Properties.VpcConfig).toBeDefined();
      expect(template.Resources.RefreshLambda.Properties.VpcConfig.SubnetIds).toBeDefined();
      expect(
        template.Resources.RefreshLambda.Properties.VpcConfig.SecurityGroupIds,
      ).toBeDefined();
    });

    it('does not include VPC endpoints when vpcDeployment is false', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);

      expect(template.Resources.DynamoDBVpcEndpoint).toBeUndefined();
      expect(template.Resources.IAMVpcEndpoint).toBeUndefined();
      expect(template.Resources.OrganizationsVpcEndpoint).toBeUndefined();
      expect(template.Resources.CatalogApiVpcEndpoint).toBeUndefined();
    });
  });

  describe('IAM policy type vs SCP type produces correct resource configuration', () => {
    it('IAM type includes IAM policy management permissions in execution role', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);

      const role = template.Resources.LambdaExecutionRole.Properties;
      const policies = role.Policies as Array<{ PolicyName: string; PolicyDocument: unknown }>;
      const policyNames = policies.map((p) => p.PolicyName);

      expect(policyNames).toContain('IAMPolicyManagement');
      expect(policyNames).not.toContain('SCPManagement');
    });

    it('SCP type includes Organizations policy management permissions in execution role', () => {
      const scpParams: TemplateParameters = {
        ...DEFAULT_PARAMS,
        policyType: 'SCP',
      };

      const result = generateDeploymentTemplate(scpParams);
      const template = JSON.parse(result);

      const role = template.Resources.LambdaExecutionRole.Properties;
      const policies = role.Policies as Array<{ PolicyName: string; PolicyDocument: unknown }>;
      const policyNames = policies.map((p) => p.PolicyName);

      expect(policyNames).toContain('SCPManagement');
      expect(policyNames).not.toContain('IAMPolicyManagement');
    });

    it('IAM type creates a managed policy with IAM-specific naming', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);

      const policy = template.Resources.ManagedPolicy.Properties;
      expect(policy.ManagedPolicyName).toEqual({
        'Fn::Sub': 'PolicyEnforcer-Policy-${AWS::StackName}',
      });
      expect(policy.Description).toContain('Managed policy generated by Policy Enforcer');
    });

    it('SCP type creates a reference policy with SCP-specific naming', () => {
      const scpParams: TemplateParameters = {
        ...DEFAULT_PARAMS,
        policyType: 'SCP',
      };

      const result = generateDeploymentTemplate(scpParams);
      const template = JSON.parse(result);

      const policy = template.Resources.ManagedPolicy.Properties;
      expect(policy.ManagedPolicyName).toEqual({
        'Fn::Sub': 'PolicyEnforcer-SCPReference-${AWS::StackName}',
      });
      expect(policy.Description).toContain('SCP');
    });

    it('SCP type includes Organizations API actions in role policy', () => {
      const scpParams: TemplateParameters = {
        ...DEFAULT_PARAMS,
        policyType: 'SCP',
      };

      const result = generateDeploymentTemplate(scpParams);
      const template = JSON.parse(result);

      const role = template.Resources.LambdaExecutionRole.Properties;
      const policies = role.Policies as Array<{
        PolicyName: string;
        PolicyDocument: { Statement: Array<{ Action: string[] }> };
      }>;
      const scpPolicy = policies.find((p) => p.PolicyName === 'SCPManagement');

      expect(scpPolicy).toBeDefined();
      const actions = scpPolicy!.PolicyDocument.Statement[0].Action;
      expect(actions).toContain('organizations:CreatePolicy');
      expect(actions).toContain('organizations:UpdatePolicy');
      expect(actions).toContain('organizations:DescribePolicy');
      expect(actions).toContain('organizations:ListPolicies');
    });
  });

  describe('tags are propagated to all resources', () => {
    it('propagates user-defined tags to all taggable resources', () => {
      const result = generateDeploymentTemplate(TAGGED_PARAMS);
      const template = JSON.parse(result);

      // Check that user tags appear in resource tags
      const resourcesWithTags = [
        'ConfigTable',
        'LambdaExecutionRole',
        'ManagedPolicy',
        'RefreshLambda',
        'RefreshSchedule',
        'InitialRefreshTriggerRole',
        'InitialRefreshTriggerFunction',
      ];

      for (const resourceName of resourcesWithTags) {
        const resource = template.Resources[resourceName];
        expect(resource, `Resource ${resourceName} should exist`).toBeDefined();

        const tags = resource.Properties.Tags;
        expect(tags, `Resource ${resourceName} should have Tags`).toBeDefined();

        // Verify user tags are present
        const tagKeys = tags.map((t: { Key: string }) => t.Key);
        expect(tagKeys).toContain('team');
        expect(tagKeys).toContain('environment');
        expect(tagKeys).toContain('application');

        // Verify user tag values
        const teamTag = tags.find((t: { Key: string }) => t.Key === 'team');
        expect(teamTag.Value).toBe('payments');

        const envTag = tags.find((t: { Key: string }) => t.Key === 'environment');
        expect(envTag.Value).toBe('production');

        const appTag = tags.find((t: { Key: string }) => t.Key === 'application');
        expect(appTag.Value).toBe('order-service');
      }
    });

    it('includes system tags on all resources', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);

      const resourcesWithTags = [
        'ConfigTable',
        'LambdaExecutionRole',
        'ManagedPolicy',
        'RefreshLambda',
        'RefreshSchedule',
        'InitialRefreshTriggerRole',
        'InitialRefreshTriggerFunction',
      ];

      for (const resourceName of resourcesWithTags) {
        const resource = template.Resources[resourceName];
        const tags = resource.Properties.Tags;

        // Requirement 7a.6: System tags are always present
        const tagKeys = tags.map((t: { Key: string }) => t.Key);
        expect(tagKeys).toContain('PolicyEnforcer:PolicyConfigId');
        expect(tagKeys).toContain('PolicyEnforcer:PolicyType');
        expect(tagKeys).toContain('PolicyEnforcer:ManagedBy');

        // Verify ManagedBy tag value
        const managedByTag = tags.find(
          (t: { Key: string }) => t.Key === 'PolicyEnforcer:ManagedBy',
        );
        expect(managedByTag.Value).toBe('PolicyEnforcer');
      }
    });

    it('propagates tags to VPC endpoints when VPC deployment is enabled', () => {
      const vpcTaggedParams: TemplateParameters = {
        ...VPC_PARAMS,
        tags: [{ key: 'team', value: 'platform' }],
      };

      const result = generateDeploymentTemplate(vpcTaggedParams);
      const template = JSON.parse(result);

      const vpcEndpoints = [
        'DynamoDBVpcEndpoint',
        'IAMVpcEndpoint',
        'OrganizationsVpcEndpoint',
        'CatalogApiVpcEndpoint',
      ];

      for (const endpointName of vpcEndpoints) {
        const resource = template.Resources[endpointName];
        expect(resource, `VPC endpoint ${endpointName} should exist`).toBeDefined();

        const tags = resource.Properties.Tags;
        expect(tags, `VPC endpoint ${endpointName} should have Tags`).toBeDefined();

        const tagKeys = tags.map((t: { Key: string }) => t.Key);
        expect(tagKeys).toContain('team');
        expect(tagKeys).toContain('PolicyEnforcer:ManagedBy');
      }
    });
  });

  describe('template output is valid JSON', () => {
    it('returns valid JSON string', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      expect(() => JSON.parse(result)).not.toThrow();
    });

    it('has correct AWSTemplateFormatVersion', () => {
      const result = generateDeploymentTemplate(DEFAULT_PARAMS);
      const template = JSON.parse(result);
      expect(template.AWSTemplateFormatVersion).toBe('2010-09-09');
    });
  });
});
