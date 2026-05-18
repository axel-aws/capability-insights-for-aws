# Implementation Plan: Infrastructure Planning

## Overview

This plan implements the Infrastructure Planning feature for the Capability Insights dashboard. The feature allows users to upload IaC templates (CloudFormation YAML/JSON, Terraform HCL) or point to GitHub repositories, extract AWS resources and API operations, and filter the regional availability table to show only relevant services. The implementation follows established patterns from the Policy Enforcer feature (DynamoDB + S3 persistence, parameterized API routes, React Router pages with Cloudscape components, PropertyFilter integration).

## Tasks

- [x] 1. Set up shared types and interfaces
  - [x] 1.1 Create Infrastructure Planning shared type definitions
    - Create `source/shared/types/infrastructure-planning/plan-configuration.ts`
    - Define `PlanSourceType`, `PlanStatus`, `PlanLabel`, `PlanConfiguration`, `CapabilitySet`, `CreatePlanRequest`, `UpdatePlanRequest`, `ListPlansQuery`, `PlanNamesResponse` interfaces
    - Follow the same pattern as `source/shared/types/policy-enforcer/policy-configuration.ts`
    - Export all types from a barrel file
    - _Requirements: 4.6, 5.1, 5.2_

- [x] 2. CDK infrastructure changes
  - [x] 2.1 Add PlanConfiguration DynamoDB table to CapabilityInsightsStack
    - Add a new DynamoDB table `CapabilityInsightsPlanConfiguration` with `planId` as HASH key
    - Add GSI `PlanNameIndex` with `planName` as HASH key for uniqueness enforcement and name lookups
    - Configure PAY_PER_REQUEST billing, SSE enabled, point-in-time recovery enabled
    - Apply DESTROY removal policy (matching existing `policyTable` pattern)
    - Add `PLAN_TABLE_NAME` environment variable to the API Lambda function
    - _Requirements: 5.1, 5.3_

  - [x] 2.2 Add IAM permissions for plan S3 operations
    - Add `s3:PutObject` and `s3:DeleteObject` permissions for `data/plans/*` path in the website bucket to the API Lambda role
    - The existing `S3ReadCapabilityData` policy already grants `s3:GetObject` on `data/*`
    - _Requirements: 5.2, 5.5_

  - [x] 2.3 Add IAM permissions for PlanConfiguration DynamoDB table
    - Grant the API Lambda role `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem`, `dynamodb:Query`, `dynamodb:Scan` on the plan table and its indexes
    - Follow the same pattern as `DynamoDBPolicyTableAccess` policy
    - _Requirements: 5.1_

- [x] 3. Implement CloudFormation template parser
  - [x] 3.1 Create CFN template parser module
    - Create `source/lambda/services/infrastructure-planning/parsers/cfn-template-parser.ts`
    - Implement `parseCfnTemplate(content: string): string[]` function
    - Attempt YAML parse (using `js-yaml`), fall back to JSON parse
    - Validate presence of `Resources` key at top level
    - Extract `Type` field from each resource entry
    - Filter to only `AWS::*` prefixed types
    - Deduplicate and sort the result
    - Throw descriptive errors for invalid content or missing Resources section
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 10.1, 10.2, 10.5_

  - [x] 3.2 Write property tests for CFN parser — Property 1: extraction completeness
    - **Property 1: CloudFormation parser extracts all resource types**
    - Use `fast-check` to generate arbitrary valid CFN templates with random `AWS::*` resource types
    - Assert parser returns exactly the set of unique types present in the template
    - Create file `source/lambda/services/infrastructure-planning/parsers/cfn-template-parser.property.test.ts`
    - Minimum 100 iterations
    - **Validates: Requirements 1.1, 1.2, 10.1, 10.2, 10.5**

  - [x] 3.3 Write property tests for CFN parser — Property 2: round-trip consistency
    - **Property 2: CloudFormation parser round-trip**
    - Generate lists of valid CFN resource types, construct a template, parse it, verify equivalence
    - **Validates: Requirements 10.4**

  - [x] 3.4 Write property tests for CFN parser — Property 5: invalid template rejection
    - **Property 5: Invalid template rejection**
    - Generate arbitrary strings that are not valid YAML/JSON, assert parser throws an error
    - **Validates: Requirements 1.4, 2.4**

  - [x] 3.5 Write property tests for CFN parser — Property 6: deduplication invariant
    - **Property 6: Deduplication invariant**
    - Generate templates with duplicate resource types, assert result contains no duplicates
    - **Validates: Requirements 1.6, 2.6, 3.10**

- [x] 4. Implement Terraform template parser
  - [x] 4.1 Create Terraform template parser module
    - Create `source/lambda/services/infrastructure-planning/parsers/terraform-template-parser.ts`
    - Implement `parseTerraformTemplate(content: string): string[]` function
    - Use regex `/resource\s+"([^"]+)"\s+"[^"]+"/g` to extract resource type identifiers
    - Filter to only `aws_*` or `awscc_*` prefixed types
    - Ignore `data` blocks (pattern: `data "type" "name"`)
    - Deduplicate and sort
    - Throw descriptive errors for content with no resource blocks
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 11.1, 11.2, 11.5, 11.6_

  - [x] 4.2 Write property tests for Terraform parser — Property 3: extraction completeness
    - **Property 3: Terraform parser extracts all resource block types**
    - Generate valid HCL files with random `aws_*`/`awscc_*` resource blocks
    - Assert parser returns exactly the unique resource type identifiers from resource blocks
    - Create file `source/lambda/services/infrastructure-planning/parsers/terraform-template-parser.property.test.ts`
    - Minimum 100 iterations
    - **Validates: Requirements 2.1, 2.2, 11.1, 11.2, 11.5**

  - [x] 4.3 Write property tests for Terraform parser — Property 4: round-trip consistency
    - **Property 4: Terraform parser round-trip**
    - Generate lists of valid Terraform resource type identifiers, construct HCL, parse it, verify equivalence
    - **Validates: Requirements 11.4**

- [x] 5. Implement Terraform-to-CloudFormation mapper
  - [x] 5.1 Create Terraform mapper module
    - Create `source/lambda/services/infrastructure-planning/terraform-mapper.ts`
    - Implement `TerraformMapper` class with `mapToCfn(terraformTypes: string[], overlayData: TerraformOverlayData): { cfnTypes: string[], mapping: Record<string, string> }` method
    - For `awscc_*` types: convert via naming convention (`awscc_s3_bucket` → `AWS::S3::Bucket`)
    - For `aws_*` types: look up in overlay data's `classicAwsMappings`
    - Unmapped types retained without CFN equivalent
    - Reuse existing `TerraformOverlayData` type from `source/shared/types/terraform-overlay.ts`
    - _Requirements: 2.3, 12.1, 12.2, 12.3, 12.4_

  - [x] 5.2 Write property tests for Terraform mapper — Property 9: AWSCC mapping
    - **Property 9: AWSCC-to-CloudFormation mapping**
    - Generate valid `awscc_*` types, assert mapper produces correct `AWS::Service::Resource` format
    - Create file `source/lambda/services/infrastructure-planning/terraform-mapper.property.test.ts`
    - Minimum 100 iterations
    - **Validates: Requirements 12.1**

  - [x] 5.3 Write property tests for Terraform mapper — Property 10: AWS overlay mapping
    - **Property 10: AWS-to-CloudFormation mapping via overlay**
    - Generate `aws_*` types with a mock overlay, assert correct lookup behavior
    - Assert unmapped types are retained without CFN equivalent
    - **Validates: Requirements 12.2, 12.3**

  - [x] 5.4 Write property tests for Terraform mapper — Property 11: preserves both types
    - **Property 11: Mapping preserves both original and mapped types**
    - Assert that successfully mapped types appear in both `terraformResourceTypes` and `cfnResourceTypes`
    - **Validates: Requirements 12.4**

- [x] 6. Implement GitHub repository analyzer
  - [x] 6.1 Create repository analyzer module
    - Create `source/lambda/services/infrastructure-planning/parsers/repository-analyzer.ts`
    - Implement `RepositoryAnalyzer` class with `analyze(repositoryUrl: string, pat: string): Promise<CapabilitySet>` method
    - Validate GitHub URL format (`https://github.com/{owner}/{repo}`)
    - Use GitHub Trees API to list all files recursively
    - Classify files by extension (`.go`, `.yaml`, `.json`, `.tf`)
    - For `.go` files: reuse `parseResourceGoFile` from existing `terraform-overlay/classic-resource-parser.ts`
    - For `.yaml`/`.json` files: check for `Resources` section, use CFN parser
    - For `.tf` files: use Terraform parser
    - Aggregate and deduplicate all extracted types and operations
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [x] 6.2 Write property tests for repository analyzer — Property 15: GitHub URL validation
    - **Property 15: GitHub URL validation**
    - Generate valid and invalid URL strings, assert validator accepts only `https://github.com/{owner}/{repo}` format
    - Create file `source/lambda/services/infrastructure-planning/parsers/repository-analyzer.property.test.ts`
    - Minimum 100 iterations
    - **Validates: Requirements 3.7**

- [x] 7. Checkpoint - Ensure all parser and mapper tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement plan store (persistence layer)
  - [x] 8.1 Create plan store module
    - Create `source/lambda/services/infrastructure-planning/plan-store.ts`
    - Implement `PlanStore` class with methods: `createPlan`, `getPlan`, `listPlans`, `updatePlan`, `deletePlan`, `getPlanByName`, `listPlanNames`
    - Use DynamoDB for metadata (plan configuration) and S3 for capability set data
    - Generate UUID for `planId` on creation
    - Enforce plan name uniqueness via GSI query before insert
    - Store capability set at `data/plans/{planId}/capability-set.json` in S3
    - Handle partial delete failures gracefully (DynamoDB + S3 cleanup)
    - Follow patterns from `source/lambda/services/policy-enforcer/policy-config-store.ts`
    - _Requirements: 4.1, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 8.2 Write property tests for plan store — Property 7: plan name uniqueness
    - **Property 7: Plan name uniqueness**
    - Assert that creating two plans with the same name results in a conflict error for the second
    - Create file `source/lambda/services/infrastructure-planning/plan-store.property.test.ts`
    - Minimum 100 iterations
    - **Validates: Requirements 4.1, 4.5**

  - [x] 8.3 Write property tests for plan store — Property 8: metadata round-trip
    - **Property 8: Plan metadata round-trip**
    - Generate arbitrary plan configurations with random labels, create then retrieve, assert equivalence
    - **Validates: Requirements 4.2, 4.4, 4.6**

- [x] 9. Implement plan processor (orchestration)
  - [x] 9.1 Create plan processor module
    - Create `source/lambda/services/infrastructure-planning/plan-processor.ts`
    - Implement `PlanProcessor` class with `process(request: CreatePlanRequest): Promise<CapabilitySet>` method
    - Route to appropriate parser based on `sourceType` (cloudformation, terraform, github)
    - For terraform: run parser then mapper to produce both terraform and CFN types
    - For github: delegate to repository analyzer
    - Derive service names from CFN resource types (extract `AWS::{ServiceName}::*` segment)
    - Validate template size (reject > 1MB)
    - Handle base64 decoding of `templateContent`
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 3.3, 3.4_

  - [x] 9.2 Write property tests for plan processor — Property 16: service name derivation
    - **Property 16: Service name derivation from resource types**
    - Generate CFN resource types in `AWS::{Service}::{Resource}` format
    - Assert service name derivation extracts the correct service segment
    - Create file `source/lambda/services/infrastructure-planning/plan-processor.property.test.ts`
    - Minimum 100 iterations
    - **Validates: Requirements 6.9**

- [x] 10. Implement API routes
  - [x] 10.1 Create plan routes module
    - Create `source/lambda/routes/plan-routes.ts`
    - Implement route handlers: `createPlanRoute`, `listPlansRoute`, `getPlanRoute`, `updatePlanRoute`, `deletePlanRoute`, `reprocessPlanRoute`, `getCapabilitySetRoute`, `listPlanNamesRoute`
    - Follow patterns from `source/lambda/routes/policy-routes.ts`
    - Handle request validation, error responses, and CORS headers
    - _Requirements: 4.1, 4.2, 5.4, 5.5, 5.6, 9.5_

  - [x] 10.2 Register plan routes in api-lambda-main.ts
    - Register exact routes: `POST /plans`, `GET /plans`, `GET /plans/names`
    - Register parameterized routes: `GET /plans/:planId`, `PUT /plans/:planId`, `DELETE /plans/:planId`, `POST /plans/:planId/reprocess`, `GET /plans/:planId/capability-set`
    - Import and wire up handlers from `plan-routes.ts`
    - _Requirements: 5.4, 9.5_

- [x] 11. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement frontend API client
  - [x] 12.1 Create infrastructure planning client
    - Create `source/website/app/clients/infrastructure-planning-client.ts`
    - Implement functions: `createPlan`, `listPlans`, `getPlan`, `updatePlan`, `deletePlan`, `reprocessPlan`, `getCapabilitySet`, `listPlanNames`
    - Follow patterns from existing API client modules in the website workspace
    - Use the same base URL and fetch patterns as other clients
    - _Requirements: 5.4, 8.5, 9.4_

- [x] 13. Implement frontend pages
  - [x] 13.1 Create Infrastructure Planning list page
    - Create `source/website/app/pages/infrastructure-planning/infrastructure-planning-page.tsx`
    - Display a table of all stored plans with columns: name, source type, resource count, API operation count, created date, labels
    - Add "Create plan" action button
    - Add search/filter capabilities for the plan list
    - Follow patterns from `source/website/app/pages/policy-enforcer/policy-enforcer-page.tsx`
    - _Requirements: 5.4, 7.3_

  - [x] 13.2 Create Infrastructure Planning wizard page
    - Create `source/website/app/pages/infrastructure-planning/create-plan-wizard.tsx`
    - Implement multi-step wizard: (1) Select source type, (2) Provide source content, (3) Name and metadata, (4) Review and create
    - For CloudFormation: file upload accepting `.yaml`, `.yml`, `.json`
    - For Terraform: file upload accepting `.tf`
    - For GitHub: text input for repository URL with PAT warning if not configured
    - Handle processing errors inline with ability to go back
    - Navigate to detail page on success
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 13.3 Create Infrastructure Planning detail page
    - Create `source/website/app/pages/infrastructure-planning/plan-detail-page.tsx`
    - Display plan name, source type, creation date, last-updated date, metadata labels
    - Show extracted capability set as a table (resource types and API operations with counts)
    - Add "Apply as filter", "Edit metadata", "Re-process", and "Delete" action buttons
    - "Apply as filter" navigates to Capability by Region page with plan filter pre-applied
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 13.4 Register infrastructure planning routes
    - Add routes to `source/website/app/routes.ts`:
      - `route('infrastructure-planning', '...')`
      - `route('infrastructure-planning/create', '...')`
      - `route('infrastructure-planning/:planId', '...')`
    - _Requirements: 7.2_

- [x] 14. Implement filter integration
  - [x] 14.1 Add plan filter property to availability table
    - Add `plan` property to `createFilteringProperties` in `availability-table-properties.tsx`
    - Add `onLoadItems` handler for plan names autocomplete (fetch from `listPlanNames`)
    - Add plan capability data cache (same pattern as `stackResourceCache`)
    - Extend `createFilteringFunction` to handle `plan` tokens with `=` and `!=` operators
    - Implement `itemMatchesPlan` matching logic per tab (CFN, API, Services)
    - Handle async capability set loading with loading state (fail-open until data loads)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8, 6.9, 6.10_

  - [x] 14.2 Write property tests for plan filter — Property 12: inclusion correctness
    - **Property 12: Plan filter inclusion correctness**
    - Generate availability rows and capability sets, assert `plan = "X"` includes row iff it matches the set
    - Create file `source/website/app/components/availability/plan-filter.property.test.ts`
    - Minimum 100 iterations
    - **Validates: Requirements 6.1, 6.3, 6.7, 6.8, 6.9**

  - [x] 14.3 Write property tests for plan filter — Property 13: exclusion correctness
    - **Property 13: Plan filter exclusion correctness**
    - Assert `plan != "X"` includes row iff it does NOT match the set
    - **Validates: Requirements 6.4**

  - [x] 14.4 Write property tests for plan filter — Property 14: composition with AND/OR
    - **Property 14: Plan filter composition with AND/OR**
    - Generate combinations of plan filter tokens with other filter tokens
    - Assert correct boolean composition under AND and OR operations
    - **Validates: Requirements 6.6**

- [x] 15. Update navigation
  - [x] 15.1 Add Infrastructure Planning to side navigation
    - Add "Infrastructure Planning" link to `SideNavigation` items in `source/website/app/components/app-shell/app-shell.tsx`
    - Position between "Policy Enforcer" and "Settings" items
    - Link to `/infrastructure-planning` route
    - Add `PAGE_INFRASTRUCTURE_PLANNING` constant to `source/website/app/constants/app.ts`
    - _Requirements: 7.1, 7.2_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Add `lastRefreshedAt` and `repositoryUrl` to PlanConfiguration type
  - [x] 17.1 Update PlanConfiguration interface with new fields
    - Add `lastRefreshedAt: string` field to `PlanConfiguration` in `source/shared/types/infrastructure-planning/plan-configuration.ts`
    - Add optional `repositoryUrl?: string` field to `PlanConfiguration`
    - _Requirements: 4.4, 6.2_

- [x] 18. Create GitHubFetchLambda handler
  - [x] 18.1 Create the GitHubFetchLambda entry point and handler
    - Create `source/lambda/github-fetch-lambda-main.ts`
    - Accept invocation payload: `{ repositoryUrl: string, pat: string }`
    - Validate GitHub URL format using existing `isValidGitHubUrl` / `parseGitHubUrl` from repository-analyzer
    - Call GitHub Trees API to retrieve recursive file tree for HEAD branch
    - Classify and filter files (extensions: `.go`, `.java`, `.py`, `.ts`, `.js`, `.yaml`, `.yml`, `.json`, `.tf`)
    - Exclude test directories (`test`, `tests`, `__tests__`, `spec`), vendor directories (`vendor`, `node_modules`, `.venv`, `site-packages`, `__pycache__`, `target/dependency`, `build/classes`), and test file patterns (`_test.`, `.test.`, `.spec.`)
    - Prioritize SDK files (Go → Java → Python → TypeScript) before infrastructure files
    - Fetch file contents concurrently (max 15 simultaneous requests) with 100-second elapsed time cutoff
    - Return success response: `{ success: true, tree: Array<{ path, type, size? }>, files: Record<string, string>, metadata: { filesProcessed, totalFilesIdentified, timedOut } }`
    - Return error response: `{ success: false, error: string, errorType: 'auth' | 'not_found' | 'rate_limit' | 'timeout' | 'unknown' }`
    - Handle GitHub API 401 (auth error) and 404 (not found) responses
    - Configure Lambda timeout at 120 seconds
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3_

  - [x] 18.2 Write unit tests for GitHubFetchLambda handler
    - Test URL validation, file classification, exclusion rules, response contract
    - Test error handling for 401 and 404 GitHub responses
    - Test timeout cutoff behavior
    - _Requirements: 1.6, 1.7, 8.1, 8.2, 8.3, 8.4, 9.2, 9.3, 9.4_

- [x] 19. CDK infrastructure for GitHubFetchLambda
  - [x] 19.1 Add GitHubFetchLambda to CapabilityInsightsStack
    - Create IAM execution role with `AWSLambdaBasicExecutionRole` managed policy (following TerraformOverlayLambda pattern)
    - Deploy Lambda function WITHOUT VPC configuration (no `vpcConfig` property)
    - Use same deployment assets S3 bucket and code zip path as other Lambda functions
    - Set handler to `lambda/github-fetch-lambda-main.handler`
    - Configure 512 MB memory, 120 second timeout
    - Set runtime to `nodejs24.x`
    - Grant the API Lambda permission to invoke the GitHubFetchLambda (add to `InvokeDataFetchLambda` policy or create new policy)
    - Add `GITHUB_FETCH_FUNCTION_NAME` environment variable to the API Lambda function
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.6_

  - [x] 19.2 Update CDK snapshot test
    - Update `source/constructs/lib/stacks/__snapshots__/capability-insights-stack.test.ts.snap` by running the CDK test
    - _Requirements: 2.1, 2.2_

- [x] 20. Checkpoint - Ensure CDK and GitHubFetchLambda tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 21. Refactor RepositoryAnalyzer to use Lambda invocation
  - [x] 21.1 Refactor PlanProcessor to invoke GitHubFetchLambda instead of direct HTTP
    - Modify `PlanProcessor` constructor options to accept a `invokeGitHubFetch` function (or Lambda client)
    - In `processGitHub`, invoke the GitHubFetchLambda via AWS SDK Lambda `InvokeCommand` instead of calling `repositoryAnalyzer.analyze()` directly
    - Read the `GITHUB_FETCH_FUNCTION_NAME` environment variable for the function name
    - Parse the GitHubFetchLambda response and pass returned file contents to local parsers (CFN, TF, Go, Java, Python, TypeScript)
    - Handle Lambda invocation errors with descriptive error messages
    - Handle the GitHubFetchLambda error response types (`auth`, `not_found`, `rate_limit`, `timeout`)
    - Remove direct HTTP calls to GitHub API from the API Lambda process
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 21.2 Write unit tests for refactored PlanProcessor GitHub flow
    - Mock Lambda invocation and verify correct delegation
    - Test error handling for Lambda invocation failures
    - Test parsing of GitHubFetchLambda success and error responses
    - _Requirements: 3.2, 3.3, 3.5_

- [x] 22. Update plan-store for refresh metadata and source persistence
  - [x] 22.1 Update PlanStore to persist `lastRefreshedAt` and `repositoryUrl`
    - In `createPlan`: set `lastRefreshedAt` to creation timestamp, persist `repositoryUrl` from request if sourceType is `github`
    - In `updateCapabilitySet`: update `lastRefreshedAt` to current timestamp when capability set is refreshed
    - Ensure `listPlans` and `getPlan` responses include `lastRefreshedAt` and `repositoryUrl` fields
    - _Requirements: 4.1, 4.2, 4.3, 5.5, 6.1, 6.2, 6.3_

  - [x] 22.2 Write unit tests for plan-store refresh metadata
    - Test that `lastRefreshedAt` is set on creation
    - Test that `lastRefreshedAt` is updated on refresh
    - Test that `repositoryUrl` is persisted for GitHub plans
    - _Requirements: 4.1, 4.2, 4.3, 6.1_

- [x] 23. Update plan-routes for refresh action
  - [x] 23.1 Update `reprocessPlanRoute` to implement full refresh flow
    - Accept optional `templateContent` in request body for CloudFormation/Terraform refreshes
    - For GitHub-sourced plans: use stored `repositoryUrl` from plan metadata (fall back to request body)
    - Return 400 if GitHub plan has no `repositoryUrl` in metadata or request body
    - Invoke `PlanProcessor.process()` with reconstructed `CreatePlanRequest`
    - On success: update capability set, `lastRefreshedAt`, resource counts via `PlanStore.updateCapabilitySet()`
    - On failure: return error without modifying existing plan data
    - Validate that refresh produces non-zero capabilities (treat zero results as failure)
    - Return 404 if plan does not exist
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 23.2 Write unit tests for updated reprocessPlanRoute
    - Test GitHub refresh using stored repositoryUrl
    - Test CloudFormation/Terraform refresh with re-submitted template
    - Test 400 error when GitHub plan has no repositoryUrl
    - Test 404 for non-existent plan
    - Test that existing data is not modified on failure
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 24. Fix JSON/CloudFormation upload issue
  - [x] 24.1 Investigate and fix "fetch failed" error for template uploads
    - Verify that CloudFormation template processing does NOT make external network calls
    - Ensure `processCloudFormation` in PlanProcessor decodes and parses entirely within the Lambda process
    - Verify that Terraform processing fetches overlay data from S3 (accessible via VPC endpoint) without internet
    - Check for any unintended `fetch()` calls in the CFN/Terraform parsing pipeline
    - If the issue is in the frontend (browser `fetch` to API Gateway), verify the API endpoint URL and CORS configuration
    - Ensure invalid templates return exactly a 400 status code with descriptive message
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 24.2 Write regression tests for template upload flows
    - Test CloudFormation JSON template upload end-to-end (no network calls)
    - Test CloudFormation YAML template upload end-to-end
    - Test Terraform template upload with S3 overlay fetch
    - Test that invalid templates produce 400 errors
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 25. Wire everything together and integration
  - [x] 25.1 Update `plan-routes.ts` to pass GitHubFetchLambda function name to PlanProcessor
    - Read `GITHUB_FETCH_FUNCTION_NAME` from environment variables
    - Pass Lambda invocation capability to `PlanProcessor` constructor
    - Ensure `getProcessor()` factory function creates processor with Lambda invocation support
    - _Requirements: 3.6_

  - [x] 25.2 Update `api-lambda-main.ts` if needed for new environment variables
    - Verify `GITHUB_FETCH_FUNCTION_NAME` is accessible in the Lambda environment
    - No new routes needed (reprocess route already registered)
    - _Requirements: 3.6_

- [x] 26. Final checkpoint - Ensure all new tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check` (already available in both lambda and website workspaces)
- Unit tests validate specific examples and edge cases
- The implementation follows established patterns from the Policy Enforcer feature for consistency
- All TypeScript interfaces are defined in the shared workspace for cross-workspace reuse

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "3.1", "4.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.2", "4.3", "5.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4", "6.1"] },
    { "id": 4, "tasks": ["6.2", "8.1", "9.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "9.2", "10.1"] },
    { "id": 6, "tasks": ["10.2", "12.1"] },
    { "id": 7, "tasks": ["13.1", "13.2", "13.3", "13.4"] },
    { "id": 8, "tasks": ["14.1", "15.1"] },
    { "id": 9, "tasks": ["14.2", "14.3", "14.4"] },
    { "id": 10, "tasks": ["17.1", "18.1"] },
    { "id": 11, "tasks": ["18.2", "19.1"] },
    { "id": 12, "tasks": ["19.2", "21.1", "22.1"] },
    { "id": 13, "tasks": ["21.2", "22.2", "23.1", "24.1"] },
    { "id": 14, "tasks": ["23.2", "24.2", "25.1"] },
    { "id": 15, "tasks": ["25.2"] }
  ]
}
```
