# Terraform Classic API Service Mismatch Bugfix Design

## Overview

The Terraform AWS tab incorrectly shows "Not Available" for operations that are actually available, due to a service name mismatch between the operation availability index and the Terraform mapping data. The fix addresses two root causes: (1) the parent fallback in `buildOperationAvailabilityIndex` uses `parent.name` (the full display name like "AWS Organizations") instead of `parent.sdkServiceName` (the SDK name like "Organizations"), and (2) the lookup is case-sensitive while Terraform mapping uses lowercase directory names (e.g., "organizations") that don't match PascalCase SDK names (e.g., "Organizations"). The fix normalizes the index to use lowercase keys and corrects the parent fallback field.

## Glossary

- **Bug_Condition (C)**: The condition where a service name lookup fails due to either (a) the parent fallback using `name` instead of `sdkServiceName`, or (b) case mismatch between the Terraform mapping service name and the index key
- **Property (P)**: The desired behavior where service lookups succeed regardless of case differences between Terraform mapping names and SDK service names
- **Preservation**: Existing behavior for exact-match lookups (e.g., "S3" → "S3", "EC2" → "EC2") must remain unchanged
- **`buildOperationAvailabilityIndex`**: The function in `classic-api-availability-engine.ts` that builds a Map from `sdkService → operationName → Set<availableRegions>`
- **`computeResourceAvailability`**: The function that looks up a service in the index to determine if all required operations are available in a region
- **`getMissingOperations`**: The function that returns which required operations are unavailable for a service in a region
- **`buildAvailabilityTree`**: The function that constructs the three-level tree (resource → service → operation) using the index
- **`fromApiServices`**: The mapper that creates `ApiAvailability[]` rows from raw API data; parent SDK_SERVICE rows have `name = sdkServiceFullName` and `sdkServiceName = sdkServiceName`

## Bug Details

### Bug Condition

The bug manifests when the Terraform mapping data contains a service name (derived from the provider's directory structure, e.g., "organizations") that does not exactly match the key stored in the operation availability index. Two sub-conditions cause this:

1. **Parent fallback uses wrong field**: When an operation row lacks `sdkServiceName` and the index builder falls back to the parent row, it uses `parent.name` (which is `sdkServiceFullName`, e.g., "AWS Organizations") instead of `parent.sdkServiceName` (e.g., "Organizations").

2. **Case-sensitive lookup**: Even when the correct SDK name is used as the index key, the Terraform mapping uses lowercase directory names (e.g., "organizations", "dynamodb") while the index stores PascalCase SDK names (e.g., "Organizations", "DynamoDB"). The `Map.get()` call is case-sensitive, so lookups fail.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { terraformServiceName: string, indexKey: string }
  OUTPUT: boolean

  // Sub-condition (a): parent fallback used wrong field
  LET parentFallbackWrong = (indexKey was derived from parent.name instead of parent.sdkServiceName)

  // Sub-condition (b): case mismatch
  LET caseMismatch = (terraformServiceName != indexKey)
                     AND (lowercase(terraformServiceName) == lowercase(indexKey))

  RETURN parentFallbackWrong OR caseMismatch
END FUNCTION
```

### Examples

- **Organizations**: Terraform mapping has `sdkService: "organizations"` (lowercase directory name). Index has key `"AWS Organizations"` (from parent.name fallback). Lookup fails → shows "Not Available". Expected: should match and show "Available".
- **DynamoDB**: Terraform mapping has `sdkService: "dynamodb"`. Index has key `"DynamoDB"` (correct SDK name but wrong case). Lookup fails → shows "Not Available". Expected: case-insensitive match should succeed.
- **CloudWatch**: Terraform mapping has `sdkService: "cloudwatch"`. Index has key `"CloudWatch"`. Same case mismatch pattern.
- **S3** (not affected): Terraform mapping has `sdkService: "S3"`. Index has key `"S3"`. Exact match works correctly today.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- Services where the Terraform mapping name exactly matches the index key in both value and case (e.g., "S3" → "S3", "EC2" → "EC2") must continue to resolve correctly
- The three-level tree structure (resource → service → operation) must remain unchanged
- The AND-logic for resource availability (all required ops must be available) must remain unchanged
- The `getMissingOperations` function must continue to return correctly formatted `service:operation` strings
- Operation-level availability data (which regions an operation is available in) must remain unchanged
- Resources with genuinely unavailable operations must continue to show "Not Available"

**Scope:**
All inputs where the Terraform mapping service name already exactly matches the index key (same value, same case) should be completely unaffected by this fix. This includes:

- Services with short, all-caps names like "S3", "EC2", "IAM"
- Any service where `sdkServiceName` is set directly on the operation row (no parent fallback needed)
- All non-service-lookup logic (tree building structure, region set computation, availability status mapping)

## Hypothesized Root Cause

Based on the bug description and code analysis, the root causes are:

1. **Incorrect Parent Fallback Field** (`buildOperationAvailabilityIndex`, line ~40): When `row.sdkServiceName` is undefined and the code falls back to the parent row, it uses `parent.name`. However, the `fromApiServices` mapper sets `name = svc.sdkServiceFullName` (e.g., "AWS Organizations") on parent SDK_SERVICE rows, while `sdkServiceName = svc.sdkServiceName` (e.g., "Organizations") is the correct field. The fallback should use `parent.sdkServiceName`.

2. **Case-Sensitive Map Lookup** (`computeResourceAvailability`, `getMissingOperations`, `buildAvailabilityTree`): The Terraform overlay handler derives service names from the provider's directory structure (e.g., `internal/service/organizations/`), producing lowercase names. The API data uses PascalCase SDK names. Since JavaScript `Map.get()` is case-sensitive, `index.get("organizations")` returns `undefined` even when the index contains `"Organizations"`.

3. **No Normalization at Index Build Time**: The index is built with whatever case the source data provides, and lookups use whatever case the Terraform mapping provides. There is no normalization step on either side.

## Correctness Properties

Property 1: Bug Condition - Case-Insensitive Service Name Matching

_For any_ input where the Terraform mapping service name differs from the index key only in case (i.e., `lowercase(terraformServiceName) == lowercase(indexKey)`), the fixed `computeResourceAvailability` function SHALL find the service in the index and return the correct availability status based on the actual operation data, rather than returning "Not Available" due to a failed lookup.

**Validates: Requirements 2.2, 2.3**

Property 2: Bug Condition - Parent Fallback Uses sdkServiceName

_For any_ operation row where `sdkServiceName` is not set directly and the parent row is used as fallback, the fixed `buildOperationAvailabilityIndex` function SHALL use `parent.sdkServiceName` as the index key, producing the SDK service name (e.g., "Organizations") rather than the full display name (e.g., "AWS Organizations").

**Validates: Requirements 2.1**

Property 3: Preservation - Exact Match Behavior Unchanged

_For any_ input where the Terraform mapping service name exactly matches the index key in both value and case (e.g., "S3" matches "S3"), the fixed functions SHALL produce exactly the same results as the original functions, preserving all existing correct behavior for services that already match.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `source/website/app/hooks/classic-api-availability-engine.ts`

**Function**: `buildOperationAvailabilityIndex`

**Specific Changes**:

1. **Fix parent fallback field**: Change `serviceName = parent.name` to `serviceName = parent.sdkServiceName ?? parent.name`. This ensures the SDK service name is used when available, with `name` as a last-resort fallback.

2. **Normalize index keys to lowercase**: When inserting into the index map, normalize the service name key to lowercase: `const normalizedService = serviceName.toLowerCase()`. Use `normalizedService` as the map key instead of `serviceName`.

**Function**: `computeResourceAvailability`

**Specific Changes**: 3. **Normalize lookup key to lowercase**: Before calling `operationAvailabilityIndex.get(sdkService)`, normalize: `const normalizedService = sdkService.toLowerCase()`. Use `normalizedService` for the map lookup.

**Function**: `getMissingOperations`

**Specific Changes**: 4. **Normalize lookup key to lowercase**: Same pattern as `computeResourceAvailability` — normalize `sdkService` to lowercase before the index lookup. Keep the original `sdkService` value for the formatted output string (`${sdkService}:${operation}`).

**Function**: `buildAvailabilityTree`

**Specific Changes**: 5. **Normalize lookup key to lowercase**: When looking up `resource.sdkService` in the index (for operation availability), normalize to lowercase: `const serviceMap = index.get(resource.sdkService.toLowerCase())`.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that build an operation availability index from API rows where operation rows lack `sdkServiceName` (relying on parent fallback), then attempt lookups using lowercase service names. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:

1. **Parent Fallback Test**: Create API rows where operations have no `sdkServiceName` and parent has `name: "AWS Organizations"` and `sdkServiceName: "Organizations"`. Verify index key is "Organizations" not "AWS Organizations" (will fail on unfixed code).
2. **Case Mismatch Test**: Build index with SDK name "Organizations", then call `computeResourceAvailability` with `sdkService: "organizations"`. Verify it returns "Available" (will fail on unfixed code).
3. **Mixed Case Services Test**: Build index with "DynamoDB", "CloudWatch", "ElastiCache". Look up with "dynamodb", "cloudwatch", "elasticache" (will fail on unfixed code).
4. **End-to-End Tree Test**: Build availability tree with mapping that uses lowercase service names and API data with PascalCase names. Verify resource rows show correct availability (will fail on unfixed code).

**Expected Counterexamples**:

- `computeResourceAvailability(["DeleteResourcePolicy"], "organizations", "us-east-1", index)` returns "Not Available" when it should return "Available"
- Index contains key "AWS Organizations" instead of "Organizations" due to parent fallback bug
- Possible causes confirmed: incorrect parent field reference, case-sensitive Map.get()

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  index ← buildOperationAvailabilityIndex'(apiRows)
  result ← computeResourceAvailability'(requiredApis, input.terraformServiceName, region, index)
  ASSERT result = computeResourceAvailability'(requiredApis, input.indexKey, region, index)
  // i.e., lowercase lookup finds same data as PascalCase lookup
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT buildOperationAvailabilityIndex(input) ≡ buildOperationAvailabilityIndex'(input)
  ASSERT computeResourceAvailability(input) = computeResourceAvailability'(input)
  ASSERT getMissingOperations(input) = getMissingOperations'(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many service name and operation combinations automatically
- It catches edge cases where normalization might accidentally merge distinct services
- It provides strong guarantees that exact-match behavior is unchanged

**Test Plan**: Observe behavior on UNFIXED code first for exact-match services (S3, EC2, IAM), then write property-based tests capturing that behavior.

**Test Cases**:

1. **Exact Match Preservation**: Verify that services with matching case (e.g., "S3" → "S3") continue to resolve correctly after the fix
2. **Tree Structure Preservation**: Verify the three-level tree structure is unchanged for all inputs
3. **Missing Operations Preservation**: Verify `getMissingOperations` returns the same results for exact-match services
4. **AND-Logic Preservation**: Verify that resource availability still requires ALL operations to be available

### Unit Tests

- Test `buildOperationAvailabilityIndex` with parent fallback scenarios (operations without `sdkServiceName`)
- Test `computeResourceAvailability` with case-mismatched service names
- Test `getMissingOperations` with case-mismatched service names
- Test `buildAvailabilityTree` with lowercase Terraform mapping names and PascalCase API data
- Test edge cases: empty service name, service name with special characters, single-character names

### Property-Based Tests

- Generate random service names in various cases and verify case-insensitive lookup correctness
- Generate random operation sets and verify preservation of AND-logic availability computation
- Generate random tree configurations and verify structural correctness is maintained
- Test that two services differing only in case are treated as the same service (not accidentally split)

### Integration Tests

- Test full flow from `fromApiServices` mapper output through `buildOperationAvailabilityIndex` to `computeResourceAvailability` with realistic Organizations/DynamoDB data
- Test `buildAvailabilityTree` with a `ClassicApiMappingData` containing lowercase service names against API rows with PascalCase names
- Test that the Terraform AWS tab would show correct availability for previously broken services
