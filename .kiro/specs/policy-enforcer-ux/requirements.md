# Requirements Document

## Introduction

This document specifies UX improvements to the existing Policy Enforcer feature. The Policy Enforcer generates IAM policies that restrict AWS capabilities based on regional availability. The backend creates multiple IAM managed policies using a two-tier strategy (blanket deny + specific API deny), but the current UI provides limited visibility into the generated policy parts, no guidance on attachment, and incomplete delete flows. These requirements address policy details visibility, attachment instructions, per-policy CRUD operations, a status dashboard, and cascading delete behavior.

## Glossary

- **Policy_Configuration**: A user-created configuration stored in DynamoDB that defines regions, mode, exceptions, and policy type. It drives the generation of one or more IAM managed policies.
- **Policy_Part**: A single IAM managed policy created by the backend. A Policy_Configuration may produce multiple Policy_Parts due to IAM size limits (6,144 characters per policy).
- **Blanket_Deny_Policy**: The first Policy_Part (Tier 1) that uses a NotAction statement with `service:*` wildcards to deny services with zero available APIs.
- **Specific_API_Deny_Policy**: Additional Policy_Parts (Tier 2) that use Action statements listing specific unavailable APIs within partially-available services.
- **Policy_Details_View**: A UI page that displays all Policy_Parts associated with a Policy_Configuration, including ARNs, sizes, and content summaries.
- **Attachment_Instructions_Panel**: A UI component that provides guidance and copy-able snippets for attaching all Policy_Parts to an IAM role.
- **Status_Dashboard**: A UI section showing the current state of all IAM policies in the account, including existence verification, last refresh, and next scheduled refresh.
- **Delete_Flow**: The process of removing a Policy_Configuration and all associated Policy_Parts from both DynamoDB and IAM.

## Requirements

### Requirement 1: Policy Parts Detail View

**User Story:** As a platform engineer, I want to see all IAM policy parts generated for a policy configuration, so that I understand the full scope of what was created in my account.

#### Acceptance Criteria

1. WHEN a user navigates to a Policy_Configuration detail page, THE Policy_Details_View SHALL display a table listing each Policy_Part with its ARN, document size in characters, and part type (Blanket_Deny_Policy or Specific_API_Deny_Policy).
2. WHEN a Policy_Configuration has not been refreshed yet, THE Policy_Details_View SHALL display an informational message indicating that no Policy_Parts exist until the first refresh is performed.
3. THE Policy_Details_View SHALL display the total number of Policy_Parts and the combined document size across all parts.
4. WHEN a user selects a Policy_Part from the table, THE Policy_Details_View SHALL display the full JSON policy document for that part in a read-only code viewer.
5. WHEN a Policy_Part uses a NotAction statement, THE Policy_Details_View SHALL display the count of service wildcards in the NotAction list.
6. WHEN a Policy_Part uses an Action statement, THE Policy_Details_View SHALL display the count of specific API actions being denied.

### Requirement 2: Attachment Instructions

**User Story:** As a platform engineer, I want clear guidance on how to attach all policy parts to an IAM role, so that I achieve full regional governance coverage without missing any parts.

#### Acceptance Criteria

1. THE Attachment_Instructions_Panel SHALL display a warning alert stating that all Policy_Parts must be attached to the target IAM role for complete coverage.
2. THE Attachment_Instructions_Panel SHALL provide a copy-able list of all Policy_Part ARNs.
3. WHEN the policy type is IAM, THE Attachment_Instructions_Panel SHALL display a CDK code snippet that attaches all Policy_Parts to a role.
4. WHEN the policy type is IAM, THE Attachment_Instructions_Panel SHALL display a CloudFormation YAML snippet that includes all Policy_Part ARNs in the ManagedPolicyArns list.
5. WHEN the policy type is SCP, THE Attachment_Instructions_Panel SHALL display instructions for attaching the SCP to an organizational unit with the SCP ID.
6. IF a Policy_Configuration has only one Policy_Part, THEN THE Attachment_Instructions_Panel SHALL omit the multi-policy warning and display simplified single-policy attachment instructions.

### Requirement 3: Per-Policy Part Operations

**User Story:** As a platform engineer, I want to inspect and manage individual policy parts, so that I can understand what each part contains and remove stale policies.

#### Acceptance Criteria

1. WHEN a user views a Policy_Part detail, THE Policy_Details_View SHALL display the services and API actions contained in that part, grouped by service prefix.
2. WHEN a user requests to view a Policy_Part, THE System SHALL fetch the current policy document from IAM to display the live state rather than a cached version.
3. WHEN a user initiates deletion of a single Policy_Part, THE System SHALL display a confirmation dialog warning that removing a single part breaks full coverage.
4. WHEN a user confirms deletion of a single Policy_Part, THE System SHALL invoke the IAM helper Lambda to delete that policy and remove its ARN from the Policy_Configuration record.
5. IF the IAM helper Lambda returns an error during single-part deletion, THEN THE System SHALL display the error message and retain the ARN in the Policy_Configuration record.

### Requirement 4: Status Dashboard

**User Story:** As a platform engineer, I want a dashboard showing the current state of all my policy configurations and their IAM policies, so that I can monitor governance coverage at a glance.

#### Acceptance Criteria

1. THE Status_Dashboard SHALL display each Policy_Configuration with its current status (active, pending, or error), the number of Policy_Parts, and the last refresh timestamp.
2. THE Status_Dashboard SHALL display the next scheduled refresh time computed from the last refresh time plus the configured refresh interval.
3. WHEN a Policy_Configuration has status "error", THE Status_Dashboard SHALL display the error context from the last failed refresh attempt.
4. THE Status_Dashboard SHALL provide a bulk "Refresh All" action that triggers a refresh for all Policy_Configurations with status "active".
5. WHEN a refresh is in progress for any Policy_Configuration, THE Status_Dashboard SHALL display a loading indicator for that specific configuration.
6. THE Status_Dashboard SHALL auto-refresh its data every 60 seconds while the page is visible.

### Requirement 5: Cascading Delete Flow

**User Story:** As a platform engineer, I want deleting a policy configuration to clean up all associated IAM policies, so that I do not leave orphaned policies in my account.

#### Acceptance Criteria

1. WHEN a user initiates deletion of a Policy_Configuration, THE Delete_Flow SHALL display a confirmation dialog listing all Policy_Part ARNs that will be deleted.
2. WHEN a user confirms deletion, THE Delete_Flow SHALL invoke the IAM helper Lambda to delete each Policy_Part (primary ARN and all additional ARNs) before removing the DynamoDB record.
3. IF any Policy_Part deletion fails, THEN THE Delete_Flow SHALL continue attempting to delete remaining Policy_Parts and report a partial failure with the list of ARNs that could not be deleted.
4. WHEN all Policy_Parts are deleted successfully, THE Delete_Flow SHALL remove the Policy_Configuration from DynamoDB and navigate the user back to the policy list.
5. IF the Policy_Configuration has no Policy_Parts (never refreshed), THEN THE Delete_Flow SHALL skip IAM deletion and remove only the DynamoDB record after confirmation.

### Requirement 6: Policy Part Content API

**User Story:** As a platform engineer, I want an API endpoint that returns the content of individual policy parts, so that the UI can display live policy documents.

#### Acceptance Criteria

1. WHEN a GET request is made to `/policies/:policyId/parts`, THE System SHALL return a list of all Policy_Parts with their ARNs, sizes, and part types.
2. WHEN a GET request is made to `/policies/:policyId/parts/:partIndex`, THE System SHALL fetch the current policy document from IAM and return the JSON document, size, and metadata.
3. IF the specified policyId does not exist, THEN THE System SHALL return a 404 response with an appropriate error message.
4. IF the IAM GetPolicyVersion call fails, THEN THE System SHALL return a 502 response indicating that the upstream IAM service is unavailable.
5. WHEN a DELETE request is made to `/policies/:policyId/parts/:partIndex`, THE System SHALL delete that specific Policy_Part from IAM and update the Policy_Configuration record.
