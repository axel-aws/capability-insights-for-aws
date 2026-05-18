# Requirements Document

## Introduction

The Infrastructure Planning feature currently fails when creating plans from GitHub repositories or JSON/CloudFormation template uploads because the API Lambda runs in a VPC private subnet with no internet access. The RepositoryAnalyzer attempts to call the GitHub API directly, which fails due to network restrictions.

This requirements document covers three related capabilities:

1. **GitHub Fetch Delegation** — A new lightweight Lambda (outside VPC) that fetches repository content from GitHub on behalf of the API Lambda.
2. **Plan Refresh / Versioning** — Adding `lastRefreshedAt` metadata and a refresh action to re-analyze plans.
3. **JSON Upload Fix** — Investigating and fixing the "fetch failed" error for CloudFormation/JSON template uploads.

## Glossary

- **API_Lambda**: The main backend Lambda function (`CapabilityInsightsApiLambda`) that runs inside a VPC private subnet and handles all API Gateway requests.
- **GitHubFetchLambda**: A new lightweight Lambda function deployed outside the VPC (with internet access) that fetches repository tree listings and file contents from the GitHub API.
- **Plan_Processor**: The orchestration service (`PlanProcessor`) that routes plan creation requests to the appropriate parser based on source type.
- **Repository_Analyzer**: The service (`RepositoryAnalyzer`) that analyzes GitHub repositories to extract AWS resource types and API operations from source files.
- **Plan_Store**: The persistence layer that stores plan metadata in DynamoDB and capability sets in S3.
- **GitHub_PAT**: A GitHub Personal Access Token stored in AWS Secrets Manager, used to authenticate GitHub API requests.
- **Capability_Set**: The extracted data (CFN resource types, Terraform resource types, API operations, service names) produced by analyzing a plan source.
- **VPC_Endpoint**: An interface VPC endpoint that allows the API Lambda to invoke other Lambda functions without internet access.
- **Terraform_Overlay_Lambda**: An existing Lambda that runs outside the VPC to fetch Terraform provider schemas from GitHub — the architectural pattern to follow.

## Requirements

### Requirement 1: GitHubFetchLambda Creation

**User Story:** As a platform operator, I want a dedicated Lambda function deployed outside the VPC that can fetch GitHub repository content, so that the API Lambda (which has no internet access) can delegate GitHub API calls to it.

#### Acceptance Criteria

1. THE GitHubFetchLambda SHALL be deployed as a Node.js Lambda function without VPC configuration (following the Terraform_Overlay_Lambda pattern).
2. THE GitHubFetchLambda SHALL accept an invocation payload containing a `repositoryUrl` field and a `pat` field.
3. WHEN invoked with a valid repository URL and PAT, THE GitHubFetchLambda SHALL call the GitHub Trees API to retrieve the full recursive file tree for the repository's HEAD branch.
4. WHEN invoked with a valid repository URL and PAT, THE GitHubFetchLambda SHALL fetch the raw content of each relevant source file identified in the tree listing.
5. THE GitHubFetchLambda SHALL return a response payload containing the tree listing and a map of file paths to their raw content.
6. IF the GitHub API returns a 401 status, THEN THE GitHubFetchLambda SHALL return an error response indicating the token is invalid or expired.
7. IF the GitHub API returns a 404 status, THEN THE GitHubFetchLambda SHALL return an error response indicating the repository cannot be accessed.
8. THE GitHubFetchLambda SHALL have a timeout of 120 seconds to accommodate large repositories.
9. THE GitHubFetchLambda SHALL process files concurrently (up to 15 simultaneous requests) with a 100-second elapsed time cutoff to stay within the timeout budget.

### Requirement 2: GitHubFetchLambda CDK Infrastructure

**User Story:** As a platform operator, I want the GitHubFetchLambda provisioned via CDK with appropriate IAM permissions, so that it integrates securely with the existing infrastructure.

#### Acceptance Criteria

1. THE CDK stack SHALL create an IAM execution role for the GitHubFetchLambda with the `AWSLambdaBasicExecutionRole` managed policy.
2. THE CDK stack SHALL deploy the GitHubFetchLambda without a `vpcConfig` property (no VPC attachment). THE GitHubFetchLambda SHALL NOT be attached to any VPC under any circumstances.
3. THE CDK stack SHALL grant the API_Lambda permission to invoke the GitHubFetchLambda via the existing Lambda VPC_Endpoint.
4. THE GitHubFetchLambda SHALL use the same deployment assets S3 bucket and code zip path as the other Lambda functions in the stack.
5. THE GitHubFetchLambda SHALL be configured with 512 MB of memory.

### Requirement 3: API Lambda GitHub Delegation

**User Story:** As a user creating a plan from a GitHub repository, I want the plan creation to succeed by delegating GitHub API calls to the GitHubFetchLambda, so that VPC network restrictions do not block the operation.

#### Acceptance Criteria

1. WHEN a plan creation request with `sourceType: 'github'` is received, THE Plan_Processor SHALL read the GitHub_PAT from Secrets Manager.
2. WHEN a plan creation request with `sourceType: 'github'` is received, THE Plan_Processor SHALL invoke the GitHubFetchLambda with the repository URL and PAT.
3. WHEN the GitHubFetchLambda invocation completes without error, THE Plan_Processor SHALL pass the returned file contents to the existing local parsers (Go, Java, Python, TypeScript, CloudFormation, Terraform), regardless of whether the response indicates partial success or failure.
4. THE Repository_Analyzer SHALL no longer make direct HTTP calls to the GitHub API from within the API_Lambda process.
5. IF the GitHubFetchLambda invocation itself fails (Lambda invocation error), THEN THE Plan_Processor SHALL return a descriptive error message to the caller.
6. THE Plan_Processor SHALL pass the GitHubFetchLambda function name via an environment variable (`GITHUB_FETCH_FUNCTION_NAME`).

### Requirement 4: Plan Refresh Metadata

**User Story:** As a user, I want to see when my infrastructure plan was last refreshed, so that I know how current the analysis results are.

#### Acceptance Criteria

1. THE Plan_Store SHALL store a `lastRefreshedAt` ISO 8601 timestamp in the plan's DynamoDB record.
2. WHEN a new plan is created, THE Plan_Store SHALL set `lastRefreshedAt` to the creation timestamp.
3. WHEN a plan is refreshed (re-analyzed), THE Plan_Store SHALL update `lastRefreshedAt` to the current timestamp.
4. THE `PlanConfiguration` type SHALL include a `lastRefreshedAt` field of type `string`.
5. THE GET /plans and GET /plans/:planId responses SHALL include the `lastRefreshedAt` field.

### Requirement 5: Plan Refresh Action

**User Story:** As a user, I want to refresh an existing plan to re-analyze its source (re-fetch from GitHub or re-process a template), so that I get updated results reflecting the latest state of the source.

#### Acceptance Criteria

1. WHEN a POST /plans/:planId/refresh request is received, THE API_Lambda SHALL re-run the full analysis pipeline for the plan's source type.
2. WHEN refreshing a GitHub-sourced plan, THE Plan_Processor SHALL invoke the GitHubFetchLambda to re-fetch the latest repository content and re-run all parsers.
3. WHEN refreshing a CloudFormation or Terraform-sourced plan, THE Plan_Processor SHALL require the template content to be re-submitted in the request body.
4. WHEN the refresh completes successfully, THE Plan_Store SHALL update the plan's `lastRefreshedAt` timestamp, capability set, resource type count, and API operation count. IF the refresh produces zero capabilities and zero resources, THEN THE Plan_Processor SHALL treat this as a refresh failure.
5. IF the plan does not exist, THEN THE API_Lambda SHALL return a 404 response.
6. IF the refresh processing fails, THEN THE API_Lambda SHALL return an appropriate error response without modifying the existing plan data.
7. THE Plan_Store SHALL store the `repositoryUrl` in the plan metadata so that GitHub-sourced plans can be refreshed without re-submitting the URL.

### Requirement 6: Source Metadata Persistence

**User Story:** As a system, I want to persist the original source reference (repository URL for GitHub plans) in the plan metadata, so that refresh operations can re-fetch from the same source without user re-input.

#### Acceptance Criteria

1. WHEN a GitHub-sourced plan is created, THE Plan_Store SHALL persist the `repositoryUrl` in the plan's DynamoDB record.
2. THE `PlanConfiguration` type SHALL include an optional `repositoryUrl` field of type `string`.
3. WHEN a plan refresh is requested for a GitHub-sourced plan without a `repositoryUrl` in the request body, THE Plan_Processor SHALL use the stored `repositoryUrl` from the plan metadata.
4. IF neither the request body nor the stored metadata contains a `repositoryUrl` for a GitHub-sourced plan refresh, THEN THE API_Lambda SHALL return a 400 error indicating the repository URL is required and SHALL NOT proceed with the refresh.

### Requirement 7: JSON/CloudFormation Upload Fix

**User Story:** As a user uploading a JSON/CloudFormation template, I want plan creation to succeed without "fetch failed" errors, so that I can analyze my infrastructure templates.

#### Acceptance Criteria

1. WHEN a plan creation request with `sourceType: 'cloudformation'` and valid `templateContent` is received, THE Plan_Processor SHALL decode and parse the template entirely within the API_Lambda process without making external network calls.
2. THE Plan_Processor SHALL validate that CloudFormation template processing does not invoke any external HTTP fetch operations.
3. IF the template content is invalid or cannot be parsed, THEN THE Plan_Processor SHALL return exactly a 400 error code with a descriptive message.
4. WHEN a plan creation request with `sourceType: 'terraform'` is received, THE Plan_Processor SHALL fetch the Terraform overlay data from S3 (accessible via VPC endpoint) without requiring internet access.

### Requirement 8: GitHubFetchLambda File Filtering

**User Story:** As a system, I want the GitHubFetchLambda to only fetch files that are relevant for analysis, so that it minimizes GitHub API calls and stays within timeout limits.

#### Acceptance Criteria

1. THE GitHubFetchLambda SHALL only fetch files with extensions: `.go`, `.java`, `.py`, `.ts`, `.js`, `.yaml`, `.yml`, `.json`, `.tf`.
2. THE GitHubFetchLambda SHALL exclude files in test directories (`test`, `tests`, `__tests__`, `spec`).
3. THE GitHubFetchLambda SHALL exclude files in vendor directories (`vendor`, `node_modules`, `.venv`, `site-packages`, `__pycache__`, `target/dependency`, `build/classes`).
4. THE GitHubFetchLambda SHALL exclude files matching test file patterns (`_test.`, `.test.`, `.spec.`).
5. THE GitHubFetchLambda SHALL prioritize fetching SDK files (Go, Java, Python, TypeScript) before infrastructure files (YAML, JSON, Terraform) to maximize value within the timeout.

### Requirement 9: GitHubFetchLambda Response Contract

**User Story:** As a developer, I want a well-defined contract between the API Lambda and GitHubFetchLambda, so that the integration is reliable and maintainable.

#### Acceptance Criteria

1. THE GitHubFetchLambda invocation request payload SHALL conform to the schema: `{ repositoryUrl: string, pat: string }`.
2. THE GitHubFetchLambda success response SHALL conform to the schema: `{ success: true, tree: Array<{ path: string, type: string, size?: number }>, files: Record<string, string>, metadata: { filesProcessed: number, totalFilesIdentified: number, timedOut: boolean } }`.
3. THE GitHubFetchLambda error response SHALL conform to the schema: `{ success: false, error: string, errorType: 'auth' | 'not_found' | 'rate_limit' | 'timeout' | 'unknown' }`.
4. FOR ALL valid invocation payloads, invoking the GitHubFetchLambda and then parsing the response SHALL produce either a valid success response or a valid error response (round-trip property).
