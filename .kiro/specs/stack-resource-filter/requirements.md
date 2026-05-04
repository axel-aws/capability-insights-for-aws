# Requirements Document

## Introduction

The Stack Resource Filter feature adds the ability to filter the CloudFormation resources tab in the Capability Insights dashboard by a running CloudFormation stack. When a user selects a stack by name, the table narrows to show only the CloudFormation resource types that are actually used in that stack, allowing side-by-side regional availability comparison for just the resources relevant to their deployment.

This feature requires a new backend API route on the API Lambda to call the CloudFormation service (via `ListStacks` and `ListStackResources`), new infrastructure (a VPC endpoint for CloudFormation and IAM permissions), and a new UI control on the CloudFormation resources tab.

Since the initial implementation, two additional changes are needed: (1) fixing a bug in the custom `createFilteringFunction` where OR logic in the PropertyFilter is completely broken because `tokenGroups` nesting is not evaluated recursively, and (2) integrating the stack filter as a first-class filtering property inside the PropertyFilter instead of a separate dropdown, so users can combine stack filtering with region and name filters using AND/OR boolean logic.

## Glossary

- **API_Lambda**: The existing Lambda function (`CapabilityInsightsApiLambda`) that runs in a private subnet and handles API requests from the website via API Gateway.
- **Stack_Filter_API**: A new API route on the API_Lambda that accepts a stack name and returns the set of CloudFormation resource type names used in that stack.
- **Stack_Selector**: A new UI component on the CloudFormation resources tab that lets the user pick a CloudFormation stack by name to filter the table.
- **CFN_Table**: The existing CloudFormation resources availability table rendered by the `AvailabilityTable` component on the CloudFormation resources tab.
- **Resource_Type_Name**: A CloudFormation resource type identifier as returned by the CloudFormation API (e.g., `AWS::S3::Bucket`). This is split into a service name (`S3`) and resource name (`Bucket`) to match the capability data format.
- **Resource_Type_Pair**: A `{serviceName, resourceTypeName}` object derived by splitting a Resource_Type_Name on `::` — e.g., `AWS::S3::Bucket` becomes `{serviceName: "S3", resourceTypeName: "Bucket"}`. This matches the format used in the capability data (`cfn_resources.json`).
- **CfnAvailability_Row**: A row in the flattened CFN availability data structure, containing an `id`, `parentId`, `name`, `regionalAvailabilityType`, and optional `regionalAvailability` map.
- **VPC_Endpoint**: An interface VPC endpoint that allows the API_Lambda in the private subnet to reach an AWS service without internet access.
- **Stack_List_API**: A new API route on the API_Lambda that returns the names of CloudFormation stacks in a given status (e.g., active stacks).
- **Filtering_Function**: The custom `createFilteringFunction` in `availability-table-properties.tsx` that evaluates PropertyFilter queries against `RegionalAvailability` items, handling region availability lookups and parent-chain inheritance.
- **TokenGroup**: A `PropertyFilterTokenGroup` object from Cloudscape's collection hooks that contains an `operation` field (`"and"` or `"or"`) and a nested `tokens` array of `PropertyFilterToken` or further `PropertyFilterTokenGroup` objects, forming a recursive boolean expression tree.
- **Stack_Property**: A filtering property named "Stack" added to the PropertyFilter that allows users to filter rows by CloudFormation stack name as a first-class token in the boolean filter expression.

## Requirements

### Requirement 1: List CloudFormation Stacks

**User Story:** As a dashboard user, I want to see a list of active CloudFormation stacks, so that I can select one to filter the resource table.

#### Acceptance Criteria

1. WHEN the Stack_Selector is opened, THE Stack_List_API SHALL return the names of all CloudFormation stacks with a status of `CREATE_COMPLETE`, `UPDATE_COMPLETE`, `UPDATE_ROLLBACK_COMPLETE`, or `IMPORT_COMPLETE`.
2. THE Stack_List_API SHALL paginate through all results from the CloudFormation `ListStacks` API and return the complete list of matching stack names.
3. IF the CloudFormation `ListStacks` call fails, THEN THE Stack_List_API SHALL return an error response with a descriptive message and an appropriate HTTP status code.
4. THE Stack_List_API SHALL respond within 10 seconds for accounts with up to 500 stacks.

### Requirement 2: Retrieve Resource Types for a Stack

**User Story:** As a dashboard user, I want to retrieve the set of resource types used in a specific stack, so that the table can be filtered to only those types.

#### Acceptance Criteria

1. WHEN a valid stack name is provided, THE Stack_Filter_API SHALL return the deduplicated set of Resource_Type_Pair values derived from the CloudFormation `ListStackResources` API for that stack, by splitting each `ResourceType` (e.g., `AWS::S3::Bucket`) on `::` into `{serviceName, resourceTypeName}` (e.g., `{serviceName: "S3", resourceTypeName: "Bucket"}`).
2. THE Stack_Filter_API SHALL paginate through all results from `ListStackResources` and return the complete set of resource type pairs.
3. THE Stack_Filter_API SHALL also call CloudFormation `GetTemplate` for the stack and extract property values that match configuration properties in the capability data. To determine which properties to extract, THE Stack_Filter_API SHALL read the capability data (`cfn_resources.json`) and build a dynamic mapping of resource types that have `resourceProperties` with `resourceConfigurations`. For each resource in the template whose type matches a mapped resource type, THE Stack_Filter_API SHALL extract the value of each mapped property name if it is a plain string value (not a `Ref`, `Fn::If`, or other CloudFormation intrinsic function). This ensures the matching automatically expands as the capability data source adds new resource type properties over time.
4. IF the specified stack does not exist, THEN THE Stack_Filter_API SHALL return a 404 error response with a descriptive message.
5. IF the `ListStackResources` call fails for a reason other than a missing stack, THEN THE Stack_Filter_API SHALL return an error response with a descriptive message and an appropriate HTTP status code.
6. IF the `GetTemplate` call fails, THE Stack_Filter_API SHALL still return the resource type pairs without property values, and include a warning in the response.
7. THE Stack_Filter_API SHALL respond within 10 seconds for stacks with up to 500 resources.

### Requirement 3: Stack Selector UI Component

**User Story:** As a dashboard user, I want a dropdown on the CloudFormation resources tab where I can search for and select a stack by name, so that I can filter the table to my stack's resources.

#### Acceptance Criteria

1. THE Stack_Selector SHALL appear above the CFN_Table on the CloudFormation resources tab.
2. THE Stack_Selector SHALL display a searchable dropdown populated with stack names returned by the Stack_List_API.
3. WHEN the Stack_Selector is first rendered, THE Stack_Selector SHALL show no stack selected and the CFN_Table SHALL display all resources (unfiltered).
4. THE Stack_Selector SHALL allow the user to type text to filter the list of stack names by substring match.
5. THE Stack_Selector SHALL provide a clear option to deselect the current stack and return to the unfiltered view.
6. WHILE the Stack_List_API request is in progress, THE Stack_Selector SHALL display a loading indicator.
7. IF the Stack_List_API request fails, THEN THE Stack_Selector SHALL display an error message to the user.

### Requirement 4: Client-Side Table Filtering by Stack Resources

**User Story:** As a dashboard user, I want the CloudFormation resources table to show only the resource types from my selected stack, so that I can compare regional availability for just the resources in my deployment.

#### Acceptance Criteria

1. WHEN a stack is selected in the Stack_Selector, THE CFN_Table SHALL display only the CfnAvailability_Row entries whose `serviceName` and `name` fields match a Resource_Type_Pair returned by the Stack_Filter_API (where `serviceName` matches the parent service row's name and `name` matches the resource type row's name).
2. WHEN a stack is selected, THE CFN_Table SHALL also display the parent service rows for any matching resource type rows, preserving the hierarchical table structure.
3. WHEN a stack is selected and the Stack_Filter_API response includes property values for a resource type, THE CFN_Table SHALL only display the configuration rows that match the values in use by the stack (e.g., if the stack uses `InstanceType: "t3.micro"`, only the `t3.micro` configuration row SHALL be shown, not all 1,263 instance types). The parent property row SHALL also be shown.
4. WHEN a stack is selected and the Stack_Filter_API response does NOT include property values for a resource type (e.g., `GetTemplate` failed or the property value is an intrinsic function), THE CFN_Table SHALL display all child rows (properties and configurations) for that resource type.
5. WHEN the stack selection is cleared, THE CFN_Table SHALL return to displaying all CfnAvailability_Row entries.
6. WHILE the Stack_Filter_API request is in progress, THE CFN_Table SHALL display a loading indicator.
7. THE stack filter SHALL work in combination with the existing PropertyFilter controls, applying both filters simultaneously.

### Requirement 5: Infrastructure for CloudFormation API Access

**User Story:** As a platform operator, I want the API Lambda to have network and IAM access to the CloudFormation service, so that the stack filter feature can retrieve stack and resource data.

#### Acceptance Criteria

1. THE CapabilityInsightsStack SHALL create a VPC_Endpoint for the CloudFormation service (`com.amazonaws.{region}.cloudformation`) in the private subnet where the API_Lambda runs.
2. THE API_Lambda IAM role SHALL include permissions for `cloudformation:ListStacks`, `cloudformation:ListStackResources`, and `cloudformation:GetTemplate`.
3. THE VPC_Endpoint for CloudFormation SHALL use the same security group configuration as the existing Lambda VPC endpoint.
4. THE IAM permissions for CloudFormation SHALL be scoped to the `ListStacks`, `ListStackResources`, and `GetTemplate` actions only, following the principle of least privilege.
5. THE API_Lambda IAM role SHALL include `s3:GetObject` permission on the website bucket's `data/*` path, so it can read the capability data (`cfn_resources.json`) to build the dynamic property mapping.

### Requirement 6: API Route Registration

**User Story:** As a developer, I want the new stack-related API routes registered in the API Lambda router, so that the website can call them.

#### Acceptance Criteria

1. THE API_Lambda SHALL register a `GET /stacks` route that invokes the Stack_List_API handler.
2. THE API_Lambda SHALL register a `GET /stacks/{stackName}/resources` route that invokes the Stack_Filter_API handler.
3. THE API_Lambda router SHALL extract the `stackName` path parameter from the request and pass it to the Stack_Filter_API handler.
4. WHEN an OPTIONS request is received for either stack route, THE API_Lambda SHALL return appropriate CORS headers.

### Requirement 7: Website API Client Extension

**User Story:** As a developer, I want the website API client to have methods for calling the stack APIs, so that UI components can fetch stack data.

#### Acceptance Criteria

1. THE CapabilityInsightsClient SHALL expose a `listStacks()` method that calls `GET /stacks` and returns an array of stack name strings.
2. THE CapabilityInsightsClient SHALL expose a `getStackResourceTypes(stackName)` method that calls `GET /stacks/{stackName}/resources` and returns an object containing an array of Resource_Type_Pair objects (`{serviceName, resourceTypeName}`) and an optional array of property matches (`{serviceName, resourceTypeName, propertyName, value}`).
3. IF the API response indicates an error, THEN THE CapabilityInsightsClient SHALL throw an error with the message from the response body.

### Requirement 8: Fix PropertyFilter OR Logic in Custom Filtering Function

**User Story:** As a dashboard user, I want OR filter operations to work correctly (e.g., `us-gov-west-1 = Available OR us-gov-east-1 = Available`), so that I can find rows matching any of my conditions instead of all of them.

#### Acceptance Criteria

1. WHEN the PropertyFilter query contains TokenGroup objects with an `operation` of `"or"`, THE Filtering_Function SHALL return a row as matching if the row satisfies at least one token or nested group within that TokenGroup.
2. WHEN the PropertyFilter query contains TokenGroup objects with an `operation` of `"and"`, THE Filtering_Function SHALL return a row as matching only if the row satisfies every token and nested group within that TokenGroup.
3. WHEN the PropertyFilter query contains nested TokenGroup objects (groups within groups), THE Filtering_Function SHALL recursively evaluate each level, respecting the `operation` field at every nesting depth.
4. THE Filtering_Function SHALL continue to resolve region availability values for property keys prefixed with `region:` by looking up the region code in the item's `regionalAvailability` map.
5. THE Filtering_Function SHALL continue to resolve known property keys (`name`, `regionalAvailabilityType`) by walking up the parent chain, so that child rows inherit their ancestors' property values when the child itself has no direct match.
6. WHEN a parent row directly matches the query, THE Filtering_Function SHALL include the parent's child rows in the result (parent-chain inheritance).
7. THE Filtering_Function SHALL evaluate parent-chain inheritance correctly with respect to the boolean query: a child row SHALL only be included via inheritance if its ancestor genuinely satisfies the full query expression, not merely because the ancestor was included for a different query in a prior iteration.
8. WHEN the PropertyFilter query contains free-text tokens (tokens without a `propertyKey`), THE Filtering_Function SHALL match them against all filtering properties, consistent with the Cloudscape default behavior.
9. FOR ALL valid PropertyFilter queries containing any combination of AND and OR operations with region and property tokens, parsing the query into a TokenGroup tree and evaluating it SHALL produce the same set of matching rows as the Cloudscape default `defaultFilteringFunction` would produce for the non-region, non-hierarchical subset of the evaluation (round-trip equivalence for standard token evaluation logic).

### Requirement 9: Integrate Stack Filter as a PropertyFilter Property

**User Story:** As a dashboard user, I want to filter by CloudFormation stack name directly within the PropertyFilter (e.g., `Stack = MyStack AND us-east-1 = Available`), so that I can combine stack filtering with region and name filters using AND/OR boolean logic in a single unified interface.

#### Acceptance Criteria

1. THE CFN_Table PropertyFilter SHALL include a "Stack" filtering property that allows users to add `Stack = <stack name>` tokens to the filter query.
2. WHEN the user begins typing a value for the Stack_Property, THE PropertyFilter SHALL asynchronously load matching stack names from the Stack_List_API and present them as filtering options.
3. WHEN a `Stack = <stack name>` token is active in the query, THE Filtering_Function SHALL call the Stack_Filter_API to retrieve the stack's resource type pairs and property matches, and use them to determine whether each CfnAvailability_Row matches the stack token.
4. THE Filtering_Function SHALL evaluate the Stack_Property token as part of the full boolean expression: a `Stack = MyStack OR Name : EC2` query SHALL return rows that match the stack's resources OR rows whose name contains "EC2".
5. WHEN multiple Stack tokens are present in the query (e.g., `Stack = StackA OR Stack = StackB`), THE Filtering_Function SHALL treat each independently, returning rows that match either stack's resources.
6. WHEN the Stack_Property token is combined with other tokens using AND (e.g., `Stack = MyStack AND us-east-1 = Available`), THE Filtering_Function SHALL return only rows that belong to the stack's resources AND satisfy the region condition.
7. THE Stack_Property SHALL support the `=` and `!=` operators: `Stack = MyStack` includes the stack's resources, and `Stack != MyStack` excludes them.
8. WHILE the Stack_Filter_API request for a stack token is in progress, THE CFN_Table SHALL indicate a loading state.
9. IF the Stack_Filter_API request for a stack token fails, THEN THE CFN_Table SHALL display an error notification and the stack token SHALL match no rows.
10. WHEN the Stack_Property integration is complete, THE separate Stack_Selector dropdown component SHALL be removed from the CloudFormation resources tab, since its functionality is subsumed by the PropertyFilter integration.
11. THE Stack_Property filtering SHALL preserve the hierarchical structure: when a resource type row matches a stack, its parent service row SHALL also be included, and configuration rows SHALL be narrowed by property matches when available (consistent with the existing stack filter logic from Requirement 4).
