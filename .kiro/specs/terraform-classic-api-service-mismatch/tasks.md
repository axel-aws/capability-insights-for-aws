# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Case-Insensitive Service Name Matching and Parent Fallback
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases:
    - Parent fallback case: operation rows without `sdkServiceName` where parent has `name: "AWS Organizations"` and `sdkServiceName: "Organizations"` — verify index key is "organizations" (lowercase of sdkServiceName), not "aws organizations"
    - Case mismatch case: index built with PascalCase SDK names ("Organizations", "DynamoDB", "CloudWatch"), lookups using lowercase Terraform names ("organizations", "dynamodb", "cloudwatch") — verify lookups succeed
  - Test file: `source/website/app/hooks/classic-api-availability-engine.property.test.ts`
  - Test that `buildOperationAvailabilityIndex` with parent fallback rows produces keys derived from `parent.sdkServiceName` (not `parent.name`)
  - Test that `computeResourceAvailability("organizations", ...)` finds data indexed under "Organizations"
  - Test that `getMissingOperations("dynamodb", ...)` finds data indexed under "DynamoDB"
  - Test that `buildAvailabilityTree` with lowercase Terraform mapping names resolves against PascalCase API data
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found (e.g., `computeResourceAvailability(["DeleteResourcePolicy"], "organizations", "us-east-1", index)` returns "Not Available" when index key is "AWS Organizations" or "Organizations")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Exact Match Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (exact case matches like "S3", "EC2", "IAM")
  - Test file: `source/website/app/hooks/classic-api-availability-engine.property.test.ts`
  - Observe: `buildOperationAvailabilityIndex` with rows having `sdkServiceName: "S3"` produces index key "S3" → after fix will be "s3" (lowercase), but lookups with "S3" should still work because lookup is also lowercased
  - Observe: `computeResourceAvailability(["CreateBucket"], "S3", "us-east-1", index)` returns "Available" on unfixed code
  - Observe: `getMissingOperations(["CreateBucket", "NonExistent"], "S3", "us-east-1", index)` returns `["S3:NonExistent"]` on unfixed code
  - Write property-based test: for all service names where `sdkServiceName` is set directly on operation rows and the lookup uses the exact same value, the result of `computeResourceAvailability` matches expected AND-logic (Available iff all ops available)
  - Write property-based test: for all exact-match services, `getMissingOperations` returns exactly the set of unavailable operations formatted as `service:operation`
  - Write property-based test: for all exact-match services, `buildAvailabilityTree` produces correct three-level structure with correct availability
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix for service name mismatch in classic API availability engine
  - [x] 3.1 Fix parent fallback to use `sdkServiceName` instead of `name`
    - In `buildOperationAvailabilityIndex`, change `serviceName = parent.name` to `serviceName = parent.sdkServiceName ?? parent.name`
    - This ensures the SDK service name (e.g., "Organizations") is used instead of the full display name (e.g., "AWS Organizations")
    - _Bug_Condition: isBugCondition(input) where parent.name != parent.sdkServiceName and index uses parent.name_
    - _Expected_Behavior: index key derived from parent.sdkServiceName_
    - _Preservation: Services where sdkServiceName is set directly on operation rows are unaffected_
    - _Requirements: 1.1, 2.1_

  - [x] 3.2 Normalize index keys to lowercase in `buildOperationAvailabilityIndex`
    - After determining `serviceName`, normalize to lowercase: `const normalizedService = serviceName.toLowerCase()`
    - Use `normalizedService` as the map key instead of `serviceName`
    - This ensures "Organizations", "DynamoDB", "CloudWatch" are stored as "organizations", "dynamodb", "cloudwatch"
    - _Bug_Condition: isBugCondition(input) where lowercase(lookupKey) == lowercase(indexKey) but lookupKey != indexKey_
    - _Expected_Behavior: all index keys are lowercase, enabling case-insensitive matching_
    - _Preservation: Exact-match services like "S3" become "s3" in index, but lookups are also lowercased so behavior is preserved_
    - _Requirements: 2.2, 2.3_

  - [x] 3.3 Normalize lookup keys to lowercase in `computeResourceAvailability`
    - Before `operationAvailabilityIndex.get(sdkService)`, normalize: `const normalizedService = sdkService.toLowerCase()`
    - Use `normalizedService` for the map lookup
    - _Bug_Condition: case mismatch between Terraform mapping name and index key_
    - _Expected_Behavior: lookup with "organizations" finds data stored under "organizations" (previously "Organizations")_
    - _Preservation: lookup with "S3" becomes "s3" which matches index key "s3"_
    - _Requirements: 2.2, 3.2_

  - [x] 3.4 Normalize lookup keys to lowercase in `getMissingOperations`
    - Before `operationAvailabilityIndex.get(sdkService)`, normalize: `const normalizedService = sdkService.toLowerCase()`
    - Use `normalizedService` for the map lookup
    - Keep original `sdkService` value for the formatted output string (`${sdkService}:${operation}`)
    - _Bug_Condition: case mismatch between Terraform mapping name and index key_
    - _Expected_Behavior: lookup with "dynamodb" finds data stored under "dynamodb"_
    - _Preservation: output format unchanged — still uses original sdkService value in formatted strings_
    - _Requirements: 2.2, 3.2_

  - [x] 3.5 Normalize lookup keys to lowercase in `buildAvailabilityTree`
    - When looking up `resource.sdkService` in the index, normalize: `index.get(resource.sdkService.toLowerCase())`
    - Apply to both the `computeResourceAvailability` call (already handled by 3.3) and the direct `index.get(resource.sdkService)` call for operation-level rows
    - _Bug_Condition: case mismatch in tree building between Terraform resource sdkService and index keys_
    - _Expected_Behavior: tree correctly resolves operation availability for lowercase service names_
    - _Preservation: tree structure (3 levels) and AND-logic unchanged_
    - _Requirements: 2.2, 2.3, 3.3_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Case-Insensitive Service Name Matching and Parent Fallback
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Exact Match Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run full test suite for `classic-api-availability-engine`: `npx vitest run source/website/app/hooks/classic-api-availability-engine.test.ts source/website/app/hooks/classic-api-availability-engine.property.test.ts`
  - Ensure all existing unit tests still pass (no regressions in tree structure, AND-logic, missing operations)
  - Ensure all property-based tests pass (bug condition, preservation, existing properties)
  - Ensure no TypeScript compilation errors
  - Ask the user if questions arise
