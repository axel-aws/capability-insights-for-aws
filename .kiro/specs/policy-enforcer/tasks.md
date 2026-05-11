# Implementation Plan: Policy Enforcer

## Overview

Implement the Policy Enforcer feature incrementally, starting with pure computation logic (easily testable, no dependencies), then building outward to data models, API routes, deployment template generation, the Refresh Lambda, and finally the Web UI. Each PR is a self-contained, reviewable unit of work.

## PR Strategy

Stacked PRs targeting `feature/policy-enforcer`, with a final PR to `main` for release.

| PR  | Branch                           | Tasks | Scope                                           | Target                    |
| --- | -------------------------------- | ----- | ----------------------------------------------- | ------------------------- |
| 1   | `feature/policy-enforcer-core`   | 1-3   | Core computation logic (pure functions + tests) | `feature/policy-enforcer` |
| 2   | `feature/policy-enforcer-api`    | 5-6   | Backend persistence + API routes                | `feature/policy-enforcer` |
| 3   | `feature/policy-enforcer-lambda` | 8-9   | Template generator + Refresh Lambda             | `feature/policy-enforcer` |
| 4   | `feature/policy-enforcer-ui`     | 11-12 | Web UI (listing page + create wizard)           | `feature/policy-enforcer` |
| 5   | `feature/policy-enforcer-infra`  | 14    | Infrastructure wiring (CDK + packaging)         | `feature/policy-enforcer` |
| 6   | `feature/policy-enforcer`        | all   | Full feature release                            | `main`                    |

## Tasks

- [ ] 1. Define data models and validation utilities
  - [ ] 1.1 Create PolicyConfiguration types and interfaces
    - Create `source/shared/types/policy-enforcer/policy-configuration.ts`
    - Define `PolicyConfiguration`, `PolicyTag`, `ExceptionEntry`, `PolicyStatus`, `RefreshOutcome` types
    - Define `CreatePolicyRequest`, `ListPoliciesQuery`, `PreviewResponse` API request/response interfaces
    - _Requirements: 7.1, 7.4, 7.6, 7a.1, 7a.2, 7a.3, 13.1, 13.8_

  - [ ] 1.2 Implement exception entry validation
    - Create `source/lambda/services/policy-enforcer/validation.ts`
    - Implement `validateExceptionEntry(action: string): boolean` that accepts only strings matching `^[a-zA-Z0-9-]+:(([A-Z][a-zA-Z0-9]*)|(\*))$`
    - Implement `validatePolicyConfiguration(config: CreatePolicyRequest): ValidationResult` for full request validation (non-empty regions, valid mode, valid policyType, valid refreshIntervalHours 1-24)
    - _Requirements: 6.3, 1.3, 1.5, 13.8_

  - [ ]\* 1.3 Write property test for exception entry validation
    - **Property 10: Exception entry format validation**
    - Generate random strings (valid patterns like `s3:GetObject`, `ec2:*` and invalid patterns like empty, missing colon, lowercase action)
    - Assert acceptance if and only if the string matches the regex pattern
    - **Validates: Requirements 6.3**

  - [ ]\* 1.4 Write unit tests for validation utilities
    - Test specific valid entries: `s3:GetObject`, `ec2:*`, `elasticloadbalancing:CreateLoadBalancer`
    - Test specific invalid entries: `s3:getObject` (lowercase), `s3:`, `:GetObject`, `s3`, ``
    - Test full configuration validation edge cases
    - _Requirements: 6.3, 1.3, 1.5_

- [ ] 2. Implement Allow-List Computation Engine
  - [ ] 2.1 Create IAM action mapping with overrides table
    - Create `source/lambda/services/policy-enforcer/iam-action-mapping.ts`
    - Implement `IAM_SERVICE_PREFIX_OVERRIDES` record with known mismatches (elasticloadbalancingv2 to elasticloadbalancing, monitoring to cloudwatch, etc.)
    - Implement `toIamAction(sdkServiceName: string, apiAction: string): string`
    - _Requirements: 3.3_

  - [ ]\* 2.2 Write property test for IAM action mapping
    - **Property 5: IAM action mapping preserves service and operation identity**
    - Generate random alphanumeric service names and PascalCase action names
    - Assert output format is `prefix:action` where prefix is override or original, and action is unchanged
    - **Validates: Requirements 3.3**

  - [ ] 2.3 Implement computeAllowList pure function
    - Create `source/lambda/services/policy-enforcer/allow-list-engine.ts`
    - Implement `computeAllowList(input: AllowListInput): AllowListResult`
    - Handle intersection mode: include action only if Available in ALL selected regions
    - Handle union mode: include action if Available in ANY selected region
    - Add all exception entries regardless of availability
    - Return sorted, deduplicated action list
    - Treat missing availability data for a region as "Not Available"
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 14.1, 14.2, 14.3_

  - [ ]\* 2.4 Write property test for intersection mode
    - **Property 1: Intersection mode includes only universally available actions**
    - Generate random `ApiService[]` with random `AvailabilityStatus` per region, random region subsets
    - Assert every action in result has `Available` status in ALL selected regions
    - **Validates: Requirements 2.2, 3.1**

  - [ ]\* 2.5 Write property test for union mode
    - **Property 2: Union mode includes only regionally available actions**
    - Generate random `ApiService[]` with random `AvailabilityStatus` per region, random region subsets
    - Assert every non-exception action in result has `Available` status in at least one selected region
    - **Validates: Requirements 2.3, 3.2**

  - [ ]\* 2.6 Write property test for intersection is subset of union
    - **Property 3: Intersection is a subset of union**
    - Generate random catalog data and region sets
    - Compute both modes with same exceptions, assert intersection result is subset of union result
    - **Validates: Requirements 3.5**

  - [ ]\* 2.7 Write property test for exceptions always included
    - **Property 4: Exceptions are always included**
    - Generate random catalog data, random region selection, random exception entries
    - Assert every exception action appears in the computed allow-list regardless of mode or availability
    - **Validates: Requirements 3.4, 6.4**

  - [ ]\* 2.8 Write property test for allow-list output invariants
    - **Property 9: Allow-list output invariants**
    - Generate random valid inputs
    - Assert output is (a) sorted alphabetically, (b) free of duplicates, (c) deterministic (same input produces same output)
    - **Validates: Requirements 14.1, 14.2, 6.6**

  - [ ]\* 2.9 Write unit tests for computeAllowList
    - Test with known catalog data: 2 services, 3 regions, specific availability matrix
    - Test intersection mode excludes action unavailable in one region
    - Test union mode includes action available in any region
    - Test empty regions returns empty allow-list (caught by validation)
    - Test exception for unavailable service is still included
    - Test duplicate exception does not produce duplicate in output
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.4, 3.6, 6.6_

- [ ] 3. Implement Policy Document Generator
  - [ ] 3.1 Create generatePolicyDocument function
    - Create `source/lambda/services/policy-enforcer/policy-document-generator.ts`
    - Implement `generatePolicyDocument(options: PolicyDocumentOptions): GeneratedPolicy`
    - Generate `{ Version: "2012-10-17", Statement: [{ Sid, Effect: "Deny", NotAction: [...], Resource: "*" }] }`
    - Include generation timestamp in Sid field
    - Handle IAM size limit (6,144 chars): split NotAction across multiple documents if exceeded
    - Handle SCP size limit (5,120 chars): return error if exceeded (cannot split)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.2, 5.3, 5.4_

  - [ ]\* 3.2 Write property test for policy document structure
    - **Property 6: Generated policy document has valid structure**
    - Generate random non-empty action lists and both policy types
    - Assert Version is "2012-10-17", at least one Statement with Effect "Deny", NotAction array, Resource "\*", Sid contains timestamp
    - **Validates: Requirements 4.1, 4.2, 4.4, 5.2, 5.4**

  - [ ]\* 3.3 Write property test for policy size limits
    - **Property 7: Policy size limits are enforced**
    - Generate action lists of varying sizes (small to very large)
    - Assert IAM documents never exceed 6,144 chars each; SCP returns error if would exceed 5,120 chars
    - **Validates: Requirements 4.3, 5.3**

  - [ ]\* 3.4 Write property test for action round-trip
    - **Property 8: Policy document action round-trip**
    - Generate random sorted action lists
    - Generate policy document, parse JSON, extract NotAction arrays (flatten across statements/documents)
    - Assert extracted list equals original allow-list
    - **Validates: Requirements 4.5, 14.4**

  - [ ]\* 3.5 Write unit tests for policy document generator
    - Test small allow-list produces single document
    - Test large allow-list triggers split for IAM type
    - Test SCP exceeding limit returns error with guidance message
    - Test empty allow-list produces valid document (denies everything)
    - Snapshot test for known allow-list producing expected JSON
    - _Requirements: 4.1, 4.2, 4.3, 5.3_

- [ ] 4. Create PR: Core computation logic
  - Ensure all tests pass for tasks 1-3
  - Commit all changes from tasks 1-3
  - Push branch `feature/policy-enforcer-core` and create PR targeting `feature/policy-enforcer`
  - PR title: "[CapabilityInsights] feat(policy-enforcer): Core computation engine"
  - PR description: "Pure functions for allow-list computation, IAM action mapping, policy document generation, and validation. No infrastructure changes."
  - _Depends on: Tasks 1, 2, 3_

- [ ] 5. Implement Policy Configuration persistence layer
  - [ ] 5.1 Create DynamoDB client for PolicyConfiguration CRUD
    - Create `source/lambda/services/policy-enforcer/policy-config-store.ts`
    - Implement `createPolicy`, `getPolicy`, `listPolicies`, `updatePolicy`, `deletePolicy` methods
    - Implement serialization/deserialization between PolicyConfiguration and DynamoDB item format
    - Support filtering by tag key/value, status, and search across name/description
    - Use existing DynamoDB patterns from the codebase (DynamoDB DocumentClient)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7a.4, 7a.8_

  - [ ]\* 5.2 Write property test for configuration serialization round-trip
    - **Property 11: Configuration serialization round-trip**
    - Generate random valid `PolicyConfiguration` objects
    - Serialize to DynamoDB item format and deserialize back
    - Assert deep equality with original
    - **Validates: Requirements 7.6**

  - [ ]\* 5.3 Write unit tests for policy config store
    - Test serialization/deserialization with known configurations
    - Test filtering by tag, status, and search term
    - Test unique name constraint detection
    - _Requirements: 7.4, 7.6, 7a.4_

- [ ] 6. Implement Backend API Routes
  - [ ] 6.1 Create policy routes handler
    - Create `source/lambda/routes/policy-routes.ts`
    - Implement `POST /policies` — validate request, create config, return 201
    - Implement `GET /policies` — list all configs with optional filters (tagKey, tagValue, status, search)
    - Implement `GET /policies/:policyId` — return single config or 404
    - Implement `PUT /policies/:policyId` — validate and update config or 404
    - Implement `DELETE /policies/:policyId` — remove config or 404
    - Implement `POST /policies/:policyId/refresh` — trigger immediate refresh
    - Implement `GET /policies/:policyId/preview` — fetch catalog data from S3, compute allow-list, return preview
    - Implement `GET /policies/:policyId/template` — generate and return CloudFormation template
    - Return proper error responses: 400 (validation), 404 (not found), 409 (duplicate name), 503 (catalog unavailable)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [ ] 6.2 Register policy routes in API Lambda main
    - Update `source/lambda/api-lambda-main.ts` to import and register all policy routes
    - Register exact routes: `POST /policies`, `GET /policies`
    - Register parameterized routes: `GET /policies/:policyId`, `PUT /policies/:policyId`, `DELETE /policies/:policyId`, `POST /policies/:policyId/refresh`, `GET /policies/:policyId/preview`, `GET /policies/:policyId/template`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_

  - [ ]\* 6.3 Write unit tests for policy routes
    - Test POST /policies with valid request returns 201
    - Test POST /policies with missing required fields returns 400
    - Test GET /policies returns list
    - Test GET /policies/:policyId with unknown ID returns 404
    - Test PUT /policies/:policyId updates and returns 200
    - Test DELETE /policies/:policyId removes and returns 200
    - Test GET /policies/:policyId/preview returns computed allow-list
    - Mock DynamoDB and S3 dependencies
    - _Requirements: 13.1-13.9_

- [ ] 7. Create PR: Backend persistence and API routes
  - Ensure all tests pass for tasks 5-6
  - Commit all changes from tasks 5-6
  - Push branch `feature/policy-enforcer-api` and create PR targeting `feature/policy-enforcer`
  - PR title: "[CapabilityInsights] feat(policy-enforcer): Backend API and persistence"
  - PR description: "DynamoDB persistence layer and REST API routes for policy configuration CRUD, preview, refresh, and template download."
  - _Depends on: Task 4 (PR 1 merged into feature/policy-enforcer)_

- [ ] 8. Implement Deployment Template Generator
  - [ ] 8.1 Create CloudFormation template generator
    - Create `source/lambda/services/policy-enforcer/template-generator.ts`
    - Implement `generateDeploymentTemplate(params: TemplateParameters): string`
    - Generate CloudFormation JSON with: RefreshLambda (Node.js 24.x, arm64, 256MB, 300s timeout), ConfigTable (DynamoDB PAY_PER_REQUEST, encryption at rest), LambdaExecutionRole, RefreshSchedule (EventBridge), ManagedPolicy (initially empty), InitialRefreshCustomResource
    - Support optional VPC deployment with VPC endpoints for DynamoDB, IAM, Organizations, Catalog API
    - Include parameters for catalogApiEndpoint, refreshIntervalHours, VPC config
    - Output the Policy ARN
    - Propagate policy configuration tags to all resources
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 7a.6_

  - [ ]\* 8.2 Write unit tests for template generator
    - Snapshot test for generated template with default parameters
    - Snapshot test for generated template with VPC deployment enabled
    - Verify all required resources are present in output
    - Verify IAM policy type vs SCP type produces correct resource configuration
    - Verify tags are propagated to all resources
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6, 7a.6_

- [ ] 9. Implement Refresh Lambda
  - [ ] 9.1 Create Refresh Lambda handler
    - Create `source/lambda/refresh-lambda-main.ts`
    - Implement `handler(): Promise<RefreshResult>`
    - Read PolicyConfiguration from DynamoDB Config Table
    - Fetch catalog data from Catalog API with retry (3 retries, exponential backoff: 1s, 2s, 4s)
    - Call `computeAllowList` with fetched data and config
    - Call `generatePolicyDocument` with computed allow-list
    - Update IAM Policy or SCP via AWS SDK (with retry: 3 retries, exponential backoff)
    - On total failure: retain existing policy (fail-open), log warning
    - Emit CloudWatch metrics: `PolicyRefreshSuccess` on success, `PolicyUpdateFailure` on failure
    - Update config table with lastRefreshTime, lastRefreshOutcome, lastActionCount
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ]\* 9.2 Write unit tests for Refresh Lambda
    - Test successful refresh flow with mocked dependencies
    - Test retry behavior on catalog API failure (verify 3 retries with backoff)
    - Test fail-open: existing policy retained when all retries fail
    - Test CloudWatch metric emission on success and failure
    - Test IAM update retry on transient failure
    - _Requirements: 8.6, 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 10. Create PR: Template generator and Refresh Lambda
  - Ensure all tests pass for tasks 8-9
  - Commit all changes from tasks 8-9
  - Push branch `feature/policy-enforcer-lambda` and create PR targeting `feature/policy-enforcer`
  - PR title: "[CapabilityInsights] feat(policy-enforcer): Deployment template and Refresh Lambda"
  - PR description: "CloudFormation template generator for customer deployment and the Refresh Lambda that runs daily to update policies from catalog data."
  - _Depends on: Task 7 (PR 2 merged into feature/policy-enforcer)_

- [ ] 11. Implement Web UI - Policy Enforcer page and listing
  - [ ] 11.1 Create Policy Enforcer API client methods
    - Add policy methods to `source/website/app/clients/capability-insights-client.ts` (or create a new `policy-enforcer-client.ts`)
    - Implement: `createPolicy`, `listPolicies`, `getPolicy`, `updatePolicy`, `deletePolicy`, `refreshPolicy`, `previewPolicy`, `downloadTemplate`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

  - [ ] 11.2 Create PolicyEnforcerPage with table listing
    - Create `source/website/app/pages/policy-enforcer/policy-enforcer-page.tsx`
    - Display all policy configurations in a Cloudscape Table with columns: name, regions (count), mode, policy type, status, last refresh, tags
    - Add filtering by name/description search, tag values, and status
    - Add "Create Policy" button that navigates to the create wizard
    - Add "Refresh Now" button per row with loading indicator while refresh is in progress
    - Display last refresh timestamp and outcome per row
    - _Requirements: 12.1, 12.2, 12.5, 12.6, 12.7, 7a.4, 7a.7_

  - [ ] 11.3 Add Policy Enforcer navigation item
    - Update the application sidebar/navigation to include "Policy Enforcer" link
    - Add route configuration for the Policy Enforcer page
    - _Requirements: 12.1_

- [ ] 12. Implement Web UI - Create Policy Wizard
  - [ ] 12.1 Create multi-step Create Policy Wizard
    - Create `source/website/app/pages/policy-enforcer/create-policy-wizard.tsx`
    - Implement Cloudscape Wizard with steps: Name/Description/Tags, Regions, Mode, Exceptions, Policy Type, Review
    - Step 1: Name (required, unique), description (optional), TagEditor component for key-value tags
    - Step 2: RegionPicker multi-select populated from catalog regions
    - Step 3: ModeSelector radio group (Intersection/Union) with descriptions, default to Intersection
    - Step 4: ExceptionsEditor with add/remove/search, format validation on entry
    - Step 5: Policy type radio (IAM Policy / SCP) with SCP warning about org-wide impact
    - Step 6: Review summary with allow-list preview (action count, searchable list), estimated policy size, split warning if applicable
    - On submit: call createPolicy API, navigate to listing page
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.4, 2.5, 5.1, 5.5, 6.1, 6.2, 6.3, 6.5, 7a.1, 7a.2, 7a.3, 12.3, 12.4_

  - [ ] 12.2 Create AllowListPreview component
    - Create `source/website/app/pages/policy-enforcer/components/allow-list-preview.tsx`
    - Display searchable Cloudscape Table showing computed actions
    - Show action count, excluded count, exception count
    - Show estimated policy size and whether split is required
    - _Requirements: 12.4_

  - [ ] 12.3 Create PolicyArnDisplay component
    - Create `source/website/app/pages/policy-enforcer/components/policy-arn-display.tsx`
    - Display Policy ARN with copy-to-clipboard button
    - Show CDK and CloudFormation code snippets for attaching the policy
    - Handle multiple ARNs if policy was split
    - Show SCP ID and org-unit guidance when policy type is SCP
    - Show "pending first refresh" message when no ARN exists yet
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 12.4 Create RefreshStatus component
    - Create `source/website/app/pages/policy-enforcer/components/refresh-status.tsx`
    - Show last refresh time, outcome (success/retained/error), and action count
    - Include "Refresh Now" button that triggers immediate refresh
    - Show loading indicator while refresh is in progress
    - _Requirements: 12.5, 12.6, 12.7_

- [ ] 13. Create PR: Web UI
  - Ensure all tests pass for tasks 11-12
  - Commit all changes from tasks 11-12
  - Push branch `feature/policy-enforcer-ui` and create PR targeting `feature/policy-enforcer`
  - PR title: "[CapabilityInsights] feat(policy-enforcer): Web UI pages and components"
  - PR description: "Policy Enforcer listing page, create wizard (name/tags, regions, mode, exceptions, type, review), ARN display, and refresh status components."
  - _Depends on: Task 10 (PR 3 merged into feature/policy-enforcer)_

- [ ] 14. Infrastructure and deployment wiring
  - [ ] 14.1 Add DynamoDB table and environment variables to CDK stack
    - Update `source/constructs/lib/stacks/capability-insights-stack.ts`
    - Add DynamoDB table resource for PolicyConfiguration (PAY_PER_REQUEST, encryption at rest)
    - Add GSIs for policyName uniqueness and accountId listing
    - Add `POLICY_TABLE_NAME` environment variable to the API Lambda
    - Add DynamoDB read/write permissions to the API Lambda role
    - _Requirements: 7.2, 7.4_

  - [ ] 14.2 Configure Refresh Lambda packaging
    - Create build configuration to package `refresh-lambda-main.ts` separately from the API Lambda
    - Ensure the Refresh Lambda bundle includes: allow-list-engine, policy-document-generator, iam-action-mapping, validation utilities
    - Update `source/lambda/package.json` build scripts if needed
    - _Requirements: 8.1, 9.1, 9.7_

  - [ ]\* 14.3 Write CDK stack snapshot test update
    - Update `source/constructs/lib/stacks/__snapshots__/capability-insights-stack.test.ts.snap` by running the existing stack test
    - Verify new DynamoDB table and permissions appear in snapshot
    - _Requirements: 7.2_

- [ ] 15. Create PR: Infrastructure wiring
  - Ensure all tests pass for task 14
  - Commit all changes from task 14
  - Push branch `feature/policy-enforcer-infra` and create PR targeting `feature/policy-enforcer`
  - PR title: "[CapabilityInsights] feat(policy-enforcer): CDK infrastructure and Lambda packaging"
  - PR description: "DynamoDB table, GSIs, IAM permissions, environment variables, and Refresh Lambda build configuration."
  - _Depends on: Task 13 (PR 4 merged into feature/policy-enforcer)_

- [ ] 16. Create final PR: Feature release
  - Ensure all sub-PRs are merged into `feature/policy-enforcer`
  - Create PR from `feature/policy-enforcer` targeting `main`
  - PR title: "[CapabilityInsights] feat: Policy Enforcer for regional governance"
  - PR description: "Complete Policy Enforcer feature — generates and maintains IAM/SCP policies based on regional capability availability. Includes computation engine, API routes, Refresh Lambda, Web UI, and CDK infrastructure."
  - _Depends on: Tasks 4, 7, 10, 13, 15 (all sub-PRs merged)_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- PR tasks (4, 7, 10, 13, 15) are the commit/review gates — each depends on the previous PR being merged
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- The implementation starts with pure functions (allow-list engine, policy document generator) that have no external dependencies, making them easy to test in isolation
- The Refresh Lambda reuses the same computation modules (allow-list-engine, policy-document-generator) ensuring consistency between preview and actual policy generation
