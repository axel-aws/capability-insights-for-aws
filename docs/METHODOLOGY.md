# Methodology

This document explains how Capability Insights for AWS derives its data mappings, computes availability, and analyzes infrastructure. It is intended for two audiences:

1. **Contributors** debugging or extending the system — you'll find implementation details, source file references, and explanations of design decisions.
2. **Dashboard users** wanting to understand how the data is produced — you'll find plain-language explanations of what each data transformation does and why.

---

## Table of Contents

1. [Terraform Classic AWS Resource Mapping](#terraform-classic-aws-resource-mapping)
2. [Operation-to-Service Attribution](#operation-to-service-attribution)
3. [AWSCC Resource Mapping](#awscc-resource-mapping)
4. [Availability Computation](#availability-computation)
5. [Infrastructure Planning Analysis](#infrastructure-planning-analysis)
6. [Data Refresh Cadence](#data-refresh-cadence)
7. [Known Limitations](#known-limitations)
8. [Source File Reference](#source-file-reference)

---

## Terraform Classic AWS Resource Mapping

The system determines which AWS API operations each Terraform classic AWS resource (e.g., `aws_s3_bucket`) requires to function. This mapping is built by parsing Go source files from the [hashicorp/terraform-provider-aws](https://github.com/hashicorp/terraform-provider-aws) GitHub repository.

### Step 1: Discover Resource Factory Functions

Each service in the Terraform AWS provider has a `service_package_gen.go` file under `internal/service/{serviceName}/`. This file lists all resources belonging to that service along with their factory function names:

```go
{
    Factory:  resourceBucket,
    TypeName: "aws_s3_bucket",
    Name:     "Bucket",
},
```

The parser extracts both the `Factory` field (the Go function name) and the `TypeName` field (the Terraform resource type). The factory name is used to locate the corresponding Go source file where SDK API calls are made.

**Implementation**: `classic-service-package-parser.ts` uses two regex patterns to handle both field orderings (`Factory` before `TypeName` and vice versa).

### Step 2: Parse Go Source Files for SDK Client Method Calls

For each resource, the system fetches the Go source file that contains the factory function declaration and extracts AWS SDK client method calls using the following regex pattern:

```
(?:conn|client|svc)\.(\w+)\(
```

This matches patterns like:

- `conn.CreateBucket(input)`
- `client.PutObject(ctx, params)`
- `svc.RunInstances(input)`
- `conn.CreateBucketWithContext(ctx, input)`

The parser applies the following transformations:

- **Strips `WithContext` suffix** — SDK v1 methods like `CreateBucketWithContext` are normalized to `CreateBucket`
- **Filters non-API methods** — Utility methods like `String()`, `GoString()`, `Validate()`, and methods shorter than 3 characters are excluded
- **Deduplicates** — Each unique operation name is recorded only once per resource

**Implementation**: `classic-resource-parser.ts` exports `parseResourceGoFile(content)` which returns a sorted array of unique API operation names.

### Step 3: Determine the Primary SDK Service

The system identifies which AWS service a resource belongs to by parsing Go import paths:

```go
import "github.com/aws/aws-sdk-go-v2/service/s3"
import "github.com/aws/aws-sdk-go/service/elasticloadbalancingv2"
```

The `extractSdkServiceName` function reads all SDK import paths and, when multiple services are imported, uses a longest-name heuristic to select the most specific service (e.g., `elasticloadbalancingv2` over `ec2`). This heuristic works because the primary service for a resource file is typically the most specific one — the one the resource actually manages.

**Implementation**: `classic-resource-parser.ts` exports `extractSdkServiceName(content)` and `extractAllSdkServiceNames(content)`.

### Step 4: Assemble the Mapping

The handler orchestrates the full pipeline:

1. Lists service directories under `internal/service/` using the GitHub Contents API
2. Fetches all `service_package_gen.go` files concurrently
3. Parses each to discover resource factory functions
4. Lists actual Go files in each service directory (avoiding fragile filename derivation)
5. Fetches resource Go files concurrently
6. Matches files to resources by searching for factory function declarations (`func factoryName(`)
7. Parses each matched file for SDK client method calls
8. Assembles the final `ClassicApiMappingData` structure and writes it to S3

**Implementation**: `handler.ts` function `fetchAndWriteClassicApiMapping`.

---

## Operation-to-Service Attribution

When displaying Terraform resource availability in the frontend, each API operation must be attributed to its correct AWS service. This attribution uses the authoritative API operations data (the same data shown in the "API Operations" tab) rather than trusting the single `sdkService` field from the mapping.

### Why Not Trust `sdkService`?

Many Terraform resources call APIs across multiple services. For example, `aws_alb` calls both ELBv2 APIs (like `CreateLoadBalancer`) and EC2 APIs (like `DescribeSecurityGroups`). The mapping's `sdkService` field only records one service — the primary one. If we attributed all operations to that single service, operations belonging to secondary services would fail to match in the availability index, producing incorrect "Not Available" results.

### The OperationAvailabilityIndex

The frontend builds an `OperationAvailabilityIndex` — a nested map structure:

```
sdkService → operationName → Set<availableRegions>
```

This index is constructed from the authoritative API operations data (`apiRows`). Only operations with `AvailabilityStatus.AVAILABLE` are indexed. The index enables O(1) lookups: given a service name, operation name, and region, you can instantly determine whether that operation is available.

**Implementation**: `classic-api-availability-engine.ts` exports `buildOperationAvailabilityIndex(apiRows)`.

### The `buildAvailabilityTree` Function

This function constructs the three-level display tree:

- **Level 0** — Terraform Resource (e.g., `aws_alb`) with computed AND-availability
- **Level 1** — SDK Service (e.g., `elasticloadbalancingv2`, `ec2`) as an informational grouping
- **Level 2** — API Operation (e.g., `CreateLoadBalancer`) with actual per-region availability

For each operation in a resource's `requiredApis` list, the function looks it up in a reverse index (`operationName → Set<serviceName>`) built from the authoritative data. Attribution follows this priority:

1. **Unambiguous** — Only one service has this operation → attribute to that service
2. **Ambiguous, primary claims it** — Multiple services have this operation, but the resource's declared primary service is one of them → attribute to the primary service (tiebreaker)
3. **Ambiguous, primary doesn't claim it** — Multiple services have it, primary isn't among them → attribute to the first match
4. **Not found** — Operation doesn't exist in the index → fall back to the declared primary service

This approach correctly handles multi-service resources and produces accurate per-region availability.

**Implementation**: `classic-api-availability-engine.ts` exports `buildAvailabilityTree(mapping, apiRows, regions)`.

---

## AWSCC Resource Mapping

The AWSCC (AWS Cloud Control) provider mapping connects Terraform AWSCC resource types to their corresponding CloudFormation resource types.

### JSON Schema `typeName` Field

The mapping is derived from the AWSCC provider's JSON schema files, fetched from [hashicorp/terraform-provider-awscc](https://github.com/hashicorp/terraform-provider-awscc) under `internal/service/cloudformation/schemas/`. Each JSON schema file contains a `typeName` field that is the authoritative CloudFormation type name:

```json
{
  "typeName": "AWS::S3::Bucket",
  "description": "...",
  ...
}
```

The parser validates that the `typeName` matches the expected `AWS::{Service}::{Resource}` pattern before accepting it.

**Implementation**: `awscc-parser.ts` exports `parseAwsccSchemaContent(jsonContent)`.

### Deterministic Naming Convention

The conversion between AWSCC Terraform types and CloudFormation types is deterministic and reversible:

| Direction   | Transformation                                                                                 | Example                               |
| ----------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| CFN → AWSCC | Replace `::` with `_`, remove `AWS_` prefix, lowercase, prepend `awscc_`                       | `AWS::S3::Bucket` → `awscc_s3_bucket` |
| AWSCC → CFN | Remove `awscc_` prefix, split by `_`, capitalize each segment, join with `::`, prepend `AWS::` | `awscc_s3_bucket` → `AWS::S3::Bucket` |

> **Note**: The AWSCC-to-CFN reverse conversion is best-effort because lowercasing loses original casing (e.g., `EC2` becomes `Ec2`). For exact round-trips, the system uses the overlay index maps built from the authoritative `typeName` field.

### Classic AWS Derivation from AWSCC

Classic AWS provider type mappings (e.g., `aws_s3_bucket` → `AWS::S3::Bucket`) are derived directly from AWSCC mappings by replacing the `awscc_` prefix with `aws_`. This avoids fetching thousands of additional Go files from GitHub and provides reliable CFN type mappings for all resources that exist in both providers.

**Implementation**: `handler.ts` exports `deriveClassicAwsFromAwscc(awsccMappings)`.

---

## Availability Computation

The system computes per-region availability for Terraform resources using AND-logic across all required API operations.

### Rules

| Condition                                               | Result            |
| ------------------------------------------------------- | ----------------- |
| ALL required API operations are available in the region | **Available**     |
| ANY required API operation is missing in the region     | **Not Available** |
| The resource has no required APIs mapped (empty list)   | **Unknown**       |

### How It Works

For each Terraform resource and each region:

1. Look up the resource's required API operations (from the classic API mapping)
2. For each operation, check the `OperationAvailabilityIndex` to see if it's available in that region
3. If any single operation is missing, the entire resource is marked "Not Available" in that region
4. Only if every operation is present is the resource marked "Available"

This AND-logic reflects reality: a Terraform resource cannot function in a region if any of its required API operations are unavailable there.

**Implementation**: `classic-api-availability-engine.ts` exports `computeResourceAvailability(requiredApis, sdkService, region, operationAvailabilityIndex)`.

---

## Infrastructure Planning Analysis

Infrastructure Planning analyzes GitHub repositories and uploaded templates to determine which AWS capabilities (API operations, CloudFormation resource types, Terraform resource types) are used.

### File Classification

Files are classified by extension to determine the appropriate parser:

| Extension       | Classification | Parser                                        |
| --------------- | -------------- | --------------------------------------------- |
| `.go`           | Go             | SDK client method call extraction             |
| `.java`         | Java           | AWS SDK for Java v2 client method extraction  |
| `.py`           | Python         | boto3 client and resource method extraction   |
| `.ts`, `.js`    | TypeScript     | AWS SDK v3 Command pattern and v2-style calls |
| `.yaml`, `.yml` | YAML           | CloudFormation template detection             |
| `.json`         | JSON           | CloudFormation template detection             |
| `.tf`           | Terraform      | HCL resource block extraction                 |

Files in test directories (`test/`, `tests/`, `__tests__/`, `spec/`), vendor directories (`vendor/`, `node_modules/`, `.venv/`), and files matching test patterns (`_test.go`, `.test.ts`, `.spec.ts`) are excluded.

**Implementation**: `repository-analyzer.ts` exports `classifyFile(path)` and `shouldExcludeFile(path)`.

### SDK Call Parsing

Each language has a dedicated parser:

- **Go** — Reuses `parseResourceGoFile` from the Terraform overlay pipeline. Matches `conn.Method(`, `client.Method(`, `svc.Method(` patterns.
- **Java** — Parses AWS SDK for Java v2 patterns (client method calls on service clients).
- **Python** — Parses boto3 `client()` and `resource()` method calls.
- **TypeScript** — Parses AWS SDK v3 `new XxxCommand()` patterns and v2-style `service.method()` calls.

**Implementation**: `parsers/java-sdk-parser.ts`, `parsers/python-sdk-parser.ts`, `parsers/typescript-sdk-parser.ts`.

### Terraform Resource Block Extraction

`.tf` files are parsed to extract `resource` block type declarations:

```hcl
resource "aws_s3_bucket" "example" {
  ...
}
```

The parser extracts the resource type string (e.g., `aws_s3_bucket`).

**Implementation**: `parsers/terraform-template-parser.ts`.

### CloudFormation Template Detection

YAML and JSON files are checked for the presence of a `Resources` key (either `"Resources"` in JSON or `Resources:` in YAML). If detected, the file is parsed as a CloudFormation template and all resource type names (e.g., `AWS::S3::Bucket`) are extracted from the `Resources` section.

**Implementation**: `parsers/cfn-template-parser.ts`.

### Processing Pipeline

The `RepositoryAnalyzer` class orchestrates the full analysis:

1. Fetches the repository file tree using the GitHub Trees API (single recursive call)
2. Classifies and filters files, sorting by language priority (Go → Java → Python → TypeScript, then infrastructure files)
3. Fetches file contents concurrently (max 15 simultaneous requests)
4. Routes each file to its appropriate parser
5. Aggregates results into a `CapabilitySet`

A 50-second timeout cutoff ensures the Lambda completes within its 60-second limit. If the timeout is reached, partial results are returned with metadata indicating how many files were processed.

**Implementation**: `parsers/repository-analyzer.ts` class `RepositoryAnalyzer`.

---

## Data Refresh Cadence

### Capability Data

Capability data (regions, services, API operations, CloudFormation resources) refreshes **every 24 hours** from the S3 Access Point. The `DataFetch Lambda` runs on a schedule, fetches data from all configured source folders, merges across folders (deduplicating by ID), and writes the combined results to the website S3 bucket.

The sync can be disabled via the `dataSyncEnabled` toggle in sync settings. Manual invocations (with `source: 'manual'`) always proceed regardless of the toggle.

### Terraform Overlay and Classic API Mapping

The Terraform overlay (AWSCC mappings) and classic API mapping (resource-to-operation mappings) are **regenerated when the DataFetch Lambda runs with the overlay enabled**. This happens as part of the same scheduled execution:

1. DataFetch Lambda fetches and merges capability data from S3 Access Point
2. If `terraformOverlayEnabled` is true in sync settings and a GitHub token is available, it invokes the Terraform Overlay Lambda
3. The Overlay Lambda fetches the latest AWSCC schemas and classic AWS provider source from GitHub
4. Results are written to S3 alongside the capability data

This means the Terraform mapping data is as fresh as the last successful DataFetch Lambda execution where the overlay was enabled.

**Implementation**: `data-fetch-lambda-main.ts` (orchestration), `handler.ts` (overlay generation).

---

## Known Limitations

### 1. Parser Variable Scope

The Go source file parser only captures API operations called on variables named `conn`, `client`, or `svc`. Operations called on secondary service clients with different variable names (e.g., `ec2conn.DescribeSecurityGroups(`) are **not captured**. This means some multi-service resources may have incomplete operation lists.

The regex pattern is intentionally conservative to avoid false positives from non-SDK method calls on arbitrary objects.

### 2. Mapping Lag

The classic API mapping is regenerated from the latest `main` branch of `hashicorp/terraform-provider-aws` each time the DataFetch Lambda runs with the overlay enabled. There is an inherent lag between:

- A new resource being added to the Terraform provider
- The mapping being regenerated to include it

During this window, newly added resources will not appear in the Terraform AWS view.

### 3. Ambiguous Operation Tiebreaker

When an API operation name exists in multiple services (e.g., `TagResource` appears in many AWS services), the system uses the resource's declared primary service as a tiebreaker. If the primary service claims the operation, it wins. Otherwise, the first matching service in the index is used.

This heuristic is correct in the vast majority of cases but may occasionally misattribute an operation when:

- The operation genuinely belongs to a secondary service
- The primary service also happens to have an identically-named operation

### 4. AWSCC Reverse Naming

The AWSCC-to-CFN type conversion loses original casing during the lowercase step. For example, `awscc_ec2_instance` converts to `AWS::Ec2::Instance` instead of `AWS::EC2::Instance`. The system mitigates this by using the authoritative `typeName` field from the JSON schemas for forward lookups, and only falls back to the naming convention for display purposes.

### 5. Infrastructure Planning Timeout

Repository analysis has a 50-second processing cutoff. Very large repositories may not have all files analyzed. When this occurs, the system returns partial results with metadata indicating how many files were processed out of the total identified.

---

## Source File Reference

| Step                            | Source File                                                                           | Description                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Go source file parsing          | `source/lambda/terraform-overlay/classic-resource-parser.ts`                          | Regex-based extraction of SDK client method calls from Go files                          |
| Service package parsing         | `source/lambda/terraform-overlay/classic-service-package-parser.ts`                   | Extracts resource TypeNames and factory functions from `service_package_gen.go`          |
| SDK service name extraction     | `source/lambda/terraform-overlay/classic-resource-parser.ts`                          | Reads Go import paths to determine primary SDK service                                   |
| AWSCC schema parsing            | `source/lambda/terraform-overlay/awscc-parser.ts`                                     | Extracts `typeName` from JSON schema files, converts between naming conventions          |
| Overlay orchestration           | `source/lambda/terraform-overlay/handler.ts`                                          | Lambda handler coordinating AWSCC fetch, classic AWS derivation, and classic API mapping |
| Operation availability index    | `source/website/app/hooks/classic-api-availability-engine.ts`                         | Builds the `OperationAvailabilityIndex` and computes per-region availability             |
| Availability tree construction  | `source/website/app/hooks/classic-api-availability-engine.ts`                         | `buildAvailabilityTree` — attributes operations to services and builds the display tree  |
| File classification             | `source/lambda/services/infrastructure-planning/parsers/repository-analyzer.ts`       | `classifyFile` and `shouldExcludeFile` for infrastructure planning                       |
| Repository analysis             | `source/lambda/services/infrastructure-planning/parsers/repository-analyzer.ts`       | `RepositoryAnalyzer` class — full GitHub repo analysis pipeline                          |
| Java SDK parsing                | `source/lambda/services/infrastructure-planning/parsers/java-sdk-parser.ts`           | AWS SDK for Java v2 method call extraction                                               |
| Python SDK parsing              | `source/lambda/services/infrastructure-planning/parsers/python-sdk-parser.ts`         | boto3 client/resource method call extraction                                             |
| TypeScript SDK parsing          | `source/lambda/services/infrastructure-planning/parsers/typescript-sdk-parser.ts`     | AWS SDK v3 Command pattern and v2-style call extraction                                  |
| Terraform template parsing      | `source/lambda/services/infrastructure-planning/parsers/terraform-template-parser.ts` | HCL resource block type extraction                                                       |
| CloudFormation template parsing | `source/lambda/services/infrastructure-planning/parsers/cfn-template-parser.ts`       | CloudFormation `Resources` section parsing                                               |
| Data fetch orchestration        | `source/lambda/data-fetch-lambda-main.ts`                                             | Scheduled data sync, overlay invocation, S3 writes                                       |
| Plan processing                 | `source/lambda/services/infrastructure-planning/plan-processor.ts`                    | Routes uploaded templates and GitHub repos to appropriate parsers                        |
