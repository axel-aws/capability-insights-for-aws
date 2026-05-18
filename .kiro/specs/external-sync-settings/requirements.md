# Requirements Document

## Introduction

This feature replaces the deploy-time `deploy-config.yaml` approach for controlling external sync operations (Terraform AWSCC overlay and classic API mapping retrieval from GitHub) with runtime-configurable toggles on the Settings page. Users manage which external sync operations run and provide credentials (GitHub personal access token) through the web UI. The CDK stack no longer requires a `GitHubToken` CloudFormation parameter — the Lambda reads toggle state and credentials from a DynamoDB-backed settings store at sync time.

Additionally, this feature provides a "Utilities" section on the Settings page that enables users to upload custom data files, merge datasets from different sources (e.g., isolated partition data), and export their current dataset for sharing. This supports use cases where users need to supplement or replace synced data with manually curated data from environments they cannot directly access.

## Glossary

- **Settings_Store**: A DynamoDB-based persistence layer that stores sync configuration (toggle states and encrypted credentials) at runtime, replacing deploy-time configuration.
- **Settings_API**: The backend API routes (on the existing API Lambda) that handle reading and writing sync settings.
- **Settings_UI**: The section of the Settings page in the React SPA that renders toggle controls and credential input for external sync operations.
- **Data_Fetch_Lambda**: The existing Lambda function that fetches capability data from S3 and conditionally invokes the Terraform Overlay Lambda.
- **Overlay_Lambda**: The existing Lambda function that fetches Terraform provider data from GitHub and writes overlay/mapping files to S3.
- **GitHub_Token**: A GitHub personal access token (classic, no special scopes) used to authenticate GitHub API requests for higher rate limits (5,000 req/hour vs 60 req/hour unauthenticated).
- **Sync_Settings**: The runtime configuration record containing toggle states (`terraformOverlayEnabled`) and the associated GitHub token.
- **Utilities_UI**: The section of the Settings page that provides data upload, dataset merge, and export functionality.
- **Data_Files**: The set of JSON files that constitute the capability dataset: `regions.json`, `products.json`, `apis.json`, `cfn_resources.json`, stored in S3 at `data/json/`.
- **Dataset_Merge**: An additive merge operation that combines an uploaded dataset with the existing dataset — new items are added, existing items are updated, nothing is deleted.
- **Merge_Preview**: A summary of changes (additions and updates) that will result from a merge, shown to the user before committing.

## Requirements

### Requirement 1: Store sync settings in DynamoDB

**User Story:** As a deployer, I want sync settings stored at runtime in DynamoDB, so that I can change external sync behavior without redeploying the stack.

#### Acceptance Criteria

1. THE Settings_Store SHALL persist a single Sync_Settings record containing the `terraformOverlayEnabled` boolean toggle and an encrypted `githubToken` string.
2. WHEN a Sync_Settings record does not yet exist, THE Settings_Store SHALL treat the toggle as disabled and the token as empty (safe defaults).
3. THE Settings_Store SHALL encrypt the `githubToken` value at rest using server-side encryption (DynamoDB SSE with AWS-managed keys).
4. WHEN the Settings_Store receives an update with `terraformOverlayEnabled` set to false, THE Settings_Store SHALL clear the stored `githubToken` value.

### Requirement 2: Provide API endpoints for sync settings

**User Story:** As a frontend developer, I want API endpoints to read and update sync settings, so that the Settings UI can control external sync behavior.

#### Acceptance Criteria

1. WHEN a GET request is received at the settings endpoint, THE Settings_API SHALL return the current toggle state and a boolean indicating whether a token is stored (without exposing the token value).
2. WHEN a PUT request is received with a valid `terraformOverlayEnabled` value and a `githubToken` string, THE Settings_API SHALL persist the values to the Settings_Store and return the updated state.
3. WHEN a PUT request is received with `terraformOverlayEnabled` set to true but an empty `githubToken` and no token already stored, THE Settings_API SHALL return a 400 error indicating a token is required.
4. WHEN a PUT request is received with `terraformOverlayEnabled` set to true and a non-empty `githubToken`, THE Settings_API SHALL validate the token format (non-empty string, no leading/trailing whitespace) before persisting.
5. IF the Settings_Store is unreachable, THEN THE Settings_API SHALL return a 500 error with a descriptive message.

### Requirement 3: Display sync settings toggles on the Settings page

**User Story:** As a user, I want to see and control external sync toggles on the Settings page, so that I can enable or disable Terraform data retrieval without redeploying.

#### Acceptance Criteria

1. THE Settings_UI SHALL display a "Terraform overlay" toggle within a new "External data sources" container on the Settings page.
2. WHEN the toggle is switched ON, THE Settings_UI SHALL display a token input field prompting the user to enter a GitHub personal access token.
3. WHEN the toggle is switched ON and a token is already stored, THE Settings_UI SHALL display a masked placeholder (e.g., "••••••••") and a "Replace token" button instead of requiring re-entry.
4. WHEN the user submits the form with the toggle ON and a new token, THE Settings_UI SHALL call the Settings_API PUT endpoint and display a success or error notification.
5. WHEN the toggle is switched OFF, THE Settings_UI SHALL call the Settings_API PUT endpoint with `terraformOverlayEnabled` set to false and confirm the change with a success notification.
6. WHILE the Settings_API request is in flight, THE Settings_UI SHALL disable the toggle and show a loading indicator.

### Requirement 4: Data Fetch Lambda reads settings at runtime

**User Story:** As a system operator, I want the Data Fetch Lambda to check runtime settings before invoking the Overlay Lambda, so that the toggle on the Settings page actually controls sync behavior.

#### Acceptance Criteria

1. WHEN the Data_Fetch_Lambda executes, THE Data_Fetch_Lambda SHALL read the Sync_Settings record from the Settings_Store before deciding whether to invoke the Overlay_Lambda.
2. WHEN `terraformOverlayEnabled` is true and a `githubToken` is stored, THE Data_Fetch_Lambda SHALL invoke the Overlay_Lambda and pass the token in the invocation payload.
3. WHEN `terraformOverlayEnabled` is false or no Sync_Settings record exists, THE Data_Fetch_Lambda SHALL skip the Overlay_Lambda invocation entirely.
4. IF the Settings_Store read fails, THEN THE Data_Fetch_Lambda SHALL log the error and skip the Overlay_Lambda invocation (fail-safe to disabled).
5. THE Overlay_Lambda SHALL accept the GitHub token from the invocation payload instead of reading it from an environment variable.

### Requirement 5: Remove deploy-config GitHub token dependency

**User Story:** As a deployer, I want to remove the `GitHubToken` CloudFormation parameter and `enable_terraform_overlay` / `github_token` deploy-config fields, so that the deployment process is simpler and credentials are not baked into infrastructure.

#### Acceptance Criteria

1. THE CDK stack SHALL NOT define a `GitHubToken` CloudFormation parameter.
2. THE CDK stack SHALL NOT set the `GITHUB_TOKEN` environment variable on the Overlay_Lambda.
3. THE CDK stack SHALL NOT use a `HasTerraformOverlay` condition to conditionally set the `TERRAFORM_OVERLAY_FUNCTION_NAME` environment variable on the Data_Fetch_Lambda.
4. THE Data_Fetch_Lambda SHALL always have the `TERRAFORM_OVERLAY_FUNCTION_NAME` environment variable set to the Overlay Lambda function name (invocation is gated by the runtime toggle, not by the env var being empty).
5. THE deploy-config.yaml.example SHALL NOT contain `enable_terraform_overlay` or `github_token` fields.
6. THE deployment scripts SHALL NOT read or pass `enable_terraform_overlay` or `github_token` values to CloudFormation.

### Requirement 6: Grant Data Fetch Lambda DynamoDB read access

**User Story:** As a system operator, I want the Data Fetch Lambda to have permission to read sync settings from DynamoDB, so that it can check the toggle state at runtime.

#### Acceptance Criteria

1. THE CDK stack SHALL grant the Data_Fetch_Lambda IAM role `dynamodb:GetItem` permission on the settings record in the DynamoDB table.
2. THE CDK stack SHALL pass the DynamoDB table name to the Data_Fetch_Lambda as an environment variable.
3. THE CDK stack SHALL grant the API Lambda IAM role `dynamodb:GetItem` and `dynamodb:PutItem` permissions on the settings record in the DynamoDB table.

### Requirement 7: Sync metadata reflects toggle state

**User Story:** As a user viewing the Settings page, I want the sync metadata to indicate whether the Terraform overlay ran, so that I can confirm my settings are taking effect.

#### Acceptance Criteria

1. WHEN the Overlay_Lambda is skipped due to the toggle being disabled, THE Data_Fetch_Lambda SHALL include a `terraformOverlaySkipped: true` field in the sync metadata.
2. WHEN the Overlay_Lambda is invoked and succeeds, THE Data_Fetch_Lambda SHALL include the existing `terraformOverlay` metadata (generation timestamp, resource counts).
3. WHEN the Overlay_Lambda is skipped, THE Settings_UI SHALL display an informational indicator (e.g., "Terraform overlay: disabled") in the sync status section.

---

## Utilities

### Requirement 8: Upload custom data files

**User Story:** As a user, I want to upload my own data files to replace or supplement the synced data, so that I can provide data from environments I cannot directly access (e.g., isolated partitions).

#### Acceptance Criteria

1. WHEN a user uploads a data file through the Utilities_UI, THE Settings_API SHALL accept the file and write it to the website S3 bucket at the corresponding `data/json/{filename}.json` path.
2. THE Settings_API SHALL accept uploads for the following Data_Files: `regions.json`, `products.json`, `apis.json`, `cfn_resources.json`.
3. WHEN a user uploads a file, THE Settings_API SHALL validate that the uploaded content is valid JSON and is a JSON array before writing to S3.
4. WHEN a user uploads an invalid file (not JSON or not an array), THE Settings_API SHALL return a 400 error with a descriptive message.
5. THE Utilities_UI SHALL display the list of Data_Files with their last-modified timestamps (or "Not present" if the file does not exist in S3).
6. WHEN an upload succeeds, THE Utilities_UI SHALL refresh the file list to show the updated last-modified timestamp.

### Requirement 9: Merge datasets

**User Story:** As a user, I want to merge an uploaded dataset with my existing data, so that I can combine data from multiple sources (e.g., merging isolated partition data with public partition data) without losing existing entries.

#### Acceptance Criteria

1. WHEN a user initiates a merge, THE Settings_API SHALL accept uploaded JSON data and compute a Merge_Preview showing what will be added and what will be updated.
2. THE Dataset_Merge SHALL use an additive strategy: new regions/products/API operations/CFN resources are added, existing ones are updated if present in the uploaded data, and nothing is deleted.
3. WHEN the Merge_Preview is returned, THE Utilities_UI SHALL display the counts of items to be added and items to be updated for each data file type.
4. WHEN the user confirms the merge, THE Settings_API SHALL apply the merge and write the resulting data to S3 at the corresponding `data/json/{filename}.json` path.
5. WHEN the user cancels the merge after previewing, THE Settings_API SHALL discard the uploaded data and leave the existing data unchanged.
6. WHEN a merge is committed, THE Utilities_UI SHALL display a success notification and trigger the frontend to reload the affected data.
7. THE Dataset_Merge SHALL reuse the existing `mergeJson` logic (identity-based deduplication with deep merge) for each data file type.

### Requirement 10: Export current dataset

**User Story:** As a user, I want to export my current dataset so that I can share it with others who can then merge it into their own deployment.

#### Acceptance Criteria

1. WHEN a user requests an export, THE Utilities_UI SHALL provide download links for each individual Data_File as JSON.
2. THE Utilities_UI SHALL also provide a "Download all" option that packages all Data_Files into a single ZIP archive.
3. THE export SHALL use the data currently stored in S3 (the same data the frontend displays).
4. WHEN a data file does not exist in S3, THE Utilities_UI SHALL exclude it from the export and indicate which files are missing.

### Requirement 11: Settings page layout with tabs

**User Story:** As a user, I want the Settings page to be clearly organized into "Settings" and "Utilities" sections, so that I can easily find sync configuration vs. data management tools.

#### Acceptance Criteria

1. THE Settings page SHALL display two clearly separated sections or tabs: "Settings" (containing sync toggles and credentials) and "Utilities" (containing upload, merge, and export).
2. WHEN the user navigates to the Settings page, THE Settings_UI SHALL default to the "Settings" tab.
3. THE Utilities tab SHALL contain three sub-sections: "Data upload", "Dataset merge", and "Export".
4. THE Settings tab SHALL contain the existing "Data synchronization" section and the new "External data sources" section (Terraform overlay toggle).
