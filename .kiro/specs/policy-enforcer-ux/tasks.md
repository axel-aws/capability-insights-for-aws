# Implementation Tasks

## Task 1: Extend IAM Helper Lambda with new actions

- [x] 1.1 Add `getPolicyDocument` action to IAM Helper Lambda
  - Add `GetPolicyVersionCommand` import from `@aws-sdk/client-iam`
  - Implement `getPolicyDocument` case that calls `GetPolicyVersion` for the default version (or specified `versionId`)
  - Return the policy document JSON string and metadata in the result
  - Handle errors (policy not found, access denied) and return appropriate error messages
- [x] 1.2 Add `listVersions` action to IAM Helper Lambda
  - Implement `listVersions` case that calls `ListPolicyVersionsCommand`
  - Return an array of `PolicyVersionSummary` objects with versionId, isDefaultVersion, and createDate
  - Handle errors and return appropriate error messages
- [x] 1.3 Update IAMHelperEvent and IAMHelperResult types
  - Extend `IAMHelperEvent.action` union type with `'getPolicyDocument' | 'listVersions'`
  - Add `versionId?: string` to `IAMHelperEvent`
  - Add `policyDocument?: string` and `versions?: PolicyVersionSummary[]` to `IAMHelperResult`
  - Add `PolicyVersionSummary` interface export
- [x] 1.4 Write unit tests for new IAM Helper actions
  - Test `getPolicyDocument` with mocked IAM SDK (success and error cases)
  - Test `listVersions` with mocked IAM SDK (success, empty versions, error)
  - Test unknown action still returns error

## Task 2: Add shared types for policy parts

- [x] 2.1 Create PolicyPart and related types in shared package
  - Add `PolicyPart`, `PolicyPartsResponse`, `PolicyPartDetailResponse`, `ServiceActionGroup`, and `CascadingDeleteResponse` interfaces to `source/shared/types/policy-enforcer/policy-configuration.ts`
  - Export all new types from the shared package

## Task 3: Implement policy parts API routes

- [x] 3.1 Implement `GET /policies/:policyId/parts` route handler
  - Load PolicyConfiguration from DynamoDB
  - Derive parts array from `policyArn` and `additionalPolicyArns`
  - For each ARN, invoke IAM Helper with `getPolicyDocument` to get document size
  - Determine part type: index 0 = `blanket-deny`, index 1+ = `specific-api-deny`
  - Count statement items (NotAction length or Action length)
  - Return `PolicyPartsResponse` with parts array, totalParts, and combinedSize
  - Handle 404 when policyId not found
- [x] 3.2 Implement `GET /policies/:policyId/parts/:partIndex` route handler
  - Load PolicyConfiguration, resolve ARN by partIndex
  - Invoke IAM Helper with `getPolicyDocument` for that ARN
  - Parse the document JSON, extract actions, group by service prefix
  - Return `PolicyPartDetailResponse` with part metadata, document, and service groups
  - Handle 404 (policy not found, part index out of range)
  - Handle 502 when IAM call fails
- [x] 3.3 Implement `DELETE /policies/:policyId/parts/:partIndex` route handler
  - Load PolicyConfiguration, resolve ARN by partIndex
  - Invoke IAM Helper with `delete` action for that ARN
  - On success: remove the ARN from the config (update `policyArn` or `additionalPolicyArns`)
  - On failure: return error response, do not modify config
  - Handle 404 (policy not found, part index out of range)
- [x] 3.4 Enhance existing `DELETE /policies/:policyId` for cascading delete
  - Collect all ARNs (primary + additional)
  - Attempt deletion of each ARN via IAM Helper, continuing on individual failures
  - Track `deletedArns` and `failedArns` arrays
  - If all succeed: delete DynamoDB record, return success
  - If partial failure: delete DynamoDB record anyway, return `CascadingDeleteResponse` with failures
  - If no ARNs exist (never refreshed): skip IAM deletion, just delete DynamoDB record
- [x] 3.5 Register new routes in API Lambda router
  - Add route registrations for the three new endpoints in `api-lambda-main.ts`
- [x] 3.6 Write unit tests for policy parts routes
  - Test GET parts with mocked store and IAM helper (0 parts, 1 part, multiple parts)
  - Test GET part detail with mocked IAM response
  - Test DELETE single part (success and failure cases)
  - Test cascading delete (all success, partial failure, no parts)
  - Test 404 and 502 error responses

## Task 4: Implement pure utility functions

- [x] 4.1 Implement `computePartsSummary` function
  - Input: array of PolicyPart objects
  - Output: `{ totalParts: number, combinedSize: number }`
  - Logic: totalParts = array.length, combinedSize = sum of documentSize values
- [x] 4.2 Implement `countStatementItems` function
  - Input: IAM policy document JSON object
  - Output: number of items in the first Statement's NotAction or Action array
  - Handle documents with multiple statements (sum all)
- [x] 4.3 Implement `groupActionsByService` function
  - Input: array of IAM action strings (e.g., "s3:GetObject")
  - Output: array of `ServiceActionGroup` sorted by servicePrefix
  - Split on first colon, group by prefix
- [x] 4.4 Implement `computeNextRefresh` function
  - Input: lastRefreshTime (ISO string), refreshIntervalHours (number)
  - Output: next refresh time as ISO string
  - Logic: parse date, add hours in milliseconds, return ISO string
- [x] 4.5 Implement snippet generation functions
  - `generateMultiPolicyCdkSnippet(arns: string[], policyName: string): string`
  - `generateMultiPolicyCfnSnippet(arns: string[]): string`
  - Both must include every ARN from the input array
- [x] 4.6 Write property-based tests for utility functions
  - Property 1: computePartsSummary correctness (totalParts = length, combinedSize = sum)
  - Property 2: countStatementItems matches array length
  - Property 3: snippet generation includes all ARNs
  - Property 4: groupActionsByService preserves all actions and groups correctly
  - Property 5: computeNextRefresh adds exact interval
  - Property 6: buildDeleteConfirmationArns includes all ARNs without duplicates
  - Property 7: partial failure reporting covers full ARN set
  - Property 8: parts derivation produces correct count and types

## Task 5: Extend frontend API client

- [x] 5.1 Add `getPolicyParts` method to PolicyEnforcerClient
  - `GET /policies/:policyId/parts` → returns `PolicyPartsResponse`
- [x] 5.2 Add `getPolicyPartDetail` method to PolicyEnforcerClient
  - `GET /policies/:policyId/parts/:partIndex` → returns `PolicyPartDetailResponse`
- [x] 5.3 Add `deletePolicyPart` method to PolicyEnforcerClient
  - `DELETE /policies/:policyId/parts/:partIndex`
- [x] 5.4 Update `deletePolicy` method for cascading delete response
  - Parse and return `CascadingDeleteResponse` from the enhanced delete endpoint
- [x] 5.5 Add `refreshAllPolicies` method to PolicyEnforcerClient
  - Calls `POST /policies/:policyId/refresh` for each active policy (or a new bulk endpoint)

## Task 6: Build Policy Detail Page

- [x] 6.1 Create `PolicyDetailPage` component with route registration
  - Add route `policy-enforcer/:policyId` in `routes.ts`
  - Create `source/website/app/pages/policy-enforcer/policy-detail-page.tsx`
  - Load policy config via `getPolicy(policyId)` on mount
  - Display policy name, description, status, regions, mode, and type in a header
  - Include tabs or sections for: Parts, Attachment, Status, Actions (delete/refresh)
- [x] 6.2 Make policy names in the list page clickable links to the detail page
  - Update the `name` column in `policy-enforcer-page.tsx` to use a Link component
  - Navigate to `/policy-enforcer/${item.policyId}` on click

## Task 7: Build Policy Parts Table component

- [x] 7.1 Create `PolicyPartsTable` component
  - Fetch parts via `getPolicyParts(policyId)` on mount
  - Display Cloudscape Table with columns: Part #, ARN, Type, Size, Statement Items
  - Show summary row with total parts and combined size
  - Handle loading state and empty state (no refresh yet → info message)
  - Support row selection to trigger part detail view
- [x] 7.2 Create `PartDetailViewer` component
  - Accept a `PolicyPartDetailResponse` prop
  - Display the JSON document in a Cloudscape CodeEditor or pre-formatted Box
  - Show service action groups in a collapsible section below the code viewer
  - Display statement item count badge

## Task 8: Build Attachment Instructions component

- [x] 8.1 Create `AttachmentInstructions` component
  - Accept `parts: PolicyPart[]`, `policyType: 'IAM' | 'SCP'`, `policyName: string` props
  - If multiple parts: show warning Alert about attaching all parts
  - If single part: show simplified instructions without warning
  - Display copyable ARN list using CopyToClipboard components
- [x] 8.2 Add CDK and CloudFormation snippet sections for IAM type
  - Use `generateMultiPolicyCdkSnippet` and `generateMultiPolicyCfnSnippet`
  - Display in ExpandableSection components with copy buttons
- [x] 8.3 Add SCP attachment instructions for SCP type
  - Extract SCP ID from ARN
  - Display instructions for attaching to an organizational unit

## Task 9: Build Status Dashboard component

- [x] 9.1 Create `StatusDashboard` component
  - Accept `policies: PolicyConfiguration[]` prop
  - Display each policy with: status indicator, part count badge, last refresh timestamp, next refresh time
  - Show error context when status is "error"
  - Compute next refresh using `computeNextRefresh`
- [x] 9.2 Add "Refresh All" bulk action
  - Button in the dashboard header
  - On click: call `refreshPolicy` for each policy with status "active"
  - Show loading indicator per-policy during refresh
- [x] 9.3 Implement auto-refresh with 60-second interval
  - Use `useEffect` with `setInterval` to reload policy data every 60 seconds
  - Only run when the page is visible (use `document.visibilityState` or Page Visibility API)
  - Clear interval on unmount

## Task 10: Build Delete Flow components

- [x] 10.1 Create `DeleteConfirmationModal` component
  - Accept `policy: PolicyConfiguration`, `onConfirm`, `onCancel` props
  - List all ARNs (primary + additional) that will be deleted
  - If no ARNs exist: show simplified message about DynamoDB-only deletion
  - Require user to type policy name to confirm (destructive action pattern)
- [x] 10.2 Implement cascading delete flow in the detail page
  - Wire delete button to open `DeleteConfirmationModal`
  - On confirm: call `deletePolicy` (enhanced cascading endpoint)
  - Handle partial failure: show warning with failed ARNs
  - On full success: navigate back to policy list
- [x] 10.3 Create single-part delete confirmation
  - Show modal warning that removing a single part breaks full coverage
  - On confirm: call `deletePolicyPart`
  - On success: reload parts table
  - On failure: show error toast with IAM error message

## Task 11: Write frontend component tests

- [x] 11.1 Write tests for PolicyPartsTable component
  - Test rendering with 0, 1, and multiple parts
  - Test loading state
  - Test empty state message when no refresh has occurred
  - Test row selection triggers detail view
- [x] 11.2 Write tests for AttachmentInstructions component
  - Test multi-part warning appears with >1 parts
  - Test single-part omits warning
  - Test IAM type shows CDK and CloudFormation snippets
  - Test SCP type shows SCP-specific instructions
- [x] 11.3 Write tests for StatusDashboard component
  - Test rendering of multiple policies with different statuses
  - Test next refresh time display
  - Test error context display for error status
  - Test auto-refresh timer with fake timers
- [x] 11.4 Write tests for DeleteConfirmationModal component
  - Test all ARNs are listed
  - Test confirmation requires typing policy name
  - Test no-ARN case shows simplified message
