# Implementation Plan: Secrets Manager PAT Storage

## Overview

Migrate GitHub PAT storage from plaintext in DynamoDB to AWS Secrets Manager. This involves creating a new `GitHubTokenStore` service, updating the CDK stack with a Secrets Manager secret, VPC endpoint, and IAM policies, then refactoring all Lambda code paths to use the new token store instead of DynamoDB.

## Tasks

- [x] 1. Add environment key and create GitHubTokenStore service
  - [x] 1.1 Add GITHUB_TOKEN_SECRET_NAME to environment constants
    - Add the new key to `source/lambda/constants/environment.ts`
    - _Requirements: 3.3_

  - [x] 1.2 Create GitHubTokenStore service class
    - Create `source/lambda/services/github-token-store.ts`
    - Implement `getToken()`, `hasToken()`, `putToken()`, and `deleteToken()` methods
    - Handle `ResourceNotFoundException` gracefully in `getToken()`
    - Use `@aws-sdk/client-secrets-manager` (GetSecretValueCommand, PutSecretValueCommand)
    - _Requirements: 4.1, 5.1, 5.2, 6.1, 7.1_

  - [x] 1.3 Write unit tests for GitHubTokenStore
    - Create `source/lambda/services/github-token-store.test.ts`
    - Mock SecretsManagerClient to test getToken, hasToken, putToken, deleteToken
    - Test ResourceNotFoundException handling returns undefined
    - Test error propagation for non-recoverable errors
    - _Requirements: 4.1, 5.1, 5.2, 6.1, 6.2_

  - [x] 1.4 Write property test for token round-trip consistency
    - **Property 1: Token storage round-trip**
    - Create `source/lambda/services/github-token-store.property.test.ts`
    - For any valid PAT string (non-empty, trimmed), putToken then getToken returns the exact same string
    - **Validates: Requirements 4.1, 6.1, 7.1**

  - [x] 1.5 Write property test for hasToken state reflection
    - **Property 2: hasToken reflects secret state**
    - hasToken returns true iff a non-empty secret string exists
    - **Validates: Requirements 5.1, 5.2**

- [x] 2. Update SyncSettingsStore to remove githubToken from DynamoDB
  - [x] 2.1 Remove githubToken from SyncSettingsStore interface and operations
    - Remove `githubToken` from `SyncSettings` interface in `source/lambda/services/sync-settings-store.ts`
    - Remove token read from `getSettings()` method
    - Remove token write from `updateSettings()` method
    - Keep `terraformOverlayEnabled`, `dataSyncEnabled`, `updatedAt` fields
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 2.2 Update SyncSettingsStore unit tests
    - Update `source/lambda/services/sync-settings-store.test.ts`
    - Remove all test cases referencing githubToken in DynamoDB
    - Verify updateSettings no longer writes githubToken
    - Verify getSettings no longer returns githubToken
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 2.3 Write property test for DynamoDB schema correctness
    - **Property 5: DynamoDB schema correctness**
    - Update or create `source/lambda/services/sync-settings-store.property.test.ts`
    - For any call to updateSettings/getSettings, the DynamoDB item SHALL NOT contain a githubToken field
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update sync settings routes to use GitHubTokenStore
  - [x] 4.1 Refactor GET /syncSettings route
    - Update `source/lambda/routes/sync-settings-routes.ts`
    - Instantiate `GitHubTokenStore` using `getEnv(EnvironmentKey.GITHUB_TOKEN_SECRET_NAME)`
    - Call `tokenStore.hasToken()` to populate `hasToken` in response
    - Remove any DynamoDB-based token presence logic
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 4.2 Refactor PUT /syncSettings route
    - Update `source/lambda/routes/sync-settings-routes.ts`
    - When enabling with token: call `tokenStore.putToken(body.githubToken)`
    - When enabling without token: call `tokenStore.hasToken()` and return 400 if missing
    - When disabling: call `tokenStore.deleteToken()`
    - Update `store.updateSettings()` call to exclude githubToken
    - _Requirements: 4.1, 4.2, 4.3, 9.1, 9.2_

  - [x] 4.3 Update sync settings route tests
    - Update `source/lambda/routes/sync-settings-routes.test.ts`
    - Mock GitHubTokenStore for all test scenarios
    - Test PUT with token stores to Secrets Manager
    - Test PUT without token checks Secrets Manager for existing value
    - Test PUT disabling clears token from Secrets Manager
    - Test GET returns hasToken boolean from Secrets Manager
    - Test error handling when Secrets Manager fails
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 9.1, 9.2_

  - [x] 4.4 Write property test for token never leaked in API responses
    - **Property 3: Raw token never leaked in API responses**
    - For any stored PAT value, GET /syncSettings response SHALL NOT contain the raw token
    - Only `hasToken` boolean appears in response
    - **Validates: Requirements 5.3**

- [x] 5. Update plan routes to use GitHubTokenStore
  - [x] 5.1 Refactor getGitHubPat helper in plan-routes
    - Update `source/lambda/routes/plan-routes.ts`
    - Replace DynamoDB token read with `GitHubTokenStore.getToken()`
    - Throw error if token is undefined or empty
    - _Requirements: 6.1, 6.2_

- [x] 6. Update data-fetch Lambda to use GitHubTokenStore
  - [x] 6.1 Refactor data-fetch-lambda-main to read token from Secrets Manager
    - Update `source/lambda/data-fetch-lambda-main.ts`
    - Import and instantiate `GitHubTokenStore`
    - Replace DynamoDB token read with `tokenStore.getToken()`
    - Pass retrieved token to overlay Lambda invocation payload
    - On Secrets Manager failure: skip overlay, log error, continue sync
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.2 Update data-fetch Lambda tests
    - Update `source/lambda/data-fetch-lambda-main.test.ts`
    - Mock GitHubTokenStore for overlay-enabled scenarios
    - Test token passed correctly in overlay invocation payload
    - Test graceful degradation when Secrets Manager read fails
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.3 Write property test for token passthrough to overlay Lambda
    - **Property 4: Token passthrough to overlay Lambda**
    - For any non-empty token retrieved from Secrets Manager when overlay is enabled, the invocation payload SHALL include that exact token
    - **Validates: Requirements 7.2**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Update CDK stack infrastructure
  - [x] 8.1 Add Secrets Manager secret resource to CDK stack
    - Update `source/constructs/lib/stacks/capability-insights-stack.ts`
    - Create `CfnSecret` with name format `{prefix}GitHubPAT-{Region}`
    - Apply `RETAIN` removal policy
    - Use L1 constructs consistent with existing stack patterns
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 8.2 Add VPC endpoint for Secrets Manager
    - Create `CfnVPCEndpoint` for `com.amazonaws.{region}.secretsmanager`
    - Enable private DNS
    - Place in private subnet where API Lambda runs
    - Create security group allowing inbound HTTPS (443) from API Lambda SG
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 8.3 Add IAM policies for secret access
    - Grant API Lambda `secretsmanager:GetSecretValue` and `secretsmanager:PutSecretValue`
    - Grant Data-Fetch Lambda `secretsmanager:GetSecretValue` only
    - Scope both policies to the specific secret ARN
    - _Requirements: 3.1, 3.2_

  - [x] 8.4 Add GITHUB_TOKEN_SECRET_NAME environment variable to both Lambdas
    - Pass the secret name reference to API Lambda environment
    - Pass the secret name reference to Data-Fetch Lambda environment
    - _Requirements: 3.3_

  - [x] 8.5 Update CDK stack snapshot tests
    - Update `source/constructs/lib/stacks/capability-insights-stack.test.ts`
    - Regenerate snapshot to include new secret, VPC endpoint, SG, and IAM policies
    - _Requirements: 1.1, 2.1, 3.1, 3.2, 3.3_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The CDK stack changes (task 8) are placed last because they depend on knowing the final Lambda code shape, but can be developed in parallel with Lambda code changes

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1", "4.2", "5.1"] },
    { "id": 3, "tasks": ["4.3", "4.4", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "8.1", "8.2"] },
    { "id": 5, "tasks": ["8.3", "8.4"] },
    { "id": 6, "tasks": ["8.5"] }
  ]
}
```
