# Implementation Plan: Terraform Overlay

## Overview

This plan implements the Terraform Overlay feature in incremental steps, starting with shared types and backend parsing logic, then the Lambda handler and infrastructure, and finally the frontend view selector and label translation. Each task builds on the previous, ensuring no orphaned code.

## Tasks

- [x] 1. Define shared types and data models
  - [x] 1.1 Create shared Terraform overlay type definitions
    - Create `source/shared/types/terraform-overlay.ts`
    - Define `TerraformOverlayData`, `OverlayMetadata`, `AwsccMapping`, `ClassicAwsMapping` interfaces
    - Define `NamingConvention` type (`'cloudformation' | 'terraform-aws' | 'terraform-awscc'`)
    - Export all types for use by Lambda and website packages
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 1.2 Extend sync metadata types
    - Modify `source/shared/types/sync-metadata.ts`
    - Add optional `terraformOverlay` field with `generatedAt`, `awsccResourceCount`, `classicAwsResourceCount`
    - _Requirements: 10.2_

- [x] 2. Implement AWSCC parser module
  - [x] 2.1 Create AWSCC schema filename parser
    - Create `source/lambda/terraform-overlay/awscc-parser.ts`
    - Implement `parseAwsccSchemaFilename(filename: string): AwsccMapping | null`
    - Implement `cfnTypeToAwscc(cfnType: string): string`
    - Implement `awsccToCfnType(awsccType: string): string`
    - Transformation: `AWS_S3_Bucket.json` → CFN `AWS::S3::Bucket`, AWSCC `awscc_s3_bucket`
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 2.2 Write property test for AWSCC round-trip
    - Create `source/lambda/terraform-overlay/awscc-parser.property.test.ts`
    - **Property 1: AWSCC Filename Round-Trip**
    - Generate random service/resource name pairs (alphabetic, 2-20 chars)
    - Verify: parse filename → CFN type → back to AWSCC type produces original AWSCC type
    - Use fast-check with minimum 100 iterations
    - **Validates: Requirements 2.1, 2.2, 2.4**

  - [x] 2.3 Write property test for AWSCC completeness
    - Add to `source/lambda/terraform-overlay/awscc-parser.property.test.ts`
    - **Property 2: AWSCC Parser Completeness**
    - Generate arrays of 1-50 valid schema filenames
    - Verify: parser produces exactly one mapping per filename, output count equals input count
    - **Validates: Requirements 2.3**

  - [x] 2.4 Write unit tests for AWSCC parser
    - Create `source/lambda/terraform-overlay/awscc-parser.test.ts`
    - Test known filenames: `AWS_S3_Bucket.json`, `AWS_EC2_Instance.json`
    - Test edge cases: invalid filenames, empty strings, missing `.json` suffix
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Implement classic AWS parser module
  - [x] 3.1 Create Go source @SDKResource annotation parser
    - Create `source/lambda/terraform-overlay/classic-aws-parser.ts`
    - Implement `parseGoSourceFile(content: string): ClassicAwsMapping[]`
    - Implement `parseSdkResourceAnnotation(annotation: string): ClassicAwsMapping | null`
    - Extract Terraform resource name (first argument) and optional `cfnType` parameter
    - Mark resources without `cfnType` as unmapped (`cfnType: null`)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 3.2 Write property test for @SDKResource parsing
    - Create `source/lambda/terraform-overlay/classic-aws-parser.property.test.ts`
    - **Property 3: @SDKResource Annotation Parsing**
    - Generate Go source strings with random annotation combinations (with/without cfnType)
    - Verify: N annotations → N mappings, terraformType matches first arg, cfnType matches named param or null
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.5**

  - [x] 3.3 Write unit tests for classic AWS parser
    - Create `source/lambda/terraform-overlay/classic-aws-parser.test.ts`
    - Test annotation with cfnType: `@SDKResource("aws_instance", name="Instance", cfnType="AWS::EC2::Instance")`
    - Test annotation without cfnType: `@SDKResource("aws_s3_bucket", name="Bucket")` → null cfnType
    - Test multiple annotations in one file
    - Test files with no annotations
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Checkpoint - Verify parser modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement GitHub client and mapping writer
  - [x] 5.1 Create GitHub REST API client
    - Create `source/lambda/terraform-overlay/github-client.ts`
    - Implement `getTree(owner, repo, branch, path)` using Git Trees API (recursive, single call)
    - Implement `getFileContent(owner, repo, branch, path)` for raw file content
    - Implement `getLatestCommitSha(owner, repo, branch)` for commit SHA retrieval
    - Support optional `GITHUB_TOKEN` environment variable for rate limit headroom
    - Handle errors: network failures, 403 rate limit, 404 not found
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 5.2 Write unit tests for GitHub client
    - Create `source/lambda/terraform-overlay/github-client.test.ts`
    - Mock HTTP responses for tree listing, file content, commit SHA
    - Test error handling: 403 rate limit, 404 not found, network timeout
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 5.3 Create mapping writer module
    - Create `source/lambda/terraform-overlay/mapping-writer.ts`
    - Implement function to assemble `TerraformOverlayData` from AWSCC and classic AWS mappings
    - Implement function to write assembled JSON to S3 at `data/json/terraform_overlay.json`
    - Include metadata: `generatedAt`, commit SHAs, resource counts
    - _Requirements: 1.4, 1.6, 4.1, 4.2, 4.3_

  - [x] 5.4 Write property test for serialization round-trip
    - Create `source/lambda/terraform-overlay/mapping-writer.property.test.ts`
    - **Property 4: Mapping File Serialization Round-Trip**
    - Generate random `TerraformOverlayData` objects with arbitrary mappings
    - Verify: serialize to JSON → parse back → equivalent data structure
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**

  - [x] 5.5 Write unit tests for mapping writer
    - Create `source/lambda/terraform-overlay/mapping-writer.test.ts`
    - Test assembly with known inputs produces correct JSON structure
    - Test metadata fields are populated correctly
    - Mock S3 client for write verification
    - _Requirements: 1.4, 1.6, 4.1_

- [x] 6. Implement overlay Lambda handler
  - [x] 6.1 Create Lambda entry point
    - Create `source/lambda/terraform-overlay/handler.ts`
    - Accept `OverlayLambdaEvent` with `dataBucketName`
    - Orchestrate: fetch AWSCC tree → parse filenames → fetch classic AWS tree → parse Go files → assemble → write to S3
    - Return `OverlayLambdaResponse` with counts and optional errors
    - Handle partial failures: if one provider fails, still write results for the other
    - Log errors and retain existing mapping file on complete failure
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 10.4_

  - [x] 6.2 Write integration tests for overlay Lambda handler
    - Create `source/lambda/terraform-overlay/handler.test.ts`
    - Mock GitHub client responses with realistic AWSCC filenames and Go source
    - Mock S3 client for write verification
    - Test full execution produces correct `terraform_overlay.json` structure
    - Test partial failure (one provider fails) still writes partial results
    - Test complete GitHub failure retains existing file (no S3 write)
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 10.4_

- [x] 7. Integrate overlay invocation into data-fetch Lambda
  - [x] 7.1 Modify data-fetch Lambda to invoke overlay Lambda
    - Modify `source/lambda/data-fetch-lambda-main.ts`
    - After primary sync completes, invoke `TerraformOverlayLambda` via AWS SDK Lambda client
    - Pass `dataBucketName` from environment
    - On overlay success: include overlay metadata in sync metadata
    - On overlay failure: log error, add to sync metadata errors array, do NOT fail primary sync
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 7.2 Write unit tests for data-fetch overlay integration
    - Add tests to `source/lambda/data-fetch-lambda-main.test.ts` (or create if needed)
    - Mock Lambda invoke call
    - Test overlay success path: sync metadata includes terraform overlay info
    - Test overlay failure path: primary sync succeeds, error recorded in metadata
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 8. Checkpoint - Verify backend end-to-end
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add CDK infrastructure for overlay Lambda
  - [x] 9.1 Add TerraformOverlayLambda to CDK stack
    - Modify `source/constructs/lib/stacks/capability-insights-stack.ts`
    - Define new Lambda function `TerraformOverlayLambda` (Node.js runtime, 60s timeout)
    - Lambda runs outside VPC (needs internet access for GitHub API)
    - Grant S3 PutObject permission on website bucket for `data/json/terraform_overlay.json`
    - Grant the data-fetch Lambda permission to invoke the overlay Lambda
    - Add environment variables: `DATA_BUCKET_NAME`, optional `GITHUB_TOKEN` (from Secrets Manager or parameter)
    - Pass overlay Lambda function name to data-fetch Lambda as environment variable
    - _Requirements: 10.1, 10.4_

  - [x] 9.2 Update CDK stack snapshot tests
    - Update `source/constructs/lib/stacks/capability-insights-stack.test.ts`
    - Verify new Lambda, IAM role, and permissions appear in synthesized template
    - Update snapshot file
    - _Requirements: 10.1_

- [x] 10. Implement frontend overlay data client
  - [x] 10.1 Extend capability insights client with overlay fetch
    - Modify `source/website/app/clients/` to add `listTerraformOverlay()` method
    - Fetch `data/json/terraform_overlay.json` from the same S3-backed origin
    - Parse response as `TerraformOverlayData`
    - Handle fetch errors gracefully (return null/error state)
    - _Requirements: 5.4, 5.5_

- [x] 11. Implement label translation hook
  - [x] 11.1 Create use-terraform-overlay React hook
    - Create `source/website/app/hooks/use-terraform-overlay.ts`
    - Manage state: `convention`, `loading`, `error`, overlay data
    - Build `OverlayIndex` (lookup maps) from fetched data for O(1) translations
    - Implement `translateRows(rows)`: translate CFN labels to selected convention, filter unmapped
    - Implement `searchAllConventions(rows, query)`: match across all convention labels (case-insensitive substring)
    - Implement `getResourceCount()`: return count of visible resources for current convention
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.3, 9.1, 9.2, 9.3, 9.4_

  - [x] 11.2 Write property test for label translation
    - Create `source/website/app/hooks/use-terraform-overlay.property.test.ts`
    - **Property 5: Label Translation Correctness**
    - Generate random CFN rows + overlay index combinations
    - Verify: (a) labels match selected convention, (b) unmapped excluded in Terraform views, (c) unmapped included in Terraform views, (d) Terraform-only excluded in CFN view
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.3**

  - [x] 11.3 Write property test for cross-convention search
    - Add to `source/website/app/hooks/use-terraform-overlay.property.test.ts`
    - **Property 6: Cross-Convention Search**
    - Generate random search terms + row/mapping combinations
    - Verify: returns all rows where query is case-insensitive substring of any convention label, results use active convention labels
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

  - [x] 11.4 Write property test for resource count accuracy
    - Add to `source/website/app/hooks/use-terraform-overlay.property.test.ts`
    - **Property 7: Resource Count Accuracy**
    - Generate random rows + overlay data + convention selection
    - Verify: resource count equals number of visible rows after translation/filtering
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [x] 11.5 Write unit tests for use-terraform-overlay hook
    - Create `source/website/app/hooks/use-terraform-overlay.test.ts`
    - Test default convention is CloudFormation
    - Test translation with known mappings
    - Test search matches across conventions
    - Test unmapped resource handling
    - Test loading and error states
    - _Requirements: 6.1, 6.2, 6.3, 7.1, 8.1_

- [x] 12. Implement View Selector component
  - [x] 12.1 Create View Selector UI component
    - Create `source/website/app/components/availability/view-selector.tsx`
    - Use Cloudscape `SegmentedControl` with three options: "CloudFormation" (default), "Terraform AWS", "Terraform AWSCC"
    - Accept props: `selectedConvention`, `onChange`, `disabled`, `loading`
    - Show loading indicator when `loading` is true
    - Disable control when `disabled` is true (error state)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 12.2 Write unit tests for View Selector component
    - Create `source/website/app/components/availability/view-selector.test.tsx`
    - Test renders with CloudFormation selected by default
    - Test disabled state during loading
    - Test disabled state on error
    - Test onChange callback fires with correct convention value
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 13. Integrate overlay into Capabilities by Region page
  - [x] 13.1 Wire View Selector and translation into the page
    - Modify `source/website/app/pages/capability-by-region.tsx`
    - Add `useTerraformOverlay` hook
    - Place `ViewSelector` component above the CloudFormation resources tab content
    - Apply `translateRows` to the resource data before rendering the availability table
    - Apply `searchAllConventions` to the search/filter logic
    - Update statistics card to use `getResourceCount()` for the selected convention
    - Display error notification if overlay fails to load
    - Show unmapped resources with "No CFN mapping" indicator when Terraform view is active
    - Add filter option to separate mapped from unmapped resources
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4_

  - [x] 13.2 Write integration tests for page with overlay
    - Test page renders with View Selector
    - Test switching conventions updates labels
    - Test search works across conventions
    - Test error state shows notification and disables selector
    - Test unmapped resources display correctly
    - _Requirements: 5.1, 6.1, 6.2, 6.3, 7.1, 8.1, 8.2_

- [x] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses TypeScript throughout (Lambda, CDK, React frontend)
- Testing uses Vitest with fast-check for property-based tests
- No static mapping tables — all derivation happens at fetch time from GitHub source
