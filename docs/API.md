# API Reference

## Introduction

The Capability Insights API is served by the **API Lambda** (`source/lambda/api-lambda-main.ts`), which runs inside the VPC behind an API Gateway. All endpoints are accessible only within the VPC — there are no authentication tokens required.

**Base URL pattern**: `https://<api-gateway-id>.execute-api.<region>.amazonaws.com/<stage>/`

All responses include CORS headers:

```
Content-Type: application/json
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
```

---

## Error Response Format

All error responses follow a standard shape:

```json
{
  "error": "<ErrorType>",
  "message": "<Human-readable description>"
}
```

| Status Code | Error Type            | When                                  |
| ----------- | --------------------- | ------------------------------------- |
| 400         | Bad Request           | Invalid or missing request parameters |
| 401         | Unauthorized          | Authentication failure                |
| 403         | Forbidden             | Insufficient permissions              |
| 404         | Not Found             | Resource or route not found           |
| 500         | Internal Server Error | Unhandled exception                   |

**Example error response** (404):

```json
{
  "error": "Not Found",
  "message": "GET /unknown not found"
}
```

The `ErrorResponse` utility (`source/lambda/constants/errors.ts`) provides factory methods: `badRequest`, `notFound`, `internalServerError`, `unauthorized`, and `forbidden`.

---

## Route Table

| Method | Path                                   | Domain               | Description                                  |
| ------ | -------------------------------------- | -------------------- | -------------------------------------------- |
| POST   | `/syncCapabilityData`                  | Sync                 | Trigger a manual data sync                   |
| GET    | `/stacks`                              | Stacks               | List active CloudFormation stacks            |
| GET    | `/stacks/:stackName/resources`         | Stacks               | Get resource types for a stack               |
| POST   | `/analysis`                            | Analysis             | Start a usage analysis                       |
| GET    | `/analysis`                            | Analysis             | Poll analysis execution status               |
| GET    | `/capabilities`                        | Analysis             | Get used capabilities filtered by usage data |
| POST   | `/policies`                            | Policies             | Create a new policy configuration            |
| GET    | `/policies`                            | Policies             | List all policy configurations               |
| GET    | `/policies/:policyId`                  | Policies             | Get a single policy                          |
| PUT    | `/policies/:policyId`                  | Policies             | Update a policy configuration                |
| DELETE | `/policies/:policyId`                  | Policies             | Delete a policy (cascading)                  |
| POST   | `/policies/:policyId/refresh`          | Policies             | Trigger immediate policy refresh             |
| GET    | `/policies/:policyId/preview`          | Policies             | Preview computed allow-list                  |
| GET    | `/policies/:policyId/template`         | Policies             | Generate CloudFormation template             |
| GET    | `/policies/:policyId/parts`            | Policy Parts         | List all policy parts                        |
| GET    | `/policies/:policyId/parts/:partIndex` | Policy Parts         | Get detail for a specific part               |
| DELETE | `/policies/:policyId/parts/:partIndex` | Policy Parts         | Delete a single policy part                  |
| GET    | `/syncSettings`                        | Sync Settings        | Get current sync settings                    |
| PUT    | `/syncSettings`                        | Sync Settings        | Update sync settings                         |
| GET    | `/data/info`                           | Data Uploads         | List data files with metadata                |
| POST   | `/data/uploads/presigned`              | Data Uploads         | Get presigned URL for upload                 |
| POST   | `/data/uploads/complete`               | Data Uploads         | Complete upload and trigger rebuild          |
| GET    | `/data/uploads`                        | Data Uploads         | List uploads (optional ?fileName= filter)    |
| DELETE | `/data/uploads/:uploadId`              | Data Uploads         | Delete an upload and trigger rebuild         |
| POST   | `/plans`                               | Infrastructure Plans | Create a new plan                            |
| GET    | `/plans`                               | Infrastructure Plans | List all plans                               |
| GET    | `/plans/names`                         | Infrastructure Plans | Get plan names for autocomplete              |
| GET    | `/plans/:planId`                       | Infrastructure Plans | Get a single plan                            |
| PUT    | `/plans/:planId`                       | Infrastructure Plans | Update plan metadata                         |
| DELETE | `/plans/:planId`                       | Infrastructure Plans | Delete a plan                                |
| POST   | `/plans/:planId/reprocess`             | Infrastructure Plans | Re-process plan source                       |
| GET    | `/plans/:planId/capability-set`        | Infrastructure Plans | Get capability set for a plan                |

---

## Routes by Domain

### Sync

#### POST /syncCapabilityData

Triggers an asynchronous invocation of the DataFetch Lambda to refresh capability data from the S3 access point.

**Request body**: None

**Response** (200):

```json
{
  "message": "Data sync triggered"
}
```

---

### Stacks

#### GET /stacks

Lists all active CloudFormation stacks in the account.

**Request body**: None

**Response** (200):

```json
{
  "stacks": [
    {
      "StackName": "my-stack",
      "StackStatus": "CREATE_COMPLETE",
      "CreationTime": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

#### GET /stacks/:stackName/resources

Returns the parsed resource types and property matches for a given CloudFormation stack.

**Path parameters**:

| Parameter   | Description                          |
| ----------- | ------------------------------------ |
| `stackName` | The name of the CloudFormation stack |

**Request body**: None

**Response** (200):

```json
{
  "resourceTypePairs": [
    {
      "service": "Lambda",
      "resourceType": "Function"
    }
  ],
  "propertyMatches": [
    {
      "resourceType": "AWS::Lambda::Function",
      "propertyPath": "Runtime",
      "value": "nodejs20.x"
    }
  ]
}
```

If the stack template or capability data cannot be read, a `warning` field is included:

```json
{
  "resourceTypePairs": [...],
  "propertyMatches": [...],
  "warning": "Could not read capability data: S3 read timed out after 5s"
}
```

**Error responses**:

- `400` — Stack name is required
- `404` — Stack not found

---

### Analysis

#### POST /analysis

Starts a Step Functions execution that orchestrates usage analyzers (CloudTrail, Resource Explorer, CloudFormation).

**Request body**:

```json
{
  "scope": "account",
  "accountIds": ["123456789012"],
  "analyzers": ["cloudtrail", "resourceExplorer", "cloudformation"],
  "analyzerParams": {
    "cloudtrail": {
      "bucket": "my-cloudtrail-bucket",
      "prefix": "AWSLogs/",
      "daysToScan": 7
    }
  }
}
```

| Field                                  | Type                          | Required                          | Description                                     |
| -------------------------------------- | ----------------------------- | --------------------------------- | ----------------------------------------------- |
| `scope`                                | `"account" \| "organization"` | Yes                               | Analysis scope                                  |
| `accountIds`                           | `string[]`                    | No                                | Specific accounts (defaults to current account) |
| `analyzers`                            | `string[]`                    | No                                | Analyzers to run (defaults to all three)        |
| `analyzerParams.cloudtrail.bucket`     | `string`                      | Yes (if cloudtrail analyzer used) | CloudTrail S3 bucket name                       |
| `analyzerParams.cloudtrail.prefix`     | `string`                      | No                                | S3 key prefix (default: `AWSLogs/`)             |
| `analyzerParams.cloudtrail.daysToScan` | `number`                      | No                                | Days of logs to scan (default: 7)               |

**Response** (202):

```json
{
  "executionArn": "arn:aws:states:us-east-1:123456789012:execution:...",
  "status": "RUNNING",
  "message": "account analysis started"
}
```

**Error responses**:

- `400` — Missing required field (`scope` or `analyzerParams.cloudtrail.bucket`)

---

#### GET /analysis

Polls the status of a running analysis execution.

**Query parameters**:

| Parameter      | Required | Description                        |
| -------------- | -------- | ---------------------------------- |
| `executionArn` | Yes      | The ARN returned by POST /analysis |

**Response** (200) — Running:

```json
{
  "status": "RUNNING"
}
```

**Response** (200) — Succeeded:

```json
{
  "status": "SUCCEEDED",
  "results": { ... }
}
```

**Response** (200) — Failed:

```json
{
  "status": "FAILED",
  "error": "Execution timed out"
}
```

**Error responses**:

- `400` — Missing required query parameter `executionArn`

---

#### GET /capabilities

Returns services and API operations filtered by usage data. Requires a prior analysis run.

**Query parameters**:

| Parameter     | Required | Default    | Description                                    |
| ------------- | -------- | ---------- | ---------------------------------------------- |
| `usageFilter` | No       | `combined` | One of: `combined`, `deployed`, `active_usage` |
| `scope`       | No       | `account`  | One of: `account`, `organization`              |
| `accountIds`  | No       | —          | Comma-separated account IDs to filter          |

**Response** (200):

```json
{
  "services": ["Amazon S3", "AWS Lambda"],
  "apis": ["s3:GetObject", "lambda:Invoke"]
}
```

**Error responses**:

- `400` — Invalid `usageFilter` value
- `404` — No usage data found (run POST /analysis first)

---

### Policies

#### POST /policies

Creates a new policy configuration.

**Request body**:

```json
{
  "policyName": "production-deny-policy",
  "regions": ["us-east-1", "eu-west-1"],
  "mode": "intersection",
  "policyType": "IAM",
  "refreshIntervalHours": 12,
  "exceptions": {
    "allowedServices": ["s3"],
    "allowedActions": ["sts:AssumeRole"]
  }
}
```

| Field                  | Type       | Required | Description                           |
| ---------------------- | ---------- | -------- | ------------------------------------- |
| `policyName`           | `string`   | Yes      | Unique policy name                    |
| `regions`              | `string[]` | Yes      | AWS regions to include                |
| `mode`                 | `string`   | Yes      | Computation mode (`intersection`)     |
| `policyType`           | `string`   | Yes      | Policy type (`IAM`)                   |
| `refreshIntervalHours` | `number`   | No       | Auto-refresh interval                 |
| `exceptions`           | `object`   | No       | Services/actions to exclude from deny |

**Response** (201):

```json
{
  "policy": {
    "policyId": "uuid-here",
    "policyName": "production-deny-policy",
    "regions": ["us-east-1", "eu-west-1"],
    "mode": "intersection",
    "policyType": "IAM",
    "status": "draft",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

**Error responses**:

- `400` — Validation error
- `409` — Policy name already exists

---

#### GET /policies

Lists all policy configurations with optional filters.

**Query parameters**:

| Parameter  | Required | Description             |
| ---------- | -------- | ----------------------- |
| `tagKey`   | No       | Filter by tag key       |
| `tagValue` | No       | Filter by tag value     |
| `status`   | No       | Filter by policy status |
| `search`   | No       | Search by name          |

**Response** (200):

```json
{
  "policies": [
    {
      "policyId": "uuid-here",
      "policyName": "production-deny-policy",
      "status": "active",
      "regions": ["us-east-1"],
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

#### GET /policies/:policyId

Returns a single policy configuration.

**Path parameters**:

| Parameter  | Description        |
| ---------- | ------------------ |
| `policyId` | UUID of the policy |

**Response** (200):

```json
{
  "policy": {
    "policyId": "uuid-here",
    "policyName": "production-deny-policy",
    "regions": ["us-east-1"],
    "mode": "intersection",
    "policyType": "IAM",
    "status": "active",
    "policyArn": "arn:aws:iam::123456789012:policy/PolicyEnforcer-production-deny-policy",
    "lastRefreshTime": "2024-01-15T12:00:00Z"
  }
}
```

**Error responses**:

- `404` — Policy not found

---

#### PUT /policies/:policyId

Updates a policy configuration.

**Path parameters**:

| Parameter  | Description        |
| ---------- | ------------------ |
| `policyId` | UUID of the policy |

**Request body** (partial update):

```json
{
  "regions": ["us-east-1", "us-west-2"],
  "refreshIntervalHours": 6
}
```

**Response** (200):

```json
{
  "policy": { ... }
}
```

**Error responses**:

- `400` — Validation error
- `404` — Policy not found

---

#### DELETE /policies/:policyId

Performs a cascading delete: removes all IAM policy parts from IAM, then deletes the DynamoDB record.

**Path parameters**:

| Parameter  | Description        |
| ---------- | ------------------ |
| `policyId` | UUID of the policy |

**Response** (200):

```json
{
  "success": true,
  "deletedArns": ["arn:aws:iam::123456789012:policy/PolicyEnforcer-my-policy"],
  "failedArns": []
}
```

If some IAM deletions fail, the DynamoDB record is still removed:

```json
{
  "success": false,
  "deletedArns": ["arn:...Part1"],
  "failedArns": [{ "arn": "arn:...Part2", "error": "Access denied" }]
}
```

**Error responses**:

- `404` — Policy not found

---

#### POST /policies/:policyId/refresh

Triggers an immediate policy refresh: fetches catalog data, computes the allow-list, and creates/updates IAM managed policies.

**Path parameters**:

| Parameter  | Description        |
| ---------- | ------------------ |
| `policyId` | UUID of the policy |

**Request body**: None

**Response** (200):

```json
{
  "message": "Policy refreshed successfully",
  "policyArn": "arn:aws:iam::123456789012:policy/PolicyEnforcer-my-policy",
  "additionalPolicyArns": ["arn:aws:iam::123456789012:policy/PolicyEnforcer-my-policy-Part2"],
  "actionCount": 1250,
  "splitRequired": true,
  "totalSize": 12000
}
```

**Error responses**:

- `404` — Policy not found
- `503` — Catalog data temporarily unavailable

---

#### GET /policies/:policyId/preview

Computes and returns a preview of the allow-list without creating IAM resources.

**Path parameters**:

| Parameter  | Description        |
| ---------- | ------------------ |
| `policyId` | UUID of the policy |

**Response** (200):

```json
{
  "actions": ["s3:GetObject", "s3:PutObject", "lambda:Invoke"],
  "actionCount": 1250,
  "excludedCount": 50,
  "exceptionCount": 5,
  "estimatedPolicySize": 12000,
  "splitRequired": true
}
```

**Error responses**:

- `404` — Policy not found
- `503` — Catalog data temporarily unavailable

---

#### GET /policies/:policyId/template

Generates a CloudFormation template for deploying the policy infrastructure.

**Path parameters**:

| Parameter  | Description        |
| ---------- | ------------------ |
| `policyId` | UUID of the policy |

**Response** (200):

```json
{
  "AWSTemplateFormatVersion": "2010-09-09",
  "Description": "Policy Enforcer deployment for \"production-deny-policy\"",
  "Parameters": { ... },
  "Resources": { ... },
  "Outputs": { ... }
}
```

**Error responses**:

- `404` — Policy not found

---

### Policy Parts

#### GET /policies/:policyId/parts

Lists all IAM policy parts (documents) for a policy, with metadata about each part.

**Path parameters**:

| Parameter  | Description        |
| ---------- | ------------------ |
| `policyId` | UUID of the policy |

**Response** (200):

```json
{
  "parts": [
    {
      "partIndex": 0,
      "arn": "arn:aws:iam::123456789012:policy/PolicyEnforcer-my-policy",
      "partType": "blanket-deny",
      "documentSize": 5120,
      "statementItemCount": 450
    },
    {
      "partIndex": 1,
      "arn": "arn:aws:iam::123456789012:policy/PolicyEnforcer-my-policy-Part2",
      "partType": "specific-api-deny",
      "documentSize": 4800,
      "statementItemCount": 400
    }
  ],
  "totalParts": 2,
  "combinedSize": 9920
}
```

**Error responses**:

- `404` — Policy not found

---

#### GET /policies/:policyId/parts/:partIndex

Fetches the live IAM policy document for a specific part, with actions grouped by service.

**Path parameters**:

| Parameter   | Description                         |
| ----------- | ----------------------------------- |
| `policyId`  | UUID of the policy                  |
| `partIndex` | Zero-based index of the policy part |

**Response** (200):

```json
{
  "part": {
    "partIndex": 0,
    "arn": "arn:aws:iam::123456789012:policy/PolicyEnforcer-my-policy",
    "partType": "blanket-deny",
    "documentSize": 5120,
    "statementItemCount": 450
  },
  "document": {
    "Version": "2012-10-17",
    "Statement": [...]
  },
  "services": [
    {
      "servicePrefix": "s3",
      "actions": ["GetObject", "PutObject", "DeleteObject"]
    }
  ]
}
```

**Error responses**:

- `404` — Policy or part not found
- `502` — Upstream IAM service unavailable

---

#### DELETE /policies/:policyId/parts/:partIndex

Deletes a single IAM policy part and updates the stored ARN references.

**Path parameters**:

| Parameter   | Description                         |
| ----------- | ----------------------------------- |
| `policyId`  | UUID of the policy                  |
| `partIndex` | Zero-based index of the policy part |

**Response** (200):

```json
{
  "message": "Part 1 deleted",
  "arn": "arn:aws:iam::123456789012:policy/PolicyEnforcer-my-policy-Part2"
}
```

**Error responses**:

- `404` — Policy or part not found

---

### Sync Settings

#### GET /syncSettings

Returns the current sync settings (toggle states and token presence).

**Request body**: None

**Response** (200):

```json
{
  "terraformOverlayEnabled": true,
  "hasToken": true,
  "dataSyncEnabled": true,
  "updatedAt": "2024-01-15T10:30:00Z"
}
```

---

#### PUT /syncSettings

Updates sync settings. When enabling the Terraform overlay, a GitHub token must be provided (or already stored).

**Request body**:

```json
{
  "terraformOverlayEnabled": true,
  "githubToken": "ghp_xxxxxxxxxxxx",
  "dataSyncEnabled": true
}
```

| Field                     | Type      | Required | Description                            |
| ------------------------- | --------- | -------- | -------------------------------------- |
| `terraformOverlayEnabled` | `boolean` | Yes      | Enable/disable Terraform overlay sync  |
| `githubToken`             | `string`  | No       | GitHub PAT (stored in Secrets Manager) |
| `dataSyncEnabled`         | `boolean` | No       | Enable/disable automatic data sync     |

**Response** (200):

```json
{
  "terraformOverlayEnabled": true,
  "hasToken": true,
  "dataSyncEnabled": true,
  "updatedAt": "2024-01-15T10:35:00Z"
}
```

**Error responses**:

- `400` — `terraformOverlayEnabled` must be a boolean
- `400` — GitHub token required when enabling without stored token
- `400` — Token must not have leading/trailing whitespace

---

### Data Uploads

#### GET /data/info

Lists data files with last-modified timestamps and sizes from S3.

**Request body**: None

**Response** (200):

```json
{
  "files": [
    { "name": "regions", "lastModified": "2024-01-15T10:30:00Z", "sizeBytes": 45000 },
    { "name": "products", "lastModified": "2024-01-15T10:30:00Z", "sizeBytes": 120000 },
    { "name": "apis", "lastModified": "2024-01-15T10:30:00Z", "sizeBytes": 890000 },
    { "name": "cfn_resources", "lastModified": "2024-01-15T10:30:00Z", "sizeBytes": 250000 }
  ]
}
```

---

#### POST /data/uploads/presigned

Returns a presigned URL for uploading a file directly to S3.

**Request body**:

```json
{
  "fileName": "products"
}
```

| Field      | Type     | Required | Description                                            |
| ---------- | -------- | -------- | ------------------------------------------------------ |
| `fileName` | `string` | Yes      | One of: `regions`, `products`, `apis`, `cfn_resources` |

**Response** (200):

```json
{
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "presignedUrl": "https://s3.amazonaws.com/...",
  "s3Key": "data/uploads/products/550e8400-e29b-41d4-a716-446655440000.json"
}
```

**Error responses**:

- `400` — Invalid file name

---

#### POST /data/uploads/complete

Validates the uploaded file in S3, stores metadata in DynamoDB, and triggers a data rebuild.

**Request body**:

```json
{
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "fileName": "products",
  "s3Key": "data/uploads/products/550e8400-e29b-41d4-a716-446655440000.json",
  "description": "Optional description"
}
```

| Field         | Type     | Required | Description                                            |
| ------------- | -------- | -------- | ------------------------------------------------------ |
| `uploadId`    | `string` | Yes      | The upload ID from the presigned response              |
| `fileName`    | `string` | Yes      | One of: `regions`, `products`, `apis`, `cfn_resources` |
| `s3Key`       | `string` | Yes      | The S3 key from the presigned response                 |
| `description` | `string` | No       | Optional description of the upload                     |

**Response** (200):

```json
{
  "success": true,
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "uploadedAt": "2024-01-15T10:35:00Z",
  "mergeResult": { "additions": 5, "updates": 3, "unchanged": 142, "total": 150 }
}
```

**Error responses**:

- `400` — Invalid request, content not valid JSON array
- `404` — Upload not found in S3 (presigned URL may have expired)

---

#### GET /data/uploads

Lists upload records, optionally filtered by file name.

**Query parameters**:

| Parameter  | Type     | Required | Description                                            |
| ---------- | -------- | -------- | ------------------------------------------------------ |
| `fileName` | `string` | No       | One of: `regions`, `products`, `apis`, `cfn_resources` |

**Response** (200):

```json
{
  "uploads": [
    {
      "uploadId": "550e8400-e29b-41d4-a716-446655440000",
      "fileName": "products",
      "s3Key": "data/uploads/products/550e8400-e29b-41d4-a716-446655440000.json",
      "uploadedAt": "2024-01-15T10:35:00Z",
      "itemCount": 50,
      "description": ""
    }
  ]
}
```

---

#### DELETE /data/uploads/:uploadId

Deletes an upload from S3 and DynamoDB, then triggers a data rebuild.

**Path parameters**:

| Parameter  | Description                |
| ---------- | -------------------------- |
| `uploadId` | The ID of the upload       |

**Response** (200):

```json
{
  "success": true,
  "mergeResult": { "additions": 2, "updates": 1, "unchanged": 145, "total": 148 }
}
```

**Error responses**:

- `404` — Upload not found

---

### Infrastructure Plans

#### POST /plans

Creates a new infrastructure plan by processing the provided source (CloudFormation template, Terraform config, or GitHub repository).

**Request body**:

```json
{
  "planName": "my-infrastructure",
  "sourceType": "github",
  "repositoryUrl": "https://github.com/org/repo",
  "labels": [{ "key": "team", "value": "platform" }]
}
```

| Field             | Type                                          | Required                | Description                |
| ----------------- | --------------------------------------------- | ----------------------- | -------------------------- |
| `planName`        | `string`                                      | Yes                     | Unique plan name           |
| `sourceType`      | `"cloudformation" \| "terraform" \| "github"` | Yes                     | Source type                |
| `templateContent` | `string`                                      | Yes (for cfn/terraform) | Template or config content |
| `repositoryUrl`   | `string`                                      | Yes (for github)        | GitHub repository URL      |
| `labels`          | `Array<{key, value}>`                         | No                      | Key-value labels           |

**Response** (201):

```json
{
  "plan": {
    "planId": "uuid-here",
    "planName": "my-infrastructure",
    "sourceType": "github",
    "repositoryUrl": "https://github.com/org/repo",
    "status": "processed",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

**Error responses**:

- `400` — Validation error or processing error (no resources found, template too large)
- `401` — GitHub token invalid or expired
- `404` — Cannot access repository
- `409` — Plan name already exists

---

#### GET /plans

Lists all plans with optional filters.

**Query parameters**:

| Parameter    | Required | Description           |
| ------------ | -------- | --------------------- |
| `search`     | No       | Search by plan name   |
| `sourceType` | No       | Filter by source type |
| `labelKey`   | No       | Filter by label key   |
| `labelValue` | No       | Filter by label value |

**Response** (200):

```json
{
  "plans": [
    {
      "planId": "uuid-here",
      "planName": "my-infrastructure",
      "sourceType": "github",
      "status": "processed",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

---

#### GET /plans/names

Returns plan names for autocomplete/dropdown use.

**Request body**: None

**Response** (200):

```json
{
  "names": ["my-infrastructure", "staging-env", "production-stack"]
}
```

---

#### GET /plans/:planId

Returns a single plan configuration.

**Path parameters**:

| Parameter | Description      |
| --------- | ---------------- |
| `planId`  | UUID of the plan |

**Response** (200):

```json
{
  "plan": {
    "planId": "uuid-here",
    "planName": "my-infrastructure",
    "sourceType": "github",
    "repositoryUrl": "https://github.com/org/repo",
    "status": "processed",
    "labels": [{ "key": "team", "value": "platform" }],
    "createdAt": "2024-01-15T10:30:00Z",
    "lastRefreshedAt": "2024-01-15T12:00:00Z"
  }
}
```

**Error responses**:

- `404` — Plan not found

---

#### PUT /plans/:planId

Updates plan metadata (name and/or labels).

**Path parameters**:

| Parameter | Description      |
| --------- | ---------------- |
| `planId`  | UUID of the plan |

**Request body**:

```json
{
  "planName": "renamed-plan",
  "labels": [{ "key": "env", "value": "production" }]
}
```

| Field      | Type                  | Required | Description    |
| ---------- | --------------------- | -------- | -------------- |
| `planName` | `string`              | No       | New plan name  |
| `labels`   | `Array<{key, value}>` | No       | Updated labels |

At least one of `planName` or `labels` must be provided.

**Response** (200):

```json
{
  "plan": { ... }
}
```

**Error responses**:

- `400` — Validation error (no fields provided, empty name)
- `404` — Plan not found
- `409` — Plan name already exists

---

#### DELETE /plans/:planId

Deletes a plan and its associated capability set from S3.

**Path parameters**:

| Parameter | Description      |
| --------- | ---------------- |
| `planId`  | UUID of the plan |

**Response** (200):

```json
{
  "message": "Plan \"uuid-here\" deleted"
}
```

**Error responses**:

- `404` — Plan not found
- `500` — Partial delete (DynamoDB deleted but S3 cleanup failed)

---

#### POST /plans/:planId/reprocess

Re-processes the plan source and updates the capability set.

**Path parameters**:

| Parameter | Description      |
| --------- | ---------------- |
| `planId`  | UUID of the plan |

**Request body** (varies by source type):

For GitHub plans (optional — uses stored URL by default):

```json
{
  "repositoryUrl": "https://github.com/org/repo"
}
```

For CloudFormation/Terraform plans (required):

```json
{
  "templateContent": "AWSTemplateFormatVersion: '2010-09-09'\n..."
}
```

**Response** (200):

```json
{
  "plan": {
    "planId": "uuid-here",
    "planName": "my-infrastructure",
    "sourceType": "github",
    "status": "processed",
    "lastRefreshedAt": "2024-01-15T14:00:00Z"
  }
}
```

**Error responses**:

- `400` — Missing template content, processing error, or zero capabilities produced
- `401` — GitHub token invalid or expired
- `404` — Plan not found or cannot access repository

---

#### GET /plans/:planId/capability-set

Returns the full capability set extracted from the plan source.

**Path parameters**:

| Parameter | Description      |
| --------- | ---------------- |
| `planId`  | UUID of the plan |

**Response** (200):

```json
{
  "cfnResourceTypes": [{ "service": "Lambda", "resourceType": "Function" }],
  "terraformResourceTypes": [{ "provider": "aws", "resourceType": "aws_lambda_function" }],
  "apiOperations": [{ "service": "lambda", "operation": "CreateFunction" }]
}
```

**Error responses**:

- `404` — Plan or capability set not found
