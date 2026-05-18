# Settings UX Improvements Bugfix Design

## Overview

The Settings page has multiple UX deficiencies: (1) no toggle to disable the scheduled daily data sync from the S3 access point, meaning users cannot prevent their manually uploaded data from being overwritten, and (2) the Utilities tab sections (Data Upload, Dataset Merge, Export) lack descriptive text and guidance, leaving users confused about what each action does and its consequences. This fix adds a `dataSyncEnabled` toggle to the sync settings and adds informational descriptions/guidance to each Utilities section.

## Glossary

- **Bug_Condition (C)**: The conditions that trigger the UX issues — viewing the Settings/Utilities tabs without adequate descriptions or toggle controls
- **Property (P)**: The desired behavior — descriptive text is displayed, and the data sync toggle controls scheduled sync behavior
- **Preservation**: Existing functionality (manual sync button, upload, merge, export, Terraform overlay toggle) must remain unchanged
- **SyncSettingsStore**: The DynamoDB-backed store at `source/lambda/services/sync-settings-store.ts` that persists sync configuration
- **Data Fetch Lambda**: The Lambda at `source/lambda/data-fetch-lambda-main.ts` that fetches data from the S3 access point on a schedule
- **dataSyncEnabled**: New boolean field in `SyncSettings` controlling whether the scheduled sync fetches from the S3 access point

## Bug Details

### Bug Condition

The bug manifests in two categories:

1. **Missing data sync toggle**: When the Data Fetch Lambda runs on its daily schedule, it unconditionally fetches from the S3 access point and overwrites user data. There is no way to disable this.
2. **Missing UX descriptions**: When a user views the Utilities tab sections, no descriptive text or guidance is shown, leaving users unaware of what each action does.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type UserInteraction
  OUTPUT: boolean

  RETURN (input.action == "viewDataSyncContainer" AND noDataSyncTogglePresent())
         OR (input.action == "viewDataUploadSection" AND noDescriptionPresent("upload"))
         OR (input.action == "viewDatasetMergeSection" AND noDescriptionPresent("merge"))
         OR (input.action == "viewExportSection" AND noDescriptionPresent("export"))
         OR (input.action == "scheduledSyncTrigger" AND userWantsDataSyncDisabled() AND syncRunsAnyway())
END FUNCTION
```

### Examples

- User views Data Synchronization container → no toggle to disable scheduled sync; expected: toggle present, defaults to enabled
- User views Data Upload section → no description text; expected: "Replace the authoritative data file..." alert shown
- User views Dataset Merge section → no description or workflow guidance; expected: description + step-by-step guidance shown
- User views Export section → no description text; expected: "Download your current data files..." description shown
- Scheduled sync fires with toggle OFF → data is overwritten anyway; expected: Lambda skips S3 access point fetch

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Manual "Sync capability data" button must continue to trigger the Data Fetch Lambda regardless of the dataSyncEnabled toggle state
- All existing upload functionality (file validation, S3 upload, file list refresh) must continue working
- All existing merge functionality (preview, confirm, cancel) must continue working
- All existing export functionality (individual downloads, ZIP generation) must continue working
- Terraform overlay toggle must continue working independently of the data sync toggle
- Settings page tab structure and layout must remain unchanged

**Scope:**
All inputs that do NOT involve the new data sync toggle or the missing descriptions should be completely unaffected by this fix. This includes:

- Mouse clicks on existing buttons (Sync, Upload, Preview merge, Confirm merge, Download)
- Terraform overlay toggle interactions
- Navigation between tabs
- API calls for existing functionality

## Hypothesized Root Cause

Based on the bug description, the issues are:

1. **Missing `dataSyncEnabled` field**: The `SyncSettings` interface and `SyncSettingsStore` do not include a `dataSyncEnabled` boolean, so there is no mechanism to control scheduled sync behavior.

2. **Data Fetch Lambda has no conditional check**: The Lambda handler unconditionally fetches from the S3 access point without checking any toggle state. It only conditionally invokes the Terraform overlay.

3. **No frontend toggle for data sync**: The Settings tab's "Data synchronization" container only shows sync status and a manual sync button — no toggle to control the scheduled behavior.

4. **No descriptive text in Utilities components**: The `DataUploadSection`, `DatasetMergeSection`, and `ExportSection` components render their functional UI but include no `Alert` or `Box` components with explanatory text.

5. **No workflow guidance in merge section**: The `DatasetMergeSection` component provides the merge UI but no step-by-step instructions explaining the workflow.

## Correctness Properties

Property 1: Bug Condition - Data Sync Toggle Controls Scheduled Fetch

_For any_ scheduled invocation of the Data Fetch Lambda where `dataSyncEnabled` is `false` in the SyncSettingsStore, the Lambda SHALL skip fetching from the S3 access point and write sync metadata indicating the sync was skipped, without modifying any existing data files.

**Validates: Requirements 2.1**

Property 2: Bug Condition - UX Descriptions Are Displayed

_For any_ render of the Data Upload, Dataset Merge, or Export sections, the component SHALL display descriptive text explaining the purpose and consequences of the action, using Cloudscape Alert (type="info") or Box components.

**Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

Property 3: Preservation - Manual Sync Unaffected by Toggle

_For any_ manual click of the "Sync capability data" button, the system SHALL trigger the Data Fetch Lambda and perform the full sync from the S3 access point regardless of the `dataSyncEnabled` toggle state, preserving existing manual sync behavior.

**Validates: Requirements 3.1**

Property 4: Preservation - Existing Utilities Functionality Unchanged

_For any_ interaction with the upload, merge, or export features (file selection, validation, upload, preview, confirm, download), the system SHALL produce the same functional result as before the fix, preserving all existing data management capabilities.

**Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

**File**: `source/lambda/services/sync-settings-store.ts`

**Changes**:

1. **Add `dataSyncEnabled` to `SyncSettings` interface**: Add `dataSyncEnabled: boolean` field
2. **Add `dataSyncEnabled` to `SyncSettingsResponse` interface**: Add `dataSyncEnabled: boolean` field
3. **Update `getSettings()`**: Return `dataSyncEnabled` from DynamoDB item (default `true` for backward compatibility)
4. **Update `updateSettings()`**: Accept and persist `dataSyncEnabled` field

---

**File**: `source/lambda/routes/sync-settings-routes.ts`

**Changes**:

1. **Update `toSyncSettingsResponse()`**: Include `dataSyncEnabled` in the response
2. **Update `putSyncSettingsRoute()`**: Accept `dataSyncEnabled` in the request body and pass to store

---

**File**: `source/lambda/data-fetch-lambda-main.ts`

**Changes**:

1. **Add conditional check at start of handler**: Read `dataSyncEnabled` from SyncSettingsStore. If `false`, skip the S3 access point fetch loop entirely, write metadata indicating sync was skipped, and return early.
2. **Distinguish scheduled vs manual invocation**: The Lambda event can include a `source` field (e.g., `manual` from the API route). When invoked manually, always proceed regardless of toggle.

---

**File**: `source/website/app/clients/capability-insights-client.ts`

**Changes**:

1. **Update `SyncSettingsResponse` interface**: Add `dataSyncEnabled: boolean`
2. **Update `updateSyncSettings()` parameter type**: Add `dataSyncEnabled?: boolean`

---

**File**: `source/website/app/pages/settings.tsx`

**Changes**:

1. **Add data sync toggle to `SettingsTabContent`**: Add a `Toggle` component in the "Data synchronization" container that controls `dataSyncEnabled`
2. **Load and persist toggle state**: Use the existing `getSyncSettings()` / `updateSyncSettings()` API calls

---

**File**: `source/website/app/components/data-upload-section.tsx`

**Changes**:

1. **Add description Alert**: Add `<Alert type="info">` after the container header with text: "Replace the authoritative data file in your data store with an uploaded file. This completely overwrites the existing file."
2. **Add contextual warning**: Add `<Box variant="small" color="text-body-secondary">` near the upload button warning about the destructive nature of upload

---

**File**: `source/website/app/components/dataset-merge-section.tsx`

**Changes**:

1. **Add description Alert**: Add `<Alert type="info">` with text: "Combine an uploaded file with your existing data. New items are added, existing items are updated, and nothing is deleted. Use this to bring together data from multiple sources."
2. **Add step-by-step guidance**: Add an ordered list or `Box` component explaining the workflow: (1) select target file, (2) upload merge file, (3) preview changes, (4) confirm or cancel
3. **Add helper text about non-destructive nature**: Clarify that merging preserves existing items

---

**File**: `source/website/app/components/export-section.tsx`

**Changes**:

1. **Add description Alert**: Add `<Alert type="info">` with text: "Download your current data files for backup or sharing with other deployments."

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, verify the bug conditions exist on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis.

**Test Plan**: Write tests that verify the absence of the toggle and descriptions, and that the Lambda runs unconditionally. Run on UNFIXED code to observe failures.

**Test Cases**:

1. **Missing Toggle Test**: Render SettingsTabContent and assert no data sync toggle exists (will confirm bug on unfixed code)
2. **Lambda Unconditional Fetch Test**: Invoke data-fetch-lambda handler with `dataSyncEnabled: false` in settings and verify it still fetches (will confirm bug on unfixed code)
3. **Missing Upload Description Test**: Render DataUploadSection and assert no info alert exists (will confirm bug on unfixed code)
4. **Missing Merge Description Test**: Render DatasetMergeSection and assert no info alert or guidance exists (will confirm bug on unfixed code)
5. **Missing Export Description Test**: Render ExportSection and assert no info alert exists (will confirm bug on unfixed code)

**Expected Counterexamples**:

- No toggle element found in Data Synchronization container
- Lambda fetches from S3 access point regardless of settings
- No Alert components with descriptive text in Utilities sections

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedSystem(input)
  ASSERT expectedBehavior(result)
END FOR
```

Specifically:

- Toggle present and functional in Data Synchronization container
- Lambda skips fetch when `dataSyncEnabled` is `false` and invocation is scheduled
- All three Utilities sections display descriptive text
- Dataset Merge section displays step-by-step guidance

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalSystem(input) = fixedSystem(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for manual sync, upload, merge, and export operations, then write property-based tests capturing that behavior.

**Test Cases**:

1. **Manual Sync Preservation**: Verify clicking "Sync capability data" triggers Lambda regardless of toggle state
2. **Upload Preservation**: Verify file upload workflow continues to validate, upload, and refresh
3. **Merge Preservation**: Verify merge preview/confirm workflow produces correct results
4. **Export Preservation**: Verify download links and ZIP generation continue working
5. **Terraform Overlay Preservation**: Verify Terraform overlay toggle continues to work independently

### Unit Tests

- Test `SyncSettingsStore.getSettings()` returns `dataSyncEnabled` with correct default (`true`)
- Test `SyncSettingsStore.updateSettings()` persists `dataSyncEnabled` field
- Test Data Fetch Lambda skips fetch when `dataSyncEnabled` is `false` and source is scheduled
- Test Data Fetch Lambda proceeds when `dataSyncEnabled` is `false` but source is manual
- Test Data Fetch Lambda proceeds when `dataSyncEnabled` is `true` regardless of source
- Test sync settings routes include `dataSyncEnabled` in GET/PUT responses

### Property-Based Tests

- Generate random `SyncSettings` configurations and verify `getSettings()` always returns valid defaults for missing fields
- Generate random Lambda invocation events and verify the toggle/source logic correctly determines whether to fetch
- Generate random UI states and verify descriptions are always rendered regardless of component state

### Integration Tests

- Test full Settings page renders with data sync toggle in correct initial state
- Test toggling data sync off and verifying Lambda behavior changes
- Test that manual sync button works regardless of toggle state
- Test Utilities tab renders all descriptions and guidance text
- Test that existing upload/merge/export workflows complete successfully with new descriptions present
