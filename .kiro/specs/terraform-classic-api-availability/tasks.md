# Implementation Plan: Terraform Classic API Availability

## Overview

This plan implements the Terraform Classic AWS API Availability feature in incremental steps. It extends the existing TerraformOverlayLambda with a longer timeout and new parsing capabilities, fixes the AWSCC overlay to read file contents, adds classic AWS resource-to-API-operation mapping extraction, and builds the frontend tree view. Each task builds on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Define shared types and extend infrastructure
  - [x] 1.1 Create shared Terraform classic API mapping type definitions
    - Create `source/shared/types/terraform-classic-api-mapping.ts`
    - Define `ClassicApiMappingData`, `ClassicApiMappingMetadata`, `ClassicApiResourceMapping` interfaces
    - `ClassicApiResourceMapping` must include: `terraformType`, `sdkService`, `requiredApis` (string array), `registryPath`
    - Export all types for use by Lambda and website packages
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 1.2 Extend sync metadata types
    - Modify `source/shared/types/sync-metadata.ts`
    - Add optional `terraformClassicApiMapping` field with `generatedAt`, `resourceCount`, `serviceCount`
    - _Requirements: 10.3_

  - [x] 1.3 Update CDK stack: increase overlay Lambda timeout and memory
    - Modify `source/constructs/lib/stacks/capability-insights-stack.ts`
    - Change TerraformOverlayLambda timeout from 60s to 300s (5 minutes)
    - Change memory from 256 MB to 512 MB
    - Add `GITHUB_TOKEN` environment variable (from parameter or hardcoded placeholder)
    - Extend S3 PutObject permission to include `data/json/terraform_classic_api_mapping.json`
    - Update `OverlayLambdaResponse` type to include `classicApiMappingCount`
    - _Requirements: 7.2, 11.4, 11.5_

  - [x] 1.4 Update CDK stack snapshot tests
    - Update `source/constructs/lib/stacks/capability-insights-stack.test.ts`
    - Verify updated timeout, memory, environment variables, and S3 permissions in synthesized template
    - Update snapshot file
    - _Requirements: 7.2, 11.4_

- [x] 2. Fix AWSCC overlay to read file contents
  - [x] 2.1 Create AWSCC schema content parser
    - Update `source/lambda/terraform-overlay/awscc-parser.ts`
    - Add new function `parseAwsccSchemaContent(jsonContent: string): AwsccMapping | null`
    - Extract `typeName` field from JSON content (e.g., `"typeName": "AWS::S3::Bucket"`)
    - Derive AWSCC type from the extracted CFN type using existing `cfnTypeToAwscc`
    - Keep existing `parseAwsccSchemaFilename` for backward compatibility during transition
    - _Requirements: 11.2, 11.3, 11.6_

  - [x] 2.2 Write property test for AWSCC content parser
    - Update `source/lambda/terraform-overlay/awscc-parser.property.test.ts`
    - Generate random CFN type names (format `AWS::{Service}::{Resource}`), embed in JSON with `typeName` field
    - Verify: parsing the JSON content extracts the correct CFN type and derives the correct AWSCC type
    - Use fast-check with minimum 100 iterations
    - **Feature: terraform-classic-api-availability, Property 7 (partial): AWSCC Content Parser**
    - **Validates: Requirements 11.2, 11.6**

  - [x] 2.3 Write unit tests for AWSCC content parser
    - Update `source/lambda/terraform-overlay/awscc-parser.test.ts`
    - Test known JSON content: `{"typeName": "AWS::S3::Bucket", ...}` → correct mapping
    - Test edge cases: missing typeName field, malformed JSON, empty content
    - Test that typeName with unusual casing (e.g., `AWS::IoT::Thing`) is handled correctly
    - _Requirements: 11.2, 11.3_

  - [x] 2.4 Implement concurrent file fetcher utility
    - Create `source/lambda/terraform-overlay/concurrent-fetcher.ts`
    - Implement `fetchFilesConcurrently<T>(paths, fetchFn, concurrency)` with default concurrency of 15
    - Use a semaphore/pool pattern to limit concurrent requests
    - Return `FetchResult<T>[]` with path, result (or null on failure), and optional error message
    - Log warnings for individual file failures without aborting the batch
    - _Requirements: 7.1, 11.1_

  - [x] 2.5 Write unit tests for concurrent fetcher
    - Create `source/lambda/terraform-overlay/concurrent-fetcher.test.ts`
    - Test: all files succeed → all results returned
    - Test: some files fail → successful results returned, failures logged
    - Test: concurrency limit respected (no more than N concurrent calls)
    - Test: empty input → empty output
    - _Requirements: 7.1_

  - [x] 2.6 Update overlay handler to use content-based AWSCC parsing
    - Modify `source/lambda/terraform-overlay/handler.ts`
    - Replace `parseAwsccSchemaFilename` with content-based approach:
      1. Fetch recursive tree (existing)
      2. Use `fetchFilesConcurrently` to fetch JSON file contents
      3. Parse each file's content with `parseAwsccSchemaContent`
    - Use `GITHUB_TOKEN` for rate limits (already configured in github-client)
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

  - [x] 2.7 Update handler integration tests for AWSCC fix
    - Update `source/lambda/terraform-overlay/handler.test.ts`
    - Mock GitHub client to return file contents (not just tree)
    - Verify AWSCC mappings are derived from `typeName` field in file content
    - Verify partial failures (some files fail) still produce results for successful files
    - _Requirements: 11.1, 11.2_

- [x] 3. Checkpoint - Verify AWSCC fix
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement classic AWS service package parser
  - [x] 4.1 Create service package gen parser
    - Create `source/lambda/terraform-overlay/classic-service-package-parser.ts`
    - Implement `parseServicePackageGen(content: string): ServicePackageResource[]`
    - Extract `TypeName: "aws_..."` entries from `service_package_gen.go` content
    - Also extract factory function names (e.g., `Factory: resourceBucket`) for locating resource files
    - _Requirements: 7.1, 7.6_

  - [x] 4.2 Write property test for service package parser
    - Create `source/lambda/terraform-overlay/classic-service-package-parser.property.test.ts`
    - Generate random Go source with N TypeName entries (1-50)
    - Verify: parser produces exactly N resource entries, each with correct typeName
    - Use fast-check with minimum 100 iterations
    - **Feature: terraform-classic-api-availability, Property 1 (partial): Parser Completeness**
    - **Validates: Requirements 7.1**

  - [x] 4.3 Write unit tests for service package parser
    - Create `source/lambda/terraform-overlay/classic-service-package-parser.test.ts`
    - Test known `service_package_gen.go` content with S3, EC2 resources
    - Test edge cases: empty file, no TypeName entries, malformed entries
    - Test multiple resources in a single file
    - Test extraction of factory function names
    - _Requirements: 7.1, 7.6_

- [x] 5. Implement classic AWS resource Go file parser
  - [x] 5.1 Create resource Go file parser
    - Create `source/lambda/terraform-overlay/classic-resource-parser.ts`
    - Implement `parseResourceGoFile(content: string): string[]`
    - Match SDK client method call patterns: `conn.CreateBucket(`, `client.PutObject(`, `svc.RunInstances(`
    - Filter out non-API methods: `String()`, `GoString()`, `SetXxx()`, getter patterns
    - Strip `WithContext` suffix (SDK v1 pattern): `CreateBucketWithContext` → `CreateBucket`
    - Deduplicate operation names
    - Return sorted array of unique operation names
    - _Requirements: 7.1, 7.6_

  - [x] 5.2 Write property test for resource parser
    - Create `source/lambda/terraform-overlay/classic-resource-parser.property.test.ts`
    - **Property 7: Go Source Parser Extraction**
    - Generate Go source with N distinct SDK method calls (random valid method names)
    - Verify: parser extracts at least those N operations, results are deduplicated, non-API methods excluded
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 7.1, 7.6**

  - [x] 5.3 Write unit tests for resource parser
    - Create `source/lambda/terraform-overlay/classic-resource-parser.test.ts`
    - Test known patterns: `conn.CreateBucket(input)` → `["CreateBucket"]`
    - Test multiple calls: `conn.CreateBucket(...)`, `conn.PutBucketPolicy(...)` → both extracted
    - Test WithContext stripping: `conn.CreateBucketWithContext(ctx, input)` → `["CreateBucket"]`
    - Test filtering: `String()`, `GoString()` not included
    - Test deduplication: same method called twice → single entry
    - Test no matches: file with no SDK calls → empty array
    - _Requirements: 7.1, 7.6_

- [x] 6. Implement classic API mapping assembler and writer
  - [x] 6.1 Create mapping assembler
    - Create `source/lambda/terraform-overlay/classic-api-mapping-assembler.ts`
    - Implement `assembleClassicApiMapping(params)` that combines service resources with API operations
    - For each resource, derive `registryPath` by stripping the `aws_` prefix from `terraformType`
    - Populate metadata: `generatedAt`, `providerCommitSha`, `resourceCount`, `serviceCount`
    - _Requirements: 7.7, 8.1, 8.2_

  - [x] 6.2 Write property test for registry URL derivation
    - Add to `source/lambda/terraform-overlay/classic-api-mapping-assembler.property.test.ts`
    - **Property 5: Registry URL Derivation**
    - Generate random terraform type names starting with `aws_`
    - Verify: `registryPath` equals `terraformType` with `aws_` prefix removed
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 6.2**

  - [x] 6.3 Create mapping writer
    - Create `source/lambda/terraform-overlay/classic-api-mapping-writer.ts`
    - Implement `serializeClassicApiMapping(data: ClassicApiMappingData): string`
    - Implement `deserializeClassicApiMapping(json: string): ClassicApiMappingData`
    - Implement `writeClassicApiMappingToS3(params)` to write JSON to `data/json/terraform_classic_api_mapping.json`
    - Follow same pattern as existing `mapping-writer.ts`
    - _Requirements: 7.4, 8.4_

  - [x] 6.4 Write property test for serialization round-trip
    - Create `source/lambda/terraform-overlay/classic-api-mapping-writer.property.test.ts`
    - **Property 6: Serialization Round-Trip**
    - Generate random `ClassicApiMappingData` objects with varying resources and requiredApis arrays
    - Verify: serialize to JSON → parse back → deeply equal to original
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 8.1, 8.2, 8.4**

  - [x] 6.5 Write unit tests for assembler and writer
    - Create `source/lambda/terraform-overlay/classic-api-mapping-assembler.test.ts`
    - Create `source/lambda/terraform-overlay/classic-api-mapping-writer.test.ts`
    - Test assembly with known S3, EC2 inputs produces correct structure
    - Test metadata fields populated correctly
    - Test registryPath derivation: `aws_s3_bucket` → `s3_bucket`
    - Test serialization produces valid JSON
    - Mock S3 client for write verification
    - _Requirements: 7.4, 7.7, 8.1, 8.2_

- [x] 7. Checkpoint - Verify parser and assembler modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integrate classic API mapping into overlay Lambda handler
  - [x] 8.1 Extend overlay handler with classic API mapping extraction
    - Modify `source/lambda/terraform-overlay/handler.ts`
    - After AWSCC processing, add classic AWS provider processing:
      1. Fetch recursive tree of `hashicorp/terraform-provider-aws`
      2. Identify all `internal/service/*/service_package_gen.go` paths from tree
      3. Use `fetchFilesConcurrently` to fetch all `service_package_gen.go` files
      4. Parse each to get resource TypeNames per service package
      5. For each resource, locate its Go source file and fetch content
      6. Parse each resource file for SDK client method calls
      7. Assemble `ClassicApiMappingData` and write to S3
    - Handle partial failures: skip individual files that fail, continue with others
    - Return updated `OverlayLambdaResponse` with `classicApiMappingCount`
    - _Requirements: 7.1, 7.4, 7.5, 7.6, 7.7_

  - [x] 8.2 Write integration tests for classic API mapping in handler
    - Update `source/lambda/terraform-overlay/handler.test.ts`
    - Mock GitHub client with realistic tree, service_package_gen.go content, and resource Go files
    - Mock S3 client for write verification
    - Test full execution produces both `terraform_overlay.json` and `terraform_classic_api_mapping.json`
    - Test partial failure (some resource files fail) still writes partial results
    - Test complete GitHub failure for classic provider doesn't affect AWSCC output
    - _Requirements: 7.1, 7.4, 7.5_

- [x] 9. Update data-fetch Lambda integration
  - [x] 9.1 Update data-fetch Lambda to handle extended overlay response
    - Modify `source/lambda/data-fetch-lambda-main.ts`
    - The overlay Lambda now produces both files in one invocation — no separate invocation needed
    - Update sync metadata to include `terraformClassicApiMapping` info from overlay response
    - On overlay failure: log error, add to sync metadata errors, do NOT fail primary sync
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 9.2 Write unit tests for data-fetch integration update
    - Update `source/lambda/data-fetch-lambda-main.test.ts`
    - Test overlay success: sync metadata includes both overlay and classic API mapping info
    - Test overlay failure: primary sync succeeds, error recorded in metadata
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 10. Checkpoint - Verify backend end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement frontend availability computation engine
  - [x] 11.1 Create availability engine pure functions
    - Create `source/website/app/hooks/classic-api-availability-engine.ts`
    - Implement `buildOperationAvailabilityIndex(apiRows): OperationAvailabilityIndex`
      - Maps: sdkService → operationName → Set<availableRegions>
    - Implement `computeResourceAvailability(requiredApis, sdkService, region, index): AvailabilityStatus`
      - All ops available → "Available"; any missing → "Not Available"; empty requiredApis → "Unknown"
    - Implement `getMissingOperations(requiredApis, sdkService, region, index): string[]`
      - Returns list of operations not available in the region, formatted as `{service}:{operation}`
    - Implement `buildAvailabilityTree(mapping, apiRows, regions): RegionalAvailability[]`
      - Builds three-level tree: Resource → Service → Operations
      - Resource rows get computed AND availability
      - Operation rows get actual availability from API data
    - _Requirements: 1.1-1.6, 2.1-2.4, 3.2, 3.4_

  - [x] 11.2 Write property test for tree structure correctness
    - Create `source/website/app/hooks/classic-api-availability-engine.property.test.ts`
    - **Property 1: Tree Structure Correctness**
    - Generate random mapping data + API rows
    - Verify: resources have parentId null, services reference resources, operations reference services, no fourth level
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

  - [x] 11.3 Write property test for availability AND computation
    - Add to `source/website/app/hooks/classic-api-availability-engine.property.test.ts`
    - **Property 2: Availability AND Computation**
    - Generate random resources with requiredApis, random operation availability per region
    - Verify: "Available" iff ALL required ops available; "Not Available" if any missing; deterministic
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 1.6, 2.1, 2.2, 2.4**

  - [x] 11.4 Write property test for missing operations completeness
    - Add to `source/website/app/hooks/classic-api-availability-engine.property.test.ts`
    - **Property 3: Missing Operations Completeness**
    - Generate random resources with mixed availability
    - Verify: getMissingOperations returns exactly the unavailable operations, subset of requiredApis
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 3.2, 3.4**

  - [x] 11.5 Write unit tests for availability engine
    - Create `source/website/app/hooks/classic-api-availability-engine.test.ts`
    - Test: all ops available → "Available"
    - Test: one op missing → "Not Available"
    - Test: empty requiredApis → "Unknown"
    - Test: getMissingOperations returns correct list
    - Test: tree structure with known S3, EC2 data
    - Test: operation rows have actual availability from API data
    - _Requirements: 1.1-1.6, 2.1-2.4, 3.2_

- [x] 12. Implement frontend hook and data fetching
  - [x] 12.1 Create use-classic-api-availability React hook
    - Create `source/website/app/hooks/use-classic-api-availability.ts`
    - Fetch `data/json/terraform_classic_api_mapping.json` from S3-backed origin
    - Manage state: `loading`, `error`, mapping data
    - Use `buildAvailabilityTree` to produce rows when both mapping and API data are available
    - Expose `rows`, `loading`, `error`, `resourceCount`, `serviceCount`
    - Handle fetch errors gracefully
    - _Requirements: 4.4, 4.5, 9.1, 9.2_

  - [x] 12.2 Write property test for search across tree levels
    - Create `source/website/app/hooks/use-classic-api-availability.property.test.ts`
    - **Property 4: Search Across Tree Levels**
    - Generate random tree + search substrings of resource/service/operation names
    - Verify: matching rows and their ancestors are returned, case-insensitive, partial substring
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [x] 12.3 Write unit tests for use-classic-api-availability hook
    - Create `source/website/app/hooks/use-classic-api-availability.test.ts`
    - Mock fetch responses for mapping JSON
    - Test loading state while fetching
    - Test error state on fetch failure
    - Test successful data produces correct tree rows
    - Test resourceCount and serviceCount match metadata
    - Test search filtering by resource name, service name, operation name
    - _Requirements: 4.4, 4.5, 5.1, 5.2, 9.1, 9.2_

- [x] 13. Checkpoint - Verify frontend computation logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement API View Selector component
  - [x] 14.1 Create API View Selector UI component
    - Create `source/website/app/components/availability/api-view-selector.tsx`
    - Use Cloudscape `SegmentedControl` with two options: "API Operations" (default) and "Terraform AWS"
    - Accept props: `selectedView`, `onChange`, `disabled`, `loading`
    - Show Spinner when `loading` is true
    - Disable "Terraform AWS" option when `disabled` is true (error or loading state)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 14.2 Write unit tests for API View Selector component
    - Create `source/website/app/components/availability/api-view-selector.test.tsx`
    - Test renders with "API Operations" selected by default
    - Test disabled state during loading
    - Test disabled state on error
    - Test onChange callback fires with correct view value
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 15. Integrate into API Operations tab
  - [x] 15.1 Wire API View Selector and Terraform tree into the page
    - Modify `source/website/app/pages/capability-by-region.tsx`
    - Add `useClassicApiAvailability` hook
    - Place `ApiViewSelector` above the API Operations tab content
    - When "Terraform AWS" is selected:
      - Replace API operations table with the Terraform resource tree table
      - Display resource names as hyperlinks to Terraform Registry (external, new tab)
      - Show three-level expandable tree: Resource → Service → Operations
      - Show computed AND availability for resource rows
      - Show actual availability for operation leaf rows
    - When "API Operations" is selected: show existing table unchanged
    - Update statistics: show resource count and service count for Terraform view
    - _Requirements: 1.1-1.6, 4.1-4.3, 6.1, 6.2, 6.3, 9.1, 9.2, 9.3_

  - [x] 15.2 Implement Missing API Popover
    - Add popover component for "Unavailable" cells in Terraform resource rows
    - On activation, display list of missing API operations formatted as `{service}:{action}`
    - Show all missing operations when multiple are unavailable
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 15.3 Implement search and filtering for Terraform view
    - When "Terraform AWS" view is active, search/filter matches against:
      - Terraform resource names (e.g., "s3_bucket" finds `aws_s3_bucket`)
      - SDK service names (e.g., "S3")
      - API operation names (e.g., "CreateBucket")
    - Search is case-insensitive with partial substring matching
    - Matching a resource shows it with all children; matching a child shows its ancestors
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 15.4 Write integration tests for page with Terraform AWS view
    - Test view selector switches between API operations and Terraform AWS views
    - Test resource names render as external links to Terraform Registry
    - Test three-level tree expands correctly
    - Test computed availability shows AND of child operations
    - Test missing API popover shows on unavailable cells
    - Test search filtering works across all tree levels
    - Test statistics display (resource count, service count)
    - Test error state disables Terraform AWS option with notification
    - Test loading state shows spinner and disables option
    - _Requirements: 1.1-1.6, 3.1-3.4, 4.1-4.5, 5.1-5.4, 6.1-6.3, 9.1-9.3_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses TypeScript throughout (Lambda, CDK, React frontend)
- Testing uses Vitest with fast-check for property-based tests
- The existing `source/lambda/terraform-overlay/github-client.ts` is reused for all GitHub API calls
- The existing TerraformOverlayLambda is extended (not replaced) — single Lambda handles both AWSCC and classic AWS
- Concurrent file fetching (15 workers) keeps execution within the 5-minute timeout
- `GITHUB_TOKEN` is required for the 5,000 req/hour rate limit needed to fetch thousands of Go files
