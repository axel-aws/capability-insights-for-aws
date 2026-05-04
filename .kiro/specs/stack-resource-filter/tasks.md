# Implementation Plan: Stack Resource Filter

## Overview

Add the ability to filter the CloudFormation resources tab by a running CloudFormation stack. Implementation spans infrastructure (CloudFormation VPC endpoint + IAM), backend (two new API routes with CloudFormation client and resource parser), and frontend (stack selector dropdown with client-side filtering logic). The design specifies 9 components across these layers.

## Tasks

- [x] 1. Add shared types for stack resource data
  - [x] 1.1 Create `source/shared/types/capability/stack.ts` with `ResourceTypePair`, `PropertyMatch`, `StackResourcesResponse`, and `ListStacksResponse` interfaces
    - Define `ResourceTypePair` with `serviceName` and `resourceTypeName` fields
    - Define `PropertyMatch` with `serviceName`, `resourceTypeName`, `propertyName`, and `value` fields
    - Define `StackResourcesResponse` with `resourceTypePairs`, `propertyMatches`, and optional `warning` fields
    - Define `ListStacksResponse` with `stacks` string array
    - _Requirements: 2.1, 7.2_

- [x] 2. Implement CloudFormation service client
  - [x] 2.1 Create `source/lambda/services/cloudformation-client.ts`
    - Implement `CloudFormationServiceClient` class following the pattern of `s3-client.ts` and `lambda-client.ts`
    - Implement `listActiveStacks()` that paginates through `ListStacks` API filtering by `ACTIVE_STACK_STATUSES` (`CREATE_COMPLETE`, `UPDATE_COMPLETE`, `UPDATE_ROLLBACK_COMPLETE`, `IMPORT_COMPLETE`) and returns stack names
    - Implement `listStackResourceTypes(stackName)` that paginates through `ListStackResources` and returns resource type strings
    - Implement `getTemplate(stackName)` that calls `GetTemplate` and returns the template body string
    - Add `@aws-sdk/client-cloudformation` as a devDependency in `source/lambda/package.json`
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3_

  - [x] 2.2 Write unit tests for CloudFormation service client
    - Create `source/lambda/services/cloudformation-client.test.ts`
    - Mock AWS SDK CloudFormation client
    - Test pagination aggregation for `listActiveStacks` and `listStackResourceTypes`
    - Test `getTemplate` success and error cases
    - Test that only allowed statuses are included in `listActiveStacks`
    - _Requirements: 1.1, 1.2, 2.2_

- [x] 3. Implement resource type parser and property mapping utilities
  - [x] 3.1 Create `source/lambda/util/cfn-resource-parser.ts`
    - Implement `parseResourceType(fullType)` that splits `AWS::EC2::Instance` into `{ serviceName: "EC2", resourceTypeName: "Instance" }` and returns `null` for invalid formats
    - Implement `deduplicateResourceTypePairs(pairs)` that removes duplicates by `serviceName+resourceTypeName`
    - Implement `buildPropertyMapping(cfnResources)` that builds a mapping of resource types to property names from `CfnResource[]` data, including only properties with non-empty `resourceConfigurations`
    - Implement `isIntrinsicFunction(value)` that returns `true` for non-null objects (not strings, numbers, booleans, or arrays)
    - Implement `extractPropertyValues(templateBody, propertyMapping)` that parses a CloudFormation template JSON, navigates to `Resources`, and extracts plain string property values matching the property mapping
    - Import `CfnResource` type from `@capability-insights/shared`
    - Import `ResourceTypePair` and `PropertyMatch` from shared types
    - _Requirements: 2.1, 2.3_

  - [x] 3.2 Write property test: Resource type parsing round-trip (Property 2)
    - **Property 2: Resource type parsing round-trip**
    - Generate random `AWS::{alphanumeric}::{alphanumeric}` strings using fast-check
    - Verify that parsing produces the correct `serviceName` and `resourceTypeName`
    - Verify round-trip: `"AWS::" + pair.serviceName + "::" + pair.resourceTypeName === originalString`
    - **Validates: Requirements 2.1**

  - [x] 3.3 Write property test: Resource type pair deduplication (Property 3)
    - **Property 3: Resource type pair deduplication**
    - Generate random arrays of `ResourceTypePair` with controlled duplicates using fast-check
    - Verify no two output elements share the same `serviceName` and `resourceTypeName`
    - Verify every unique pair from input appears exactly once in output
    - **Validates: Requirements 2.1**

  - [x] 3.4 Write property test: Dynamic property mapping correctness (Property 4)
    - **Property 4: Dynamic property mapping correctness**
    - Generate random `CfnResource[]` arrays with varying `resourceProperties` using fast-check
    - Verify mapping contains an entry for a resource type iff it has at least one property with non-empty `resourceConfigurations`
    - Verify mapped property names exactly match the `resourcePropertyName` values
    - **Validates: Requirements 2.3**

  - [x] 3.5 Write property test: Intrinsic function detection (Property 5)
    - **Property 5: Intrinsic function detection**
    - Generate random values: strings, numbers, booleans, arrays, objects with `Ref`/`Fn::*` keys, plain objects using fast-check
    - Verify `isIntrinsicFunction` returns `true` iff value is a non-null, non-array object
    - Verify plain strings always return `false`
    - **Validates: Requirements 2.3**

  - [x] 3.6 Write unit tests for cfn-resource-parser
    - Create `source/lambda/util/cfn-resource-parser.test.ts`
    - Test `parseResourceType` with valid types (`AWS::EC2::Instance`, `AWS::S3::Bucket`), invalid formats, and edge cases
    - Test `deduplicateResourceTypePairs` with duplicates and empty arrays
    - Test `buildPropertyMapping` with real-world-like `CfnResource` data
    - Test `isIntrinsicFunction` with `{ Ref: "..." }`, `{ "Fn::If": [...] }`, plain strings, numbers
    - Test `extractPropertyValues` with a sample CloudFormation template containing `AWS::EC2::Instance` with `InstanceType: "t3.micro"` and intrinsic function values
    - _Requirements: 2.1, 2.3_

- [x] 4. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement API routes for stack listing and resource retrieval
  - [x] 5.1 Create `source/lambda/routes/list-stacks-route.ts`
    - Implement `listStacksRoute` handler for `GET /stacks`
    - Call `cloudFormationClient.listActiveStacks()` and return `{ stacks: [...] }`
    - Handle errors and return appropriate error responses using `ErrorResponse`
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 5.2 Create `source/lambda/routes/stack-resources-route.ts`
    - Implement `stackResourcesRoute` handler for `GET /stacks/{stackName}/resources`
    - Accept `stackName` from path parameters
    - Validate `stackName` is present, return 400 if missing
    - Call `listStackResourceTypes` → parse each type with `parseResourceType` → deduplicate
    - Read `cfn_resources.json` from S3 using `WEBSITE_BUCKET_NAME` env var → `buildPropertyMapping`
    - Call `getTemplate` → `extractPropertyValues` with the property mapping
    - Handle `GetTemplate` failure gracefully: return resource type pairs with empty `propertyMatches` and a `warning` field
    - Handle `cfn_resources.json` read failure gracefully: return resource type pairs with empty `propertyMatches` and a `warning` field
    - Detect stack-not-found errors (`ValidationError` with "does not exist") and return 404
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 5.3 Write unit tests for list-stacks-route
    - Create `source/lambda/routes/list-stacks-route.test.ts`
    - Mock CloudFormation client
    - Test successful response with stack names
    - Test error handling when `listActiveStacks` fails
    - _Requirements: 1.1, 1.3_

  - [x] 5.4 Write unit tests for stack-resources-route
    - Create `source/lambda/routes/stack-resources-route.test.ts`
    - Mock CloudFormation client and S3 client
    - Test successful response with resource type pairs and property matches
    - Test 404 response for missing stacks
    - Test graceful degradation when `GetTemplate` fails (response includes `warning`, empty `propertyMatches`)
    - Test graceful degradation when `cfn_resources.json` read fails
    - Test 400 response for missing `stackName`
    - _Requirements: 2.1, 2.4, 2.5, 2.6_

  - [x] 5.5 Write property test: Stack status filtering (Property 1)
    - **Property 1: Stack status filtering preserves only allowed statuses**
    - Generate random arrays of `{ stackName, status }` with statuses from a superset of allowed values using fast-check
    - Verify filtering returns only stacks with allowed statuses
    - Verify no stack with an allowed status is excluded
    - **Validates: Requirements 1.1**

- [x] 6. Enhance API Lambda router for parameterized routes
  - [x] 6.1 Update `source/lambda/api-lambda-main.ts` to support parameterized routes
    - Add `ParameterizedRoute` interface with `pattern`, `paramNames`, and `handler`
    - Implement `registerParameterizedRoute(method, pathTemplate, handler)` that converts `:param` segments to regex capture groups
    - Update the main handler to first check exact matches (existing behavior), then fall back to parameterized route matching
    - Pass matched parameters as a `Record<string, string>` to the parameterized route handler
    - Register `GET /stacks` as an exact route with `listStacksRoute`
    - Register `GET /stacks/:stackName/resources` as a parameterized route with `stackResourcesRoute`
    - Add `STACK_NAME` to `EnvironmentKey` in `source/lambda/constants/environment.ts` if needed, or pass the bucket name via existing `WEBSITE_BUCKET_NAME`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 6.2 Write unit tests for parameterized route matching
    - Test that exact routes still work as before
    - Test that parameterized routes correctly extract path parameters
    - Test that non-matching paths return 404
    - Test that OPTIONS requests return CORS headers
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 7. Checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Add infrastructure for CloudFormation API access
  - [x] 8.1 Update `source/constructs/lib/stacks/capability-insights-stack.ts`
    - Add a CloudFormation VPC endpoint (`com.amazonaws.${AWS::Region}.cloudformation`) in the private subnet, using the same security group as the existing Lambda VPC endpoint
    - Add IAM policy to the API Lambda role for `cloudformation:ListStacks`, `cloudformation:ListStackResources`, and `cloudformation:GetTemplate`
    - Add IAM policy to the API Lambda role for `s3:GetObject` on the website bucket's `data/*` path
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 8.2 Update CDK snapshot tests
    - Run `npm run test:update-snapshot --workspace=source/constructs` to update the snapshot
    - Verify the snapshot includes the new CloudFormation VPC endpoint, IAM policies for CloudFormation actions, and S3 read permission
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 9. Implement frontend stack filter logic
  - [x] 9.1 Create `source/website/app/utils/stack-filter.ts`
    - Implement `filterByStackResources(input)` that takes `{ rows, resourceTypePairs, propertyMatches }` and returns filtered `CfnAvailability[]`
    - Build a `Set<string>` of `"serviceName::resourceTypeName"` from `resourceTypePairs`
    - Build a `Map<string, PropertyMatch[]>` keyed by `"serviceName::resourceTypeName"` from `propertyMatches`
    - Filter service rows: include if any child resource type is in the set
    - Filter resource type rows: include if `serviceName::name` is in the set
    - Filter property rows: include if parent resource type is in the set
    - Filter configuration rows: if property matches exist for the resource type, include only matching values; otherwise include all
    - Import types from `@capability-insights/shared`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 9.2 Write property test: Hierarchical row filtering preserves structure (Property 6)
    - **Property 6: Hierarchical row filtering preserves structure**
    - Generate random `CfnAvailability` hierarchies and `ResourceTypePair` filter sets using fast-check
    - Verify every matching resource type row is included
    - Verify parent service rows are included for every included resource type
    - Verify no non-matching resource type rows are included
    - Verify no orphan service rows (whose children are all excluded) are included
    - **Validates: Requirements 4.1, 4.2**

  - [x] 9.3 Write property test: Configuration row filtering with property values (Property 7)
    - **Property 7: Configuration row filtering with property values**
    - Generate random `CfnAvailability` rows with property/config children and `PropertyMatch` sets using fast-check
    - Verify that when property matches exist, only matching configuration rows are included
    - Verify that when no property matches exist, all child rows are included
    - **Validates: Requirements 4.3, 4.4**

  - [x] 9.4 Write unit tests for stack-filter
    - Create `source/website/app/utils/stack-filter.test.ts`
    - Test filtering with a realistic hierarchy (EC2 service → Instance resource type → InstanceType property → t3.micro config)
    - Test that parent service rows are preserved
    - Test that unmatched resource types are excluded
    - Test configuration narrowing when property matches are present
    - Test fallback to all children when no property matches exist
    - Test empty inputs and edge cases
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 10. Extend website API client with stack methods
  - [x] 10.1 Update `source/website/app/clients/capability-insights-client.ts`
    - Add `listStacks()` method that calls `GET /stacks` via the API base URL and returns `string[]`
    - Add `getStackResourceTypes(stackName)` method that calls `GET /stacks/{stackName}/resources` and returns `StackResourcesResponse`
    - Handle error responses by throwing an error with the message from the response body
    - Import `StackResourcesResponse` from shared types
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 11. Implement Stack Selector UI component
  - [x] 11.1 Create `source/website/app/components/availability/stack-selector.tsx`
    - Implement `StackSelector` component using Cloudscape `Select` with `filteringType="auto"` for built-in substring search
    - Accept `onStackSelected` callback and `selectedStack` props
    - On mount, call `capabilityInsightsClient.listStacks()` to populate options
    - Show loading state while API call is in progress
    - Show error message if API call fails
    - Include placeholder option ("Filter by CloudFormation stack")
    - Support clearing the selection to return to unfiltered view
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 12. Integrate stack filter into CloudFormation resources tab
  - [x] 12.1 Update `source/website/app/pages/capability-by-region.tsx`
    - Add state for `selectedStack` (string | null), `stackResourceData` (StackResourcesResponse | null), and `stackFilterLoading` (boolean)
    - Render `StackSelector` above the CloudFormation resources tab content
    - When a stack is selected, call `getStackResourceTypes()` and store the result
    - When a stack is cleared, reset `stackResourceData` to null
    - Apply `filterByStackResources()` to `cfnRows` when `stackResourceData` is present
    - Pass filtered rows to the `AvailabilityTable` component for the CFN tab
    - Show loading indicator while `getStackResourceTypes` is in progress
    - Display flash bar warning if response includes a `warning` field
    - Display flash bar error if `getStackResourceTypes` fails, and clear the stack selection
    - Ensure the existing `PropertyFilter` continues to work on the stack-filtered rows
    - _Requirements: 3.1, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 12.2 Write property test: Stack filter and PropertyFilter composition (Property 8)
    - **Property 8: Stack filter and PropertyFilter composition**
    - Generate random rows, stack filters, and PropertyFilter queries using fast-check
    - Verify that applying both filters simultaneously produces the same result as applying them in either order
    - **Validates: Requirements 4.7**

- [x] 13. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Rewrite `createFilteringFunction` with recursive evaluate pattern (Requirement 8)
  - [x] 14.1 Rewrite `createFilteringFunction` in `source/website/app/components/availability/availability-table-properties.tsx`
    - Import `PropertyFilterTokenGroup` from `@cloudscape-design/collection-hooks`
    - Add `isTokenGroup` type guard that detects `PropertyFilterTokenGroup` by checking for the `operation` key
    - Replace the flat `matchesTokens` logic with a recursive `evaluate` function that handles both `PropertyFilterToken` and `PropertyFilterTokenGroup`
    - For `"or"` groups: return `true` if at least one child evaluates to `true` (empty `"or"` group returns `false`)
    - For `"and"` groups: return `true` only if every child evaluates to `true` (empty `"and"` group returns `true`)
    - Construct a root `PropertyFilterTokenGroup` from `query.operation` and `query.tokenGroups ?? query.tokens`
    - Preserve region availability lookups: keys prefixed with `region:` resolve via `item.regionalAvailability[regionCode]`
    - Preserve parent-chain walking for known property keys (`name`, `regionalAvailabilityType`)
    - Add free-text token matching: tokens without `propertyKey` match against `name` and `regionalAvailabilityType` using the token's operator; negation operators require all properties to match
    - Fix `matchedIds` accumulation bug: clear `matchedIds` when `query` reference changes, and only add items that pass the full recursive `evaluate` — not partial matches
    - Preserve parent-to-child inheritance: after `evaluate`, walk the parent chain and include the item if any ancestor is in `matchedIds`
    - Keep the function signature as `createFilteringFunction(items: RegionalAvailability[])` for now (stack params added in task 16)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 14.2 Write unit tests for the rewritten filtering function
    - Create `source/website/app/components/availability/availability-table-properties.test.ts`
    - Test OR queries: `region:us-gov-west-1 = Available OR region:us-gov-east-1 = Available` returns rows matching either condition
    - Test AND queries: `region:us-east-1 = Available AND Name : EC2` returns rows matching both conditions
    - Test nested token groups: AND within OR, OR within AND at multiple nesting depths
    - Test region availability lookups with `region:` prefix resolve correctly
    - Test parent-chain inheritance: child rows inherit `name` and `regionalAvailabilityType` from ancestors
    - Test parent-to-child inheritance: when a parent row matches the query, its children are included
    - Test that parent-chain inheritance respects the full boolean query (child not included if ancestor only partially matches)
    - Test free-text tokens match against all filtering properties (`name`, `regionalAvailabilityType`)
    - Test free-text negation operators (`!:`, `!=`) require none of the properties to match
    - Test empty token groups (empty AND = match all, empty OR = match none)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 14.3 Write property test: Recursive boolean evaluation of token groups (Property 9)
    - **Property 9: Recursive boolean evaluation of token groups**
    - Generate random `PropertyFilterTokenGroup` trees (depth 1–3) with mixed `"and"` and `"or"` operations using fast-check
    - Generate random `RegionalAvailability` items with `regionalAvailability` maps
    - Verify `"or"` groups return `true` iff at least one child evaluates to `true`
    - Verify `"and"` groups return `true` iff every child evaluates to `true`
    - Use at least 100 iterations
    - **Validates: Requirements 8.1, 8.2, 8.3**

  - [x] 14.4 Write property test: Value resolution correctness (Property 10)
    - **Property 10: Value resolution correctness for region and property keys**
    - Generate random `RegionalAvailability` items with `regionalAvailability` maps and parent-child hierarchies using fast-check
    - Verify `region:` prefixed keys resolve to `item.regionalAvailability[regionCode]`
    - Verify known property keys (`name`, `regionalAvailabilityType`) resolve by walking the parent chain
    - Use at least 100 iterations
    - **Validates: Requirements 8.4, 8.5**

  - [x] 14.5 Write property test: Parent-chain inheritance respects full boolean query (Property 11)
    - **Property 11: Parent-chain inheritance respects full boolean query**
    - Generate random `RegionalAvailability` hierarchies and compound PropertyFilter queries using fast-check
    - Verify a child row is included via inheritance iff at least one ancestor passes the full recursive `evaluate`
    - Verify a child is NOT included merely because an ancestor was included for a different partial match
    - Use at least 100 iterations
    - **Validates: Requirements 8.6, 8.7**

  - [x] 14.6 Write property test: Free-text token matching (Property 12)
    - **Property 12: Free-text token matching against all filtering properties**
    - Generate random `RegionalAvailability` items and free-text tokens (no `propertyKey`) with various operators using fast-check
    - Verify the token matches if the value is found in at least one filtering property (`name`, `regionalAvailabilityType`)
    - Verify negation operators match only if none of the filtering properties match
    - Use at least 100 iterations
    - **Validates: Requirements 8.8**

  - [x] 14.7 Write property test: Cloudscape equivalence for standard tokens (Property 13)
    - **Property 13: Round-trip equivalence with Cloudscape default for standard tokens**
    - Generate random PropertyFilter queries with non-region, non-stack property tokens and flat `RegionalAvailability` items using fast-check
    - Compare the custom `evaluate` result against the Cloudscape `defaultFilteringFunction` result for the same query and item
    - Verify they produce the same boolean result
    - Use at least 100 iterations
    - **Validates: Requirements 8.9**

- [x] 15. Checkpoint — OR logic fix verified
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Integrate Stack filter as a PropertyFilter property (Requirement 9)
  - [x] 16.1 Add "Stack" filtering property to `createFilteringProperties`
    - Update `createFilteringProperties` in `source/website/app/components/availability/availability-table-properties.tsx` to accept an optional `options?: { includeStackProperty?: boolean }` parameter
    - When `includeStackProperty` is `true`, add a `{ key: 'stack', propertyLabel: 'Stack', groupValuesLabel: 'Stack values', operators: ['=', '!='], group: 'properties' }` entry to the returned array
    - _Requirements: 9.1, 9.7_

  - [x] 16.2 Add `itemMatchesStack` helper and stack token evaluation to the filtering function
    - Add `itemMatchesStack(item, data, byId)` function in `availability-table-properties.tsx` that determines if a `RegionalAvailability` item matches a `StackResourcesResponse`
    - Handle each `RegionalAvailabilityType`: SERVICE (has matching child resource type), RESOURCE_TYPE (in resource type set), PROPERTY (parent resource type matches), CONFIGURATION (resource type matches + property value narrowing when available)
    - Add `evaluateStackToken(item, token)` that looks up the stack name in `stackResourceCache`, calls `onStackDataNeeded` if not cached, and delegates to `itemMatchesStack`; supports `=` (includes) and `!=` (excludes) operators
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.11_

  - [x] 16.3 Update `createFilteringFunction` signature to accept stack parameters
    - Change `createFilteringFunction` signature to `createFilteringFunction(items, stackResourceCache?, onStackDataNeeded?)`
    - `stackResourceCache: Map<string, StackResourcesResponse>` — cache of stack name → resource data
    - `onStackDataNeeded?: (stackName: string) => void` — callback to trigger fetching when a stack token is encountered but not cached
    - Wire `evaluateStackToken` into the `evaluateToken` function for tokens with `propertyKey === 'stack'`
    - Update the call site in `availability-table.tsx` to pass the new parameters
    - _Requirements: 9.3, 9.8, 9.9_

  - [x] 16.4 Update `AvailabilityTable` to manage stack cache, `onLoadItems`, and `includeStackProperty` prop
    - Add `includeStackProperty?: boolean` to `AvailabilityTableProps`
    - Pass `includeStackProperty` to `createFilteringProperties`
    - Add `stackResourceCache` via `useRef<Map<string, StackResourcesResponse>>`
    - Add `stackLoadingNames` state (`Set<string>`) to track in-flight fetches
    - Add `stackError` state for error display via `Flashbar`
    - Pass `stackResourceCache.current` and an `onStackDataNeeded` callback to `createFilteringFunction`
    - The `onStackDataNeeded` callback: checks cache/loading, fetches via `capabilityInsightsClient.getStackResourceTypes`, stores result in cache, triggers re-render; on error, stores empty response and sets `stackError`
    - Add `onLoadItems` handler on the PropertyFilter that calls `capabilityInsightsClient.listStacks()` when the user types in the Stack property value field, and populates filtering options
    - Display `Flashbar` for stack loading errors when `stackError` is set
    - _Requirements: 9.2, 9.3, 9.8, 9.9_

  - [x] 16.5 Update `capability-by-region.tsx` to remove StackSelector and pass `includeStackProperty`
    - Remove `StackSelector` component import and rendering
    - Remove `selectedStack`, `stackResourceData`, `stackFilterLoading`, `stackFilterWarning`, `stackFilterError` state variables
    - Remove `handleStackSelected` callback
    - Remove `filteredCfnRows` memo and `filterByStackResources` import
    - Remove `Spinner` import (no longer needed for stack loading)
    - Remove `StackResourcesResponse` type import
    - Remove the `SpaceBetween` wrapper, `Flashbar` for stack warnings/errors, and `Spinner` for stack loading from the CFN tab content
    - Pass `cfnRows` directly to `AvailabilityTable` (instead of `filteredCfnRows`)
    - Add `includeStackProperty` prop to the CFN tab's `AvailabilityTable`
    - _Requirements: 9.10_

  - [x] 16.6 Delete `stack-selector.tsx` and `stack-filter.ts`
    - Delete `source/website/app/components/availability/stack-selector.tsx`
    - Delete `source/website/app/utils/stack-filter.ts`
    - Delete `source/website/app/utils/stack-filter.test.ts` (Properties 6–8 and unit tests move to `availability-table-properties.test.ts`)
    - _Requirements: 9.10_

  - [x] 16.7 Write unit tests for stack integration in the filtering function
    - Add tests to `source/website/app/components/availability/availability-table-properties.test.ts`
    - Test `Stack = MyStack` token with cached data matches correct resource type rows, parent service rows, and configuration rows
    - Test `Stack != MyStack` token excludes the stack's resources
    - Test stack token without cached data triggers `onStackDataNeeded` callback and matches no rows
    - Test stack token with empty cache entry (error case) matches no rows
    - Test combined query: `Stack = MyStack AND region:us-east-1 = Available`
    - Test combined query: `Stack = MyStack OR Name : EC2`
    - Test multiple stack tokens: `Stack = StackA OR Stack = StackB`
    - Test configuration narrowing: when property matches exist, only matching config rows pass the stack token
    - Test fallback: when no property matches exist, all config rows pass the stack token
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.11_

  - [x] 16.8 Write property test: Stack token evaluation with = and != operators (Property 14)
    - **Property 14: Stack token evaluation with = and != operators**
    - Generate random `RegionalAvailability` items and `StackResourcesResponse` data using fast-check
    - Verify `Stack = <name>` returns `true` iff the item matches the stack's resource types (considering hierarchy and property narrowing)
    - Verify `Stack != <name>` returns the complement
    - Use at least 100 iterations
    - **Validates: Requirements 9.3, 9.7**

  - [x] 16.9 Write property test: Stack token hierarchical filtering preserves structure (Property 15)
    - **Property 15: Stack token hierarchical filtering preserves structure**
    - Generate random `RegionalAvailability` hierarchies and `StackResourcesResponse` data using fast-check
    - Verify when a resource type row matches the stack, its parent service row also matches
    - Verify configuration rows match only if their ancestor resource type matches AND (when property matches exist) their name matches a property match value
    - Use at least 100 iterations
    - **Validates: Requirements 9.11**

- [x] 17. Final checkpoint — all Requirements 8 & 9 complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check`
- Unit tests validate specific examples and edge cases
- The project uses TypeScript throughout, with vitest as the test runner
- `fast-check` needs to be added as a devDependency to `source/lambda/package.json` and potentially `source/website/package.json` for property-based tests
- The existing API Gateway `{proxy+}` integration routes all requests to the API Lambda — no new API Gateway resources are needed
- Tasks 1–13 cover Requirements 1–7 (backend, infrastructure, initial frontend) and are complete
- Tasks 14–17 cover Requirements 8 (OR logic fix) and 9 (stack PropertyFilter integration)
- The OR logic fix (task 14) must be completed before the stack integration (task 16) because stack token evaluation depends on the recursive `evaluate` pattern
- Existing property tests in `stack-filter.test.ts` (Properties 6–8) are deleted in task 16.6; their coverage moves to the new `availability-table-properties.test.ts` tests (Properties 14–15 and unit tests in 16.7)
- All new property tests target `source/website/app/components/availability/availability-table-properties.test.ts`
