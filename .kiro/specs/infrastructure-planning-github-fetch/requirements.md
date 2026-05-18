# Requirements Document

## Introduction

This feature addresses two related improvements to the Infrastructure Planning system in Capability Insights for AWS:

1. **Delegated GitHub Fetch**: The API Lambda runs in a VPC private subnet with no internet access. Currently, GitHub repository analysis fails because the API Lambda cannot reach the GitHub API directly. The solution is to create a lightweight "GitHub Fetch" Lambda that runs outside the VPC (with internet access), which the API Lambda invokes via the Lambda VPC endpoint to fetch repository tree listings and file contents. The API Lambda then performs all parsing and processing locally.

2. **Plan Refresh with Versioning**: Infrastructure plans need a "last refreshed" timestamp and the ability to re-fetch/refresh a plan from its source (re-analyze the GitHub repository) to get updated results without creating a new plan.

## Glossary

- **API_Lambda**: The CapabilityInsightsApiLambda function that runs in a VPC private subnet, handles all API Gateway requests, and orchestrates plan processing.
- **GitHub_Fetch_Lambda**: A new lightweight Lambda function that runs outside the VPC (with internet access), responsible solely for fetching data from the GitHub API on behalf of the API Lambda.
- **Repository_Analyzer**: The class within the API Lambda that orchestrates GitHub repository analysis by fetching the file tree, classifying files, and parsing them to extract AWS resource types and API operations.
- **Plan_Store**: The service layer that manages plan metadata in DynamoDB and capability set data in S3.
- **Plan_Configuration**: The DynamoDB record representing an infrastructure plan's metadata, including name, source type, status, and timestamps.
- **Capability_Set**: The extracted analysis results (resource types, API operations, service names) stored as JSON in S3.
- **Lambda_VPC_Endpoint**: The existing VPC endpoint that allows the API Lambda to invoke other Lambda functions from within the private subnet.
- **GitHub_PAT**: A GitHub Personal Access Token stored in AWS Secrets Manager, used to authenticate GitHub API requests.

## Requirements

### Requirement 1: GitHub Fetch Lambda Creation

**User Story:** As a developer deploying Capability Insights, I want a dedicated Lambda function for GitHub API access, so that the VPC-isolated API Lambda can analyze GitHub repositories without requiring direct internet access.

#### Acceptance Criteria

1. THE GitHub_Fetch_Lambda SHALL run outside the VPC without VPC configuration, enabling direct internet access to the GitHub API.
2. THE GitHub_Fetch_Lambda SHALL accept an invocation payload specifying the operation type, repository owner, repository name, file path, and GitHub PAT.
3. WHEN the operation type is "getTree", THE GitHub_Fetch_Lambda SHALL fetch the recursive file tree from the GitHub Trees API and return the tree entries in the response payload.
4. WHEN the operation type is "getFileContent", THE GitHub_Fetch_Lambda SHALL fetch the raw content of a single file from the GitHub Contents API and return the file content in the response payload.
5. IF the GitHub API returns a 401 status, THEN THE GitHub_Fetch_Lambda SHALL return an error response indicating the token is invalid or expired.
6. IF the GitHub API returns a 404 status, THEN THE GitHub_Fetch_Lambda SHALL return an error response indicating the repository or file cannot be accessed.
7. IF the GitHub API returns any other non-success status, THEN THE GitHub_Fetch_Lambda SHALL return an error response including the HTTP status code and status text.
8. THE GitHub_Fetch_Lambda SHALL include the User-Agent header "capability-insights-for-aws" in all GitHub API requests.
9. THE GitHub_Fetch_Lambda SHALL have a timeout of 30 seconds to accommodate large repository tree fetches.
10. THE GitHub_Fetch_Lambda SHALL have an IAM execution role with only the AWSLambdaBasicExecutionRole managed policy (CloudWatch Logs access).

### Requirement 2: API Lambda Invocation of GitHub Fetch Lambda

**User Story:** As the API Lambda processing a GitHub plan, I want to delegate GitHub API calls to the GitHub Fetch Lambda, so that I can analyze repositories despite running in a VPC private subnet with no internet access.

#### Acceptance Criteria

1. THE API_Lambda SHALL invoke the GitHub_Fetch_Lambda synchronously (RequestResponse invocation type) via the Lambda VPC endpoint when fetching GitHub repository data.
2. THE API_Lambda SHALL pass the GitHub PAT retrieved from Secrets Manager to the GitHub_Fetch_Lambda in the invocation payload.
3. WHEN the GitHub_Fetch_Lambda returns a successful response, THE API_Lambda SHALL parse the response payload and use the returned data for local processing.
4. IF the GitHub_Fetch_Lambda returns an error response, THEN THE API_Lambda SHALL propagate the error with a descriptive message to the caller.
5. THE API_Lambda IAM role SHALL include permission to invoke the GitHub_Fetch_Lambda function.
6. THE API_Lambda SHALL receive the GitHub_Fetch_Lambda function name via an environment variable named GITHUB_FETCH_LAMBDA_NAME.
7. THE Repository_Analyzer SHALL use the delegated fetch mechanism for both tree listing and individual file content retrieval, replacing direct GitHub API calls.
8. THE Repository_Analyzer SHALL retain its existing concurrency control (maximum 15 concurrent requests) and timeout cutoff (50 seconds) when invoking the GitHub_Fetch_Lambda for file content fetches.

### Requirement 3: CDK Infrastructure for GitHub Fetch Lambda

**User Story:** As a developer deploying Capability Insights, I want the GitHub Fetch Lambda provisioned through the CDK stack, so that it is deployed and configured consistently alongside the existing infrastructure.

#### Acceptance Criteria

1. THE CapabilityInsightsStack SHALL define the GitHub_Fetch_Lambda resource with runtime nodejs24.x, a memory size of 256 MB, and a timeout of 30 seconds.
2. THE CapabilityInsightsStack SHALL define the GitHub_Fetch_Lambda without VPC configuration, following the same pattern as the Terraform Overlay Lambda.
3. THE CapabilityInsightsStack SHALL create a dedicated IAM role for the GitHub_Fetch_Lambda with only the AWSLambdaBasicExecutionRole managed policy.
4. THE CapabilityInsightsStack SHALL add the GitHub_Fetch_Lambda function ARN to the API Lambda role's InvokeDataFetchLambda policy statement.
5. THE CapabilityInsightsStack SHALL pass the GitHub_Fetch_Lambda function name to the API Lambda as the GITHUB_FETCH_LAMBDA_NAME environment variable.
6. THE GitHub_Fetch_Lambda SHALL use the same S3 deployment asset bucket and code zip path as the other Lambda functions in the stack.

### Requirement 4: Plan Refresh Timestamp

**User Story:** As a user viewing my infrastructure plans, I want to see when each plan was last refreshed, so that I can determine how current the analysis results are.

#### Acceptance Criteria

1. THE Plan_Configuration SHALL include a `lastRefreshedAt` field containing an ISO 8601 timestamp indicating when the plan's capability set was last re-analyzed from its source.
2. WHEN a new plan is created, THE Plan_Store SHALL set the `lastRefreshedAt` field to the creation timestamp.
3. WHEN a plan is successfully reprocessed, THE Plan_Store SHALL update the `lastRefreshedAt` field to the current timestamp.
4. THE API_Lambda SHALL include the `lastRefreshedAt` field in all plan responses (GET /plans, GET /plans/:planId).

### Requirement 5: Plan Source Persistence

**User Story:** As a user who created a plan from a GitHub repository, I want the system to remember the source repository URL, so that I can refresh the plan without re-entering the source information.

#### Acceptance Criteria

1. THE Plan_Configuration SHALL include a `repositoryUrl` field that stores the GitHub repository URL when the source type is "github".
2. WHEN a plan is created with source type "github", THE Plan_Store SHALL persist the `repositoryUrl` from the creation request.
3. THE Plan_Configuration SHALL include a `templateContent` field that stores the base64-encoded template content when the source type is "cloudformation" or "terraform".
4. WHEN a plan is created with source type "cloudformation" or "terraform", THE Plan_Store SHALL persist the `templateContent` from the creation request.
5. THE API_Lambda SHALL include the `repositoryUrl` field in plan responses when the source type is "github".
6. THE API_Lambda SHALL NOT include the `templateContent` field in list responses (GET /plans) to avoid excessive payload sizes, but SHALL include it in single-plan responses (GET /plans/:planId).

### Requirement 6: Plan Refresh Execution

**User Story:** As a user with an existing infrastructure plan, I want to trigger a refresh that re-analyzes the source, so that my plan reflects the latest state of my infrastructure code.

#### Acceptance Criteria

1. WHEN a refresh is triggered for a plan with source type "github", THE API_Lambda SHALL re-invoke the Repository_Analyzer using the stored `repositoryUrl` and the current GitHub PAT from Secrets Manager.
2. WHEN a refresh is triggered for a plan with source type "cloudformation" or "terraform", THE API_Lambda SHALL re-process the stored `templateContent` using the appropriate parser.
3. WHEN a refresh completes successfully, THE Plan_Store SHALL overwrite the existing capability set in S3 with the new results.
4. WHEN a refresh completes successfully, THE Plan_Store SHALL update the plan's `resourceTypeCount`, `apiOperationCount`, `status`, `updatedAt`, and `lastRefreshedAt` fields.
5. IF a refresh fails due to a GitHub API error, THEN THE API_Lambda SHALL set the plan status to "error" with a descriptive error message and SHALL NOT overwrite the existing capability set.
6. IF a refresh fails due to a parsing error, THEN THE API_Lambda SHALL set the plan status to "error" with a descriptive error message and SHALL NOT overwrite the existing capability set.
7. WHILE a refresh is in progress, THE API_Lambda SHALL set the plan status to "processing" before beginning the re-analysis.
8. THE reprocessPlanRoute (POST /plans/:planId/reprocess) SHALL use the stored source data to perform a full re-analysis rather than returning the existing capability set unchanged.
