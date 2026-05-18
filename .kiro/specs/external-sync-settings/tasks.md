# Implementation Plan: External Sync Settings & Utilities

## Overview

This plan implements runtime-configurable sync settings and data management utilities for the Capability Insights application. It replaces deploy-time configuration with a DynamoDB-backed settings store, exposes settings through the existing API Lambda, and adds a tabbed Settings page UI with Settings and Utilities sections.

The implementation is incremental: backend store → API routes → CDK/deploy changes → Data Fetch Lambda integration → frontend UI.

## Tasks

- [x] 1. Implement SyncSettingsStore module
  - [x] 1.1 Create the SyncSettingsStore class with DynamoDB get/update operations
    - Create `source/lambda/services/sync-settings-store.ts`
    - Define `SyncSettings` and `SyncSettingsResponse` interfaces
    - Implement `getSettings()` — reads from PolicyConfiguration table with `policyId = "SYNC_SETTINGS"`, returns safe defaults when record does not exist
    - Implement `updateSettings()` — validates input, persists to DynamoDB, clears `githubToken` when `terraformOverlayEnabled` is false
    - Add `SYNC_SETTINGS_POLICY_ID` constant
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Write property test: Token secrecy (Property 1)
    - **Property 1: Token secrecy**
    - Generate random non-empty token strings, store via `updateSettings`, verify `getSettings` response contains `hasToken: true` but never exposes the token value
    - **Validates: Requirements 2.1**

  - [x] 1.3 Write property test: Settings round-trip (Property 2)
    - **Property 2: Settings round-trip**
    - Generate random valid settings (boolean toggle + non-empty trimmed token), PUT then GET, verify toggle value matches and `hasToken` is true
    - **Validates: Requirements 2.2**

  - [x] 1.4 Write property test: Token whitespace validation (Property 3)
    - **Property 3: Token whitespace validation**
    - Generate strings with leading/trailing whitespace → verify rejection with 400; generate non-empty strings without leading/trailing whitespace → verify acceptance
    - **Validates: Requirements 2.4**

- [ ] 2. Implement sync settings API routes
  - [x] 2.1 Create sync settings route handlers
    - Create `source/lambda/routes/sync-settings-routes.ts`
    - Implement GET `/syncSettings` handler — calls `SyncSettingsStore.getSettings()`, returns `SyncSettingsResponse` (toggle state + `hasToken` boolean, never the raw token)
    - Implement PUT `/syncSettings` handler — validates request body (token required when enabling, no whitespace), calls `updateSettings`, returns updated state
    - Return appropriate error responses (400 for validation, 500 for store failures)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.2 Register sync settings routes in api-lambda-main.ts
    - Import and register `GET /syncSettings` and `PUT /syncSettings` in the existing route map
    - _Requirements: 2.1, 2.2_

  - [x] 2.3 Write unit tests for sync settings routes
    - Test GET returns toggle state and hasToken without exposing token
    - Test PUT with valid input persists and returns updated state
    - Test PUT with empty token when enabling returns 400
    - Test PUT with whitespace token returns 400
    - Test 500 response when DynamoDB is unreachable
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 3. Implement data utilities API routes
  - [x] 3.1 Create data utilities route handlers
    - Create `source/lambda/routes/data-utilities-routes.ts`
    - Implement GET `/data/info` — lists data files with last-modified timestamps and sizes from S3
    - Implement POST `/data/upload` — validates file name (must be one of `regions`, `products`, `apis`, `cfn_resources`), validates content is a JSON array, writes to S3
    - Implement POST `/data/merge/preview` — validates file name and content, stages uploaded data in S3 at `data/merge-staging/{mergeId}/{fileName}.json`, computes merge preview (additions, updates, unchanged, totalAfterMerge) using identity functions from data-fetch-lambda-main
    - Implement POST `/data/merge/commit` — reads staged data, performs merge using existing `mergeJson` logic, writes result to S3, cleans up staging
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.4, 9.5, 9.7_

  - [x] 3.2 Register data utilities routes in api-lambda-main.ts
    - Import and register GET `/data/info`, POST `/data/upload`, POST `/data/merge/preview`, POST `/data/merge/commit`
    - _Requirements: 8.1, 9.1_

  - [x] 3.3 Write property test: Upload file name validation (Property 4)
    - **Property 4: Upload file name validation**
    - Generate arbitrary strings not in the allowed set → verify 400 rejection; generate strings from the allowed set → verify acceptance
    - **Validates: Requirements 8.2**

  - [x] 3.4 Write property test: Upload JSON array validation (Property 5)
    - **Property 5: Upload JSON array validation**
    - Generate strings that are not valid JSON or valid JSON but not arrays → verify 400 rejection; generate valid JSON arrays → verify acceptance
    - **Validates: Requirements 8.3**

  - [x] 3.5 Write property test: Merge preview accuracy (Property 6)
    - **Property 6: Merge preview accuracy**
    - Generate random existing datasets (JSON arrays with unique IDs) and uploaded datasets, compute merge preview, verify: additions = count of uploaded IDs not in existing, updates = count of uploaded IDs in existing, totalAfterMerge = existing.length + additions
    - **Validates: Requirements 9.1**

  - [x] 3.6 Write property test: Merge additive invariant (Property 7)
    - **Property 7: Merge additive invariant**
    - Generate random existing and uploaded datasets, perform merge, verify: (1) every original ID still present, (2) every uploaded ID present, (3) result length >= original length
    - **Validates: Requirements 9.2**

- [x] 4. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update CDK stack and deployment scripts
  - [x] 5.1 Remove GitHubToken parameter and HasTerraformOverlay condition from CDK stack
    - Remove `GitHubToken` CfnParameter from `capability-insights-stack.ts`
    - Remove `HasTerraformOverlay` CfnCondition
    - Remove `GITHUB_TOKEN` environment variable from Overlay Lambda
    - Set `TERRAFORM_OVERLAY_FUNCTION_NAME` unconditionally (always the overlay Lambda name, no conditionIf)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 5.2 Grant Data Fetch Lambda DynamoDB read access
    - Add `dynamodb:GetItem` permission to the Data Fetch Lambda role for the PolicyConfiguration table
    - Add `POLICY_TABLE_NAME` environment variable to the Data Fetch Lambda function
    - _Requirements: 6.1, 6.2_

  - [x] 5.3 Ensure API Lambda has DynamoDB GetItem and PutItem permissions for sync settings
    - Verify existing DynamoDB policy on API Lambda role includes `GetItem` and `PutItem` (it already has broad access — confirm coverage)
    - _Requirements: 6.3_

  - [x] 5.4 Update deployment scripts and config
    - Remove `enable_terraform_overlay` and `github_token` fields from `deployment/deploy-config.yaml.example`
    - Remove `--enable-terraform-overlay` and `--github-token` CLI flag handling from `deployment/deploy.sh`
    - Remove `GitHubToken` from the CloudFormation parameter overrides in deploy.sh
    - _Requirements: 5.5, 5.6_

  - [x] 5.5 Update CDK snapshot tests
    - Run snapshot update to reflect removed GitHubToken parameter, removed HasTerraformOverlay condition, unconditional TERRAFORM_OVERLAY_FUNCTION_NAME, and new Data Fetch Lambda DynamoDB permissions
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2_

- [x] 6. Update Data Fetch Lambda to read runtime settings
  - [x] 6.1 Modify data-fetch-lambda-main.ts to read sync settings from DynamoDB
    - Import `SyncSettingsStore` and instantiate with `POLICY_TABLE_NAME` env var
    - Before overlay invocation, call `getSettings()` to check `terraformOverlayEnabled` and retrieve `githubToken`
    - If enabled and token present → invoke Overlay Lambda with token in payload
    - If disabled or no record → skip overlay invocation entirely
    - If DynamoDB read fails → log error, skip overlay (fail-safe to disabled)
    - Add `POLICY_TABLE_NAME` to `EnvironmentKey` constants
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 6.2 Update Overlay Lambda handler to accept token from invocation payload
    - Modify `OverlayLambdaEvent` interface to include optional `githubToken` field
    - Update `createGitHubClient()` call to use `event.githubToken` instead of `process.env.GITHUB_TOKEN`
    - Fall back to env var if payload token is not provided (backward compatibility during transition)
    - _Requirements: 4.5_

  - [x] 6.3 Update sync metadata to reflect overlay toggle state
    - When overlay is skipped due to toggle being disabled, include `terraformOverlaySkipped: true` in sync metadata
    - When overlay succeeds, include existing `terraformOverlay` metadata as before
    - _Requirements: 7.1, 7.2_

  - [x] 6.4 Write unit tests for Data Fetch Lambda settings integration
    - Test: overlay invoked when enabled with token
    - Test: overlay skipped when disabled
    - Test: overlay skipped when no settings record exists
    - Test: overlay skipped on DynamoDB read failure (fail-safe)
    - Test: sync metadata includes `terraformOverlaySkipped` when disabled
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.1_

- [x] 7. Checkpoint - Ensure all backend and infrastructure tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement frontend API client extensions
  - [x] 8.1 Add sync settings and data utilities methods to the API client
    - Add to `source/website/app/clients/capability-insights-client.ts` (or create a new `utilities-client.ts`):
    - `getSyncSettings()` → GET `/syncSettings`
    - `updateSyncSettings(settings)` → PUT `/syncSettings`
    - `getDataFilesInfo()` → GET `/data/info`
    - `uploadDataFile(fileName, content)` → POST `/data/upload`
    - `previewMerge(fileName, content)` → POST `/data/merge/preview`
    - `commitMerge(fileName, mergeId)` → POST `/data/merge/commit`
    - _Requirements: 2.1, 2.2, 8.1, 9.1, 9.4_

- [x] 9. Implement Settings page with tabs layout
  - [x] 9.1 Refactor Settings page to use Cloudscape Tabs component
    - Modify `source/website/app/pages/settings.tsx` to use Cloudscape `Tabs`
    - Create "Settings" tab (default active) and "Utilities" tab
    - Move existing "Data synchronization" container into the Settings tab content
    - _Requirements: 11.1, 11.2, 11.4_

  - [x] 9.2 Implement External Data Sources container in Settings tab
    - Add "External data sources" container with Terraform overlay toggle
    - When toggle ON → show token input field (or masked placeholder with "Replace token" button if token already stored)
    - When toggle OFF → call PUT with `terraformOverlayEnabled: false`
    - Show loading indicator while API request is in flight, disable toggle
    - Display success/error notifications via Cloudscape Alert/Flashbar
    - Display "Terraform overlay: disabled" indicator in sync status when overlay was skipped
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.3_

- [x] 10. Implement Utilities tab content
  - [x] 10.1 Implement Data Upload section
    - Add file selector dropdown (DataFile enum values: regions, products, apis, cfn_resources)
    - Add file input for JSON upload
    - Client-side validation: check file is valid JSON array before sending
    - Display file status table with last-modified timestamps (from `getDataFilesInfo()`)
    - On successful upload, refresh file list
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 10.2 Implement Dataset Merge section
    - Add file selector and file input for merge source
    - "Preview merge" button → calls `previewMerge`, displays additions/updates/unchanged/totalAfterMerge counts
    - "Confirm merge" button → calls `commitMerge`, shows success notification, triggers data reload
    - "Cancel" button → discards preview, resets UI
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 10.3 Implement Export section
    - Display individual download links for each data file (using existing S3 URLs)
    - "Download all as ZIP" button → fetches all files client-side, assembles ZIP (using JSZip or similar), triggers download
    - Indicate which files are missing (not present in S3)
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [x] 10.4 Add Utilities tab container to Settings page Tabs
    - Wire UtilitiesTabContent (upload + merge + export sections) into the "Utilities" tab
    - _Requirements: 11.3_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The implementation language is TypeScript throughout (Lambda, CDK, React frontend)
- Testing uses Vitest with fast-check for property-based tests
- The existing `mergeJson` utility and identity functions are reused for dataset merge
