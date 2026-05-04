# Requirements Document

## Introduction

The standard production deploy script (`deployment/deploy.sh`) currently requires users to provide infrastructure parameters (VPC ID, subnet IDs, deployment assets bucket name) either via command-line flags or interactive prompts. If any of these values are missing, the deployment cannot proceed. This feature adds automatic fallback infrastructure creation so that when a user omits any of the four infrastructure parameters, the deploy script detects the omission and provisions lightweight, minimal resources in-place — allowing the deployment to succeed without requiring a separate setup step or the full sample environment stack.

This is distinct from the existing dev setup (`deployment/dev.sh setup`), which deploys a heavyweight `CapabilityInsightsSampleEnvironment` CDK stack including EC2 instances, public subnets with internet gateways, and IAM instance profiles. The fallback infrastructure created by this feature is intentionally minimal: only the VPC, private subnet with S3 gateway endpoint, a second subnet for API access, and an S3 bucket — no EC2 instances or public internet access.

## Glossary

- **Deploy_Script**: The production deployment shell script at `deployment/deploy.sh` that orchestrates CloudFormation stack deployment, Lambda code upload, and website asset sync.
- **Fallback_Infrastructure**: A lightweight CloudFormation stack containing only the minimal AWS resources (VPC, subnets, S3 gateway endpoint, S3 bucket) needed for the CapabilityInsightsForAWS stack to function, created automatically when a user omits infrastructure parameters.
- **Fallback_Stack**: The CloudFormation stack named `CapabilityInsightsFallbackInfra` that contains the fallback infrastructure resources.
- **Main_Stack**: The primary `CapabilityInsightsForAWS` CloudFormation stack that deploys the Capability Insights application.
- **Sample_Environment_Stack**: The existing `CapabilityInsightsSampleEnvironment` CDK stack deployed by `deployment/dev.sh setup`, which creates a full development environment including EC2 instances.
- **Infrastructure_Parameters**: The four parameters required by the Main_Stack: `PrivateVpcId`, `BackendSubnetId`, `ApiAccessSubnetId`, and `DeploymentAssetsBucketName`.
- **S3_Gateway_Endpoint**: A VPC Gateway endpoint for the S3 service, required so that Lambda functions in the private subnet can access S3 without internet connectivity.
- **Fallback_Stack_Template**: A CloudFormation JSON template file that defines the Fallback_Stack resources, packaged alongside the existing deployment template in `deployment/dist/template/`.

## Requirements

### Requirement 1: Detect Missing Infrastructure Parameters

**User Story:** As a deployer, I want the Deploy_Script to detect which Infrastructure_Parameters I have not provided, so that it can determine whether fallback infrastructure is needed.

#### Acceptance Criteria

1. WHEN the Deploy_Script is invoked with the `deploy` command and one or more Infrastructure_Parameters are empty after flag parsing, THE Deploy_Script SHALL identify each missing parameter by name.
2. WHEN all four Infrastructure_Parameters are provided via command-line flags, THE Deploy_Script SHALL skip fallback detection and proceed directly to deployment.
3. WHEN the Deploy_Script detects missing Infrastructure_Parameters, THE Deploy_Script SHALL skip the interactive `prompt_if_empty` prompts for those parameters and instead proceed to fallback infrastructure creation.

### Requirement 2: Create Fallback VPC and Subnets

**User Story:** As a deployer, I want the system to automatically create a VPC with the required subnets when I do not provide VPC and subnet IDs, so that I can deploy without pre-existing network infrastructure.

#### Acceptance Criteria

1. WHEN `PrivateVpcId`, `BackendSubnetId`, or `ApiAccessSubnetId` are missing, THE Deploy_Script SHALL deploy the Fallback_Stack containing a VPC, a private subnet (backend), and a second subnet (API access).
2. THE Fallback_Stack SHALL create a VPC with DNS support and DNS hostnames enabled, matching the requirements of the Main_Stack for VPC endpoint private DNS resolution.
3. THE Fallback_Stack SHALL create a private subnet for the Lambda backend with no public IP assignment.
4. THE Fallback_Stack SHALL create a second subnet for the API Gateway VPC endpoint.
5. THE Fallback_Stack SHALL create an S3 Gateway Endpoint attached to the VPC with a route table entry for the private subnet, so that Lambda functions can read from S3.
6. THE Fallback_Stack SHALL export the VPC ID, backend subnet ID, and API access subnet ID as CloudFormation outputs.

### Requirement 3: Create Fallback S3 Deployment Assets Bucket

**User Story:** As a deployer, I want the system to automatically create an S3 bucket for deployment assets when I do not provide a bucket name, so that Lambda code can be uploaded without a pre-existing bucket.

#### Acceptance Criteria

1. WHEN `DeploymentAssetsBucketName` is missing, THE Fallback_Stack SHALL create an S3 bucket with a deterministic name following the pattern `capability-insights-assets-{AccountId}-{Region}`.
2. THE Fallback_Stack SHALL configure the S3 bucket with public access blocked (BlockPublicAcls, BlockPublicPolicy, IgnorePublicAcls, RestrictPublicBuckets all set to true).
3. THE Fallback_Stack SHALL configure the S3 bucket with AES256 server-side encryption by default.
4. THE Fallback_Stack SHALL export the bucket name as a CloudFormation output.

### Requirement 4: Resolve Fallback Stack Outputs

**User Story:** As a deployer, I want the Deploy_Script to read the outputs of the Fallback_Stack after creation, so that the resolved values can be passed to the Main_Stack deployment.

#### Acceptance Criteria

1. WHEN the Fallback_Stack deployment completes successfully, THE Deploy_Script SHALL query the Fallback_Stack outputs to retrieve the VPC ID, backend subnet ID, API access subnet ID, and deployment assets bucket name.
2. THE Deploy_Script SHALL use the retrieved Fallback_Stack output values to fill in only the Infrastructure_Parameters that were originally missing, preserving any user-provided values.
3. WHEN the Fallback_Stack deployment fails, THE Deploy_Script SHALL print the failure reason and exit with a non-zero status code.

### Requirement 5: Reuse Existing Fallback Stack

**User Story:** As a deployer, I want the system to reuse a previously created Fallback_Stack on subsequent deployments, so that infrastructure is not duplicated.

#### Acceptance Criteria

1. WHEN the Deploy_Script detects missing Infrastructure_Parameters and the Fallback_Stack already exists in a `CREATE_COMPLETE` or `UPDATE_COMPLETE` state, THE Deploy_Script SHALL read outputs from the existing Fallback_Stack instead of creating a new one.
2. WHEN the Fallback_Stack exists in a failed state (`ROLLBACK_COMPLETE`, `CREATE_FAILED`, `DELETE_FAILED`), THE Deploy_Script SHALL print a warning message describing the failed state and exit with a non-zero status code.
3. THE Deploy_Script SHALL print a message indicating whether the Fallback_Stack was newly created or reused from a previous deployment.

### Requirement 6: Fallback Stack Template Packaging

**User Story:** As a developer, I want the Fallback_Stack_Template to be a standalone CloudFormation JSON file packaged in the deployment distribution, so that the deploy script can deploy it without requiring CDK at runtime.

#### Acceptance Criteria

1. THE Fallback_Stack_Template SHALL be a valid CloudFormation JSON template file located at `deployment/dist/template/fallback-infrastructure.template.json`.
2. THE Fallback_Stack_Template SHALL define all Fallback_Infrastructure resources (VPC, subnets, route tables, S3 gateway endpoint, S3 bucket) without requiring CDK synthesis at deploy time.
3. THE build process SHALL generate the Fallback_Stack_Template alongside the existing `capability-insights.template.json` during the packaging step.

### Requirement 7: Fallback Infrastructure Teardown

**User Story:** As a deployer, I want the teardown command to also remove the Fallback_Stack if it exists, so that all provisioned resources are cleaned up.

#### Acceptance Criteria

1. WHEN the `teardown` command is executed and the Fallback_Stack exists, THE Deploy_Script SHALL delete the Fallback_Stack after deleting the Main_Stack.
2. WHEN the `teardown` command is executed and the Fallback_Stack does not exist, THE Deploy_Script SHALL skip Fallback_Stack deletion without error.
3. IF the Fallback_Stack deletion fails, THEN THE Deploy_Script SHALL print the failure reason and continue with the remaining teardown steps.

### Requirement 8: User Notification of Fallback Behavior

**User Story:** As a deployer, I want clear console output indicating when fallback infrastructure is being used, so that I understand what resources are being created in my account.

#### Acceptance Criteria

1. WHEN the Deploy_Script determines that fallback infrastructure is needed, THE Deploy_Script SHALL print a message listing which Infrastructure_Parameters are missing and will be auto-provisioned.
2. WHEN the Deploy_Script creates or reuses the Fallback_Stack, THE Deploy_Script SHALL print the resolved values for all four Infrastructure_Parameters before proceeding to Main_Stack deployment.
3. WHEN the `--yes` flag is not provided and fallback infrastructure creation is needed, THE Deploy_Script SHALL prompt the user for confirmation before creating the Fallback_Stack.

### Requirement 9: Selective Fallback for Partial Parameters

**User Story:** As a deployer, I want to provide some Infrastructure_Parameters while letting the system fill in the rest, so that I can use my own VPC but let the system create the bucket, or vice versa.

#### Acceptance Criteria

1. WHEN a subset of Infrastructure_Parameters is provided, THE Deploy_Script SHALL create the Fallback_Stack containing only the resources for the missing parameters.
2. THE Deploy_Script SHALL pass user-provided parameter values directly to the Main_Stack without modification.
3. WHEN only `DeploymentAssetsBucketName` is missing and VPC-related parameters are all provided, THE Fallback_Stack SHALL create only the S3 bucket and skip VPC and subnet creation.
4. WHEN any VPC-related parameter (`PrivateVpcId`, `BackendSubnetId`, `ApiAccessSubnetId`) is missing, THE Fallback_Stack SHALL create the full set of VPC, both subnets, route tables, and S3 gateway endpoint, regardless of whether some VPC-related parameters were provided, because partial VPC configurations are not safe to mix.
