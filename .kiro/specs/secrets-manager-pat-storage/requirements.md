# Requirements Document

## Introduction

This feature migrates the GitHub Personal Access Token (PAT) from plaintext storage in DynamoDB to AWS Secrets Manager. The DynamoDB table retains sync settings (toggle state, dataSyncEnabled, updatedAt) but no longer stores the token. A VPC endpoint for Secrets Manager is added so the API Lambda (running in a private subnet) can access the secret directly. The data-fetch Lambda (running outside the VPC) retrieves the token from Secrets Manager and passes it to the Terraform overlay Lambda via its invocation payload.

## Glossary

- **API_Lambda**: The Lambda function running inside a VPC private subnet that serves the API Gateway routes, including sync settings and plan routes.
- **Data_Fetch_Lambda**: The Lambda function running outside the VPC that fetches capability data from S3 and invokes the Terraform overlay Lambda.
- **Terraform_Overlay_Lambda**: The Lambda function invoked by Data_Fetch_Lambda that processes Terraform provider data using a GitHub PAT received in its invocation payload.
- **SyncSettingsStore**: The service class responsible for reading and writing sync settings to DynamoDB.
- **Secrets_Manager**: AWS Secrets Manager service used to securely store and retrieve the GitHub PAT.
- **VPC_Endpoint**: An interface VPC endpoint that enables private connectivity from the VPC to Secrets Manager without traversing the public internet.
- **CDK_Stack**: The CDK infrastructure-as-code stack (`CapabilityInsightsStack`) that provisions all AWS resources using L1 (Cfn) constructs.
- **Secret_Name**: The dynamic name for the Secrets Manager secret, formatted as `{StackPrefix}GitHubPAT-{Region}`.
- **DynamoDB_Settings_Table**: The PolicyConfiguration DynamoDB table that stores sync settings (toggle state, dataSyncEnabled, updatedAt).

## Requirements

### Requirement 1: Secret Creation in CDK Stack

**User Story:** As a platform operator, I want the GitHub PAT stored in AWS Secrets Manager, so that the token is encrypted at rest and access is auditable.

#### Acceptance Criteria

1. THE CDK_Stack SHALL create a Secrets Manager secret with the Secret_Name format `{StackPrefix}GitHubPAT-{Region}`.
2. THE CDK_Stack SHALL apply a `RETAIN` removal policy to the Secrets Manager secret resource.
3. THE CDK_Stack SHALL use L1 constructs (CfnSecret) to define the Secrets Manager secret, consistent with existing stack patterns.

### Requirement 2: VPC Endpoint for Secrets Manager

**User Story:** As a platform operator, I want a VPC endpoint for Secrets Manager in the private subnet, so that the API Lambda can access the secret without requiring internet access.

#### Acceptance Criteria

1. THE CDK_Stack SHALL create an interface VPC endpoint for the `com.amazonaws.{region}.secretsmanager` service in the private subnet where API_Lambda runs.
2. THE CDK_Stack SHALL enable private DNS on the VPC_Endpoint so that standard Secrets Manager API calls resolve to the endpoint.
3. THE CDK_Stack SHALL attach a security group to the VPC_Endpoint that permits inbound HTTPS (port 443) traffic from API_Lambda.

### Requirement 3: IAM Permissions for Secret Access

**User Story:** As a platform operator, I want the Lambda functions to have least-privilege access to the secret, so that only authorized functions can read or write the token.

#### Acceptance Criteria

1. THE CDK_Stack SHALL grant API_Lambda IAM permissions to perform `secretsmanager:GetSecretValue` and `secretsmanager:PutSecretValue` on the specific secret resource ARN.
2. THE CDK_Stack SHALL grant Data_Fetch_Lambda IAM permissions to perform `secretsmanager:GetSecretValue` on the specific secret resource ARN.
3. THE CDK_Stack SHALL pass the Secret_Name as an environment variable to both API_Lambda and Data_Fetch_Lambda.

### Requirement 4: Token Storage via API

**User Story:** As a user, I want to save my GitHub PAT through the settings page, so that the token is securely stored in Secrets Manager.

#### Acceptance Criteria

1. WHEN a PUT /syncSettings request includes a `githubToken` field and `terraformOverlayEnabled` is true, THE API_Lambda SHALL write the token value to Secrets_Manager using the configured Secret_Name.
2. WHEN a PUT /syncSettings request sets `terraformOverlayEnabled` to false, THE API_Lambda SHALL delete the secret value from Secrets_Manager.
3. IF the Secrets_Manager write operation fails, THEN THE API_Lambda SHALL return an HTTP 500 response with an error message indicating the token could not be stored.

### Requirement 5: Token Presence Check via API

**User Story:** As a user, I want the settings page to show whether a token is configured, so that I know if GitHub integration is active.

#### Acceptance Criteria

1. WHEN a GET /syncSettings request is received, THE API_Lambda SHALL query Secrets_Manager to determine whether a secret value exists for the configured Secret_Name.
2. THE API_Lambda SHALL return a `hasToken` boolean field in the response that is true when a secret value exists in Secrets_Manager and false otherwise.
3. THE API_Lambda SHALL NOT return the raw token value in any API response.

### Requirement 6: Token Retrieval for Plan Processing

**User Story:** As a user, I want plan creation with GitHub sources to use the securely stored token, so that my repositories can be accessed without exposing the PAT.

#### Acceptance Criteria

1. WHEN the `getGitHubPat()` helper is called in plan-routes, THE API_Lambda SHALL retrieve the token from Secrets_Manager using the configured Secret_Name.
2. IF the secret does not exist or has no value, THEN THE API_Lambda SHALL throw an error indicating the GitHub token is not configured.

### Requirement 7: Token Retrieval for Data Fetch

**User Story:** As a platform operator, I want the data-fetch Lambda to retrieve the token from Secrets Manager, so that the Terraform overlay can access GitHub repositories securely.

#### Acceptance Criteria

1. WHEN Data_Fetch_Lambda determines that Terraform overlay is enabled, THE Data_Fetch_Lambda SHALL retrieve the GitHub PAT from Secrets_Manager using the configured Secret_Name.
2. THE Data_Fetch_Lambda SHALL pass the retrieved token to Terraform_Overlay_Lambda via the invocation payload `githubToken` field.
3. IF the Secrets_Manager read operation fails, THEN THE Data_Fetch_Lambda SHALL skip the overlay invocation and log the error.

### Requirement 8: DynamoDB Schema Migration

**User Story:** As a platform operator, I want the `githubToken` field removed from DynamoDB, so that sensitive credentials are not stored in plaintext.

#### Acceptance Criteria

1. THE SyncSettingsStore SHALL NOT write a `githubToken` field to DynamoDB_Settings_Table when updating settings.
2. THE SyncSettingsStore SHALL NOT read or return a `githubToken` field from DynamoDB_Settings_Table.
3. THE SyncSettingsStore SHALL continue to store `terraformOverlayEnabled`, `dataSyncEnabled`, and `updatedAt` fields in DynamoDB_Settings_Table.

### Requirement 9: Terraform Overlay Toggle Without Token

**User Story:** As a user, I want to enable Terraform overlay only when a token is stored in Secrets Manager, so that the system does not attempt GitHub access without credentials.

#### Acceptance Criteria

1. WHEN a PUT /syncSettings request sets `terraformOverlayEnabled` to true without providing a `githubToken`, THE API_Lambda SHALL check Secrets_Manager for an existing secret value.
2. IF no secret value exists in Secrets_Manager and no `githubToken` is provided in the request, THEN THE API_Lambda SHALL return an HTTP 400 response indicating a GitHub token is required.
