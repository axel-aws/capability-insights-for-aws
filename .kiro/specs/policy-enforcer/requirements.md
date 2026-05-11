# Requirements Document

## Introduction

The Policy Enforcer feature generates and maintains IAM Policies or Service Control Policies (SCPs) that restrict AWS capabilities based on regional availability data from the Service and Feature Catalog. Users select target regions and a computation mode (intersection or union), and the system produces a "Deny \*, except [allow-list]" policy document that only permits capabilities confirmed available in the selected regions.

The feature deploys as a CloudFormation stack into the customer's AWS account, creating a Lambda function that fires daily to refresh the policy based on current catalog data. Configuration (regions, mode, exceptions) is managed through the existing web interface, and the generated policy ARN is surfaced for attachment to IAM roles or organizational units.

## Glossary

- **Policy_Enforcer**: The overall system that computes allow-lists from catalog availability data and generates IAM or SCP policy documents.
- **Catalog_API**: The existing API endpoint that provides regional availability data for AWS services and features.
- **Allow_List**: The computed set of AWS service actions that are permitted based on regional availability and the selected computation mode.
- **Intersection_Mode**: A computation mode where only capabilities available in ALL selected regions are included in the Allow_List.
- **Union_Mode**: A computation mode where capabilities available in ANY of the selected regions are included in the Allow_List.
- **Policy_Document**: A JSON document conforming to the IAM Policy language, structured as "Deny all except Allow_List" (an explicit deny with a NotAction list, or an allow with the computed action list).
- **IAM_Policy**: A standalone AWS IAM Managed Policy created and managed by the Policy_Enforcer in the customer's account.
- **SCP**: A Service Control Policy applied at the AWS Organizations level for org-wide enforcement.
- **Policy_Configuration**: The persisted user settings including selected regions, computation mode, exceptions, policy type (IAM or SCP), and refresh schedule.
- **Exception_Entry**: A manually added capability that is included in the Allow_List regardless of regional availability, used for intentional region-specific usage.
- **Refresh_Lambda**: The Lambda function deployed to the customer's account that periodically recomputes the Allow_List and updates the Policy_Document.
- **Config_Table**: A DynamoDB table in the customer's account that stores the Policy_Configuration.
- **Deployment_Template**: The CloudFormation template that creates the Refresh_Lambda, Config_Table, IAM roles, and EventBridge schedule in the customer's account.
- **Policy_ARN**: The Amazon Resource Name of the generated IAM_Policy or SCP, surfaced in the UI for use in CDK/CloudFormation.
- **Capability_Entry**: A single AWS service action (e.g., `s3:GetObject`) with its associated regional availability data from the catalog.
- **Web_UI**: The existing React-based Capability Insights website where users configure and manage Policy_Enforcer settings.

## Requirements

### Requirement 1: Region Selection for Policy Generation

**User Story:** As a Cloud Security Architect, I want to select one or more target AWS regions, so that the generated policy restricts capabilities based on availability in those regions.

#### Acceptance Criteria

1. THE Web_UI SHALL display a multi-select region picker on the Policy Enforcer configuration page, populated with all regions available in the catalog data.
2. WHEN the user selects one or more regions, THE Web_UI SHALL persist the selection as part of the Policy_Configuration.
3. THE Web_UI SHALL require at least one region to be selected before allowing policy generation.
4. WHEN the user modifies the region selection, THE Web_UI SHALL display a summary of how many capabilities are affected by the change before saving.
5. IF no regions are selected and the user attempts to save, THEN THE Web_UI SHALL display a validation error indicating at least one region is required.

### Requirement 2: Computation Mode Selection

**User Story:** As a Cloud Platform Architect, I want to choose between intersection and union mode, so that I can control how strictly the policy enforces regional availability.

#### Acceptance Criteria

1. THE Web_UI SHALL display a mode selector with two options: Intersection_Mode and Union_Mode.
2. WHEN Intersection_Mode is selected, THE Policy_Enforcer SHALL include a Capability_Entry in the Allow_List only if that capability has an availability status of "Available" in ALL selected regions.
3. WHEN Union_Mode is selected, THE Policy_Enforcer SHALL include a Capability_Entry in the Allow_List if that capability has an availability status of "Available" in at least one of the selected regions.
4. THE Web_UI SHALL display a description of each mode explaining the behavioral difference to the user.
5. THE Web_UI SHALL default to Intersection_Mode when creating a new Policy_Configuration.

### Requirement 3: Allow-List Computation

**User Story:** As a Cloud Security Architect, I want the system to compute the correct set of allowed AWS actions based on my region and mode selections, so that the generated policy accurately reflects regional availability.

#### Acceptance Criteria

1. WHEN computing the Allow_List in Intersection_Mode, THE Policy_Enforcer SHALL include a Capability_Entry only if its availability status equals "Available" for every region in the selected region set.
2. WHEN computing the Allow_List in Union_Mode, THE Policy_Enforcer SHALL include a Capability_Entry if its availability status equals "Available" for at least one region in the selected region set.
3. THE Policy_Enforcer SHALL map each included Capability_Entry to its corresponding IAM action prefix and action name (e.g., service `S3` with operation `GetObject` maps to `s3:GetObject`).
4. THE Policy_Enforcer SHALL include all Exception_Entry items in the Allow_List regardless of their regional availability status.
5. FOR ALL valid combinations of regions and mode, THE Allow_List computed in Intersection_Mode SHALL be a subset of or equal to the Allow_List computed in Union_Mode for the same region set.
6. WHEN the catalog data contains a capability with no availability data for a selected region, THE Policy_Enforcer SHALL treat that capability as not available in that region.

### Requirement 4: IAM Policy Document Generation

**User Story:** As a Cloud Security Architect, I want the system to generate a valid IAM Policy document from the Allow_List, so that I can attach it to IAM roles to enforce regional restrictions.

#### Acceptance Criteria

1. THE Policy_Enforcer SHALL generate a Policy_Document that conforms to the AWS IAM Policy JSON syntax.
2. THE Policy_Document SHALL use a "Deny" effect with a "NotAction" list containing the Allow_List actions, combined with a "Resource": "\*" scope, effectively denying all actions except those in the Allow_List.
3. THE Policy_Document SHALL not exceed the IAM managed policy size limit of 6,144 characters. IF the Allow_List produces a document exceeding this limit, THEN THE Policy_Enforcer SHALL split the policy into multiple managed policies and report the additional ARNs to the user.
4. THE Policy_Document SHALL include a "Sid" field with a descriptive identifier including the generation timestamp.
5. FOR ALL generated Policy_Documents, parsing the JSON and re-serializing it SHALL produce a semantically equivalent document (round-trip property).
6. THE Policy_Enforcer SHALL validate the generated Policy_Document against the IAM policy grammar before applying it.

### Requirement 5: SCP Document Generation

**User Story:** As a Cloud Platform Architect, I want the option to generate a Service Control Policy instead of an IAM Policy, so that I can enforce regional restrictions across my entire AWS Organization.

#### Acceptance Criteria

1. THE Web_UI SHALL allow the user to select either "IAM Policy" or "Service Control Policy" as the policy type in the Policy_Configuration.
2. WHEN SCP is selected, THE Policy_Enforcer SHALL generate a Policy_Document conforming to the SCP JSON syntax.
3. THE SCP document SHALL not exceed the SCP size limit of 5,120 characters. IF the Allow_List produces a document exceeding this limit, THEN THE Policy_Enforcer SHALL report an error to the user with guidance on reducing the scope (e.g., adding region filters or using IAM Policy mode instead).
4. THE SCP document SHALL use the same "Deny with NotAction" structure as the IAM Policy but scoped for organizational enforcement.
5. WHEN SCP mode is selected, THE Web_UI SHALL display a warning that SCPs affect all accounts in the targeted organizational unit.

### Requirement 6: Manual Exceptions Management

**User Story:** As a Cloud Security Architect, I want to add manual exceptions to the allow-list, so that I can permit specific capabilities that are intentionally used in only some regions.

#### Acceptance Criteria

1. THE Web_UI SHALL provide an interface to add Exception_Entry items specifying an AWS service action (e.g., `s3:GetObject`) to always include in the Allow_List.
2. THE Web_UI SHALL provide an interface to remove previously added Exception_Entry items.
3. THE Web_UI SHALL validate that each Exception_Entry follows the format `service:Action` or `service:*` before saving.
4. WHEN the Allow_List is computed, THE Policy_Enforcer SHALL include all Exception_Entry items regardless of their regional availability.
5. THE Web_UI SHALL display the current list of Exception_Entry items with the ability to search and filter.
6. IF an Exception_Entry matches a capability that is already in the Allow_List through normal computation, THEN THE Policy_Enforcer SHALL not duplicate the entry in the Policy_Document.

### Requirement 7: Policy Configuration Persistence

**User Story:** As a Cloud Security Architect, I want my policy configuration saved and retrievable, so that I can modify settings over time without reconfiguring from scratch.

#### Acceptance Criteria

1. THE Web_UI SHALL persist the Policy_Configuration (selected regions, mode, exceptions, policy type, refresh schedule, name, description, tags) via an API call to the backend.
2. THE backend SHALL store the Policy_Configuration in the Config_Table (DynamoDB) in the customer's account.
3. WHEN the user returns to the Policy Enforcer configuration page, THE Web_UI SHALL load and display the current Policy_Configuration from the Config_Table.
4. THE Config_Table SHALL support multiple Policy_Configurations per account, each identified by a unique policy name.
5. THE Web_UI SHALL allow the user to create, update, and delete Policy_Configurations.
6. FOR ALL valid Policy_Configurations, writing the configuration to the Config_Table and reading it back SHALL produce an equivalent configuration object (round-trip property).

### Requirement 7a: Workload-Based Policy Organization

**User Story:** As a Cloud Platform Architect managing multiple applications with different regional footprints, I want to create separate named and tagged policy configurations per workload, so that each application gets a policy scoped to its specific deployment regions.

#### Acceptance Criteria

1. THE Web_UI SHALL require a unique human-readable name for each Policy_Configuration (e.g., "Payment Service - US/EU", "Analytics Pipeline - Global").
2. THE Web_UI SHALL allow an optional description field for each Policy_Configuration explaining its purpose or the workload it governs.
3. THE Web_UI SHALL allow the user to assign one or more tags (key-value pairs) to each Policy_Configuration for organizational purposes (e.g., `team:payments`, `environment:production`, `application:order-service`).
4. THE Web_UI SHALL allow filtering and searching the policy list by name, description, or tag values.
5. THE generated IAM_Policy or SCP SHALL include the Policy_Configuration name and tags as resource tags on the AWS policy resource, enabling cost allocation and identification.
6. THE Deployment_Template SHALL propagate Policy_Configuration tags to all created resources (Lambda, DynamoDB table, EventBridge rule, IAM Policy).
7. THE Web_UI SHALL display all Policy_Configurations in a table view with columns for name, regions, mode, status, last refresh, and tags.
8. THE API_Lambda SHALL support filtering policies by tag key-value pairs via query parameters on the `GET /policies` route.

### Requirement 8: Daily Policy Refresh

**User Story:** As a Cloud Security Architect, I want the policy to be automatically refreshed daily with current catalog data, so that the allow-list stays up to date as AWS expands regional availability.

#### Acceptance Criteria

1. THE Refresh_Lambda SHALL execute on a schedule defined by an EventBridge rule, defaulting to once every 24 hours.
2. WHEN the Refresh_Lambda executes, it SHALL fetch the current regional availability data from the Catalog_API.
3. WHEN the Refresh_Lambda executes, it SHALL read the Policy_Configuration from the Config_Table.
4. THE Refresh_Lambda SHALL recompute the Allow_List using the current catalog data and the stored Policy_Configuration.
5. THE Refresh_Lambda SHALL update the existing IAM_Policy or SCP in-place with the newly generated Policy_Document.
6. IF the Catalog_API is unavailable during a refresh, THEN THE Refresh_Lambda SHALL retain the last known good Policy_Document without modification (fail-open mechanism).
7. THE Refresh_Lambda SHALL log the outcome of each refresh execution, including the number of actions in the Allow_List and whether the policy was updated or retained.
8. THE Policy_Configuration SHALL allow the refresh interval to be configured from 1 hour to 24 hours.

### Requirement 9: Deployment Template Generation

**User Story:** As a Cloud Platform Architect, I want a CloudFormation template that deploys all required resources to my account, so that I can set up the Policy Enforcer with a single deployment.

#### Acceptance Criteria

1. THE Deployment_Template SHALL create the following resources: Refresh_Lambda (Node.js runtime on arm64/Graviton), Config_Table (DynamoDB), IAM execution role for the Lambda, and an EventBridge rule for the refresh schedule.
2. THE Deployment_Template SHALL accept parameters for: Catalog_API endpoint URL, refresh interval, and optional VPC configuration.
3. THE Deployment_Template SHALL configure all resources with encryption at rest (DynamoDB uses AWS-managed keys, Lambda environment variables encrypted with KMS).
4. THE Deployment_Template SHALL enforce TLS 1.2 or higher for all data in transit.
5. THE Deployment_Template SHALL output the Policy_ARN of the created IAM_Policy or SCP.
6. WHEN VPC deployment is selected via parameters, THE Deployment_Template SHALL create VPC endpoints for DynamoDB, IAM, Organizations, and the Catalog_API.
7. THE Deployment_Template SHALL configure the Refresh_Lambda with a memory size of 256 MB and a timeout of 300 seconds.
8. THE Deployment_Template SHALL include a CloudFormation custom resource that triggers an initial policy generation on stack creation.

### Requirement 10: Policy ARN Display and Export

**User Story:** As a Cloud Security Architect, I want to see the generated Policy ARN in the web interface, so that I can reference it in my CDK/CloudFormation infrastructure code.

#### Acceptance Criteria

1. WHEN a Policy_Configuration has been deployed and a policy generated, THE Web_UI SHALL display the Policy_ARN.
2. THE Web_UI SHALL provide a copy-to-clipboard button for the Policy_ARN.
3. THE Web_UI SHALL display example CDK and CloudFormation snippets showing how to attach the policy to an IAM role using the Policy_ARN.
4. WHEN the policy type is SCP, THE Web_UI SHALL display the SCP ID and provide guidance on attaching it to an organizational unit.
5. IF no policy has been generated yet, THEN THE Web_UI SHALL display a message indicating the policy will be available after the first refresh execution.

### Requirement 11: Refresh Lambda Resilience

**User Story:** As a Cloud Platform Architect, I want the refresh process to be resilient to transient failures, so that my policy remains valid even when external dependencies are temporarily unavailable.

#### Acceptance Criteria

1. IF the Catalog_API returns an error or times out, THEN THE Refresh_Lambda SHALL retry the request up to 3 times with exponential backoff (1s, 2s, 4s delays).
2. IF all retry attempts fail, THEN THE Refresh_Lambda SHALL retain the existing Policy_Document without modification and log a warning.
3. IF the IAM or Organizations API call to update the policy fails, THEN THE Refresh_Lambda SHALL retry up to 3 times with exponential backoff.
4. IF the policy update fails after all retries, THEN THE Refresh_Lambda SHALL log an error and publish a CloudWatch metric named `PolicyUpdateFailure` with a value of 1.
5. THE Refresh_Lambda SHALL publish a CloudWatch metric named `PolicyRefreshSuccess` with a value of 1 on each successful refresh, enabling alarm configuration.
6. THE Refresh_Lambda SHALL complete execution within 300 seconds for configurations with up to 10,000 capability entries.

### Requirement 12: Web UI Configuration Page

**User Story:** As a Cloud Security Architect, I want a dedicated configuration page in the web interface for managing Policy Enforcer settings, so that I can set up and modify policies without leaving the catalog application.

#### Acceptance Criteria

1. THE Web_UI SHALL add a "Policy Enforcer" navigation item in the application sidebar.
2. WHEN the user navigates to the Policy Enforcer page, THE Web_UI SHALL display the list of existing Policy_Configurations with their status (active, pending, error).
3. THE Web_UI SHALL provide a "Create Policy" workflow that guides the user through region selection, mode selection, exception configuration, and policy type selection.
4. THE Web_UI SHALL display a preview of the generated Allow_List before the user confirms policy creation, showing the count of allowed actions and a searchable list.
5. THE Web_UI SHALL display the last refresh timestamp and outcome for each active Policy_Configuration.
6. THE Web_UI SHALL provide a "Refresh Now" button that triggers an immediate policy refresh outside the scheduled interval.
7. WHILE a policy refresh is in progress, THE Web_UI SHALL display a loading indicator on the affected Policy_Configuration.

### Requirement 13: Backend API for Policy Configuration Management

**User Story:** As a developer, I want backend API routes for creating, reading, updating, and deleting policy configurations, so that the web UI can manage policies through the existing API Lambda.

#### Acceptance Criteria

1. THE API_Lambda SHALL register a `POST /policies` route that creates a new Policy_Configuration in the Config_Table and returns the created configuration with its generated ID.
2. THE API_Lambda SHALL register a `GET /policies` route that returns all Policy_Configurations for the account.
3. THE API_Lambda SHALL register a `GET /policies/{policyId}` route that returns a single Policy_Configuration by ID.
4. THE API_Lambda SHALL register a `PUT /policies/{policyId}` route that updates an existing Policy_Configuration.
5. THE API_Lambda SHALL register a `DELETE /policies/{policyId}` route that removes a Policy_Configuration and its associated IAM_Policy or SCP.
6. THE API_Lambda SHALL register a `POST /policies/{policyId}/refresh` route that triggers an immediate policy refresh for the specified configuration.
7. THE API_Lambda SHALL register a `GET /policies/{policyId}/preview` route that computes and returns the Allow_List without creating or updating a policy, for preview purposes.
8. IF a required field is missing from a create or update request, THEN THE API_Lambda SHALL return a 400 error with a descriptive validation message.
9. IF the specified policyId does not exist, THEN THE API_Lambda SHALL return a 404 error.

### Requirement 14: Allow-List Computation Serialization

**User Story:** As a developer, I want the allow-list computation logic to produce deterministic, serializable output, so that results can be cached, compared, and tested reliably.

#### Acceptance Criteria

1. THE Policy_Enforcer SHALL sort the Allow_List alphabetically by action name before generating the Policy_Document, ensuring deterministic output.
2. FOR ALL identical inputs (same catalog data, same Policy_Configuration), THE Policy_Enforcer SHALL produce an identical Allow_List (determinism property).
3. THE Policy_Enforcer SHALL expose the Allow_List computation as a pure function that accepts catalog data and Policy_Configuration as inputs and returns the Allow_List as output, with no side effects.
4. FOR ALL valid Allow_Lists, serializing to the Policy_Document JSON format and parsing back SHALL produce a semantically equivalent action list (round-trip property for the serializer).
