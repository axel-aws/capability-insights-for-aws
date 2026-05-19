# Data Model

This document describes the shape of every data file produced and consumed by Capability Insights for AWS. It covers the JSON files in the Website Bucket, their corresponding TypeScript interfaces, the transformations applied by the DataFetch Lambda, the plans data used by Infrastructure Planning, and the CSV export files.

## Relationship Between S3 Access Point and Website Bucket

The **S3 Access Point** is the authoritative source of capability and availability data. It organizes data into source folders (configured via the `SOURCE_FOLDERS` environment variable), each containing a `v1/manifest.json` and data files under `v1/json/` and `v1/csv/`.

The **DataFetch Lambda** reads from the S3 Access Point, merges data across all valid source folders, deduplicates entries, and writes the combined results to the **Website Bucket** under `data/json/` and `data/csv/`. The Frontend reads directly from the Website Bucket for data display, while the API Lambda handles actions (plans, policies, sync).

```
S3 Access Point                    Website Bucket
├── folderA/                       ├── data/
│   └── v1/                        │   ├── json/
│       ├── manifest.json          │   │   ├── regions.json
│       ├── json/                  │   │   ├── products.json
│       │   ├── regions.json       │   │   ├── apis.json
│       │   ├── products.json      │   │   ├── cfn_resources.json
│       │   ├── apis.json          │   │   ├── terraform_overlay.json
│       │   └── cfn_resources.json │   │   └── terraform_classic_api_mapping.json
│       └── csv/                   │   ├── csv/
│           ├── regions.csv        │   │   ├── regions.csv
│           ├── products.csv       │   │   ├── products.csv
│           ├── apis.csv           │   │   └── cfn_resources.csv
│           └── cfn_resources.csv  │   ├── plans/{planId}/capability-set.json
├── folderB/                       │   └── sync-metadata.json
│   └── v1/...                     └── (static website assets)
```

---

## Data Files

### `data/json/regions.json`

**Description**: List of all AWS regions with their metadata (partition, opt-in status, long name).

**Top-level structure**: JSON array of `Region` objects.

**TypeScript interface**: `source/shared/types/capability/region.ts`

```typescript
export type RegionCode = string;

export interface Region {
  Region: RegionCode;
  RegionLongName: string;
  Partition: string;
  RegionStatus: string;
  RequireRegionOptIn: boolean;
}
```

**Truncated example**:

```json
[
  {
    "Region": "us-east-1",
    "RegionLongName": "US East (N. Virginia)",
    "Partition": "aws",
    "RegionStatus": "available",
    "RequireRegionOptIn": false
  },
  {
    "Region": "eu-west-1",
    "RegionLongName": "Europe (Ireland)",
    "Partition": "aws",
    "RegionStatus": "available",
    "RequireRegionOptIn": false
  }
]
```

**Deduplication key**: `Region` (region code)

---

### `data/json/products.json`

**Description**: AWS services and features with their regional availability and optional launch dates. Services can contain child features via the `childProducts` array.

**Top-level structure**: JSON array of `Product` objects.

**TypeScript interface**: `source/shared/types/capability/product.ts`

```typescript
export type ProductId = string;

export enum ProductType {
  SERVICE = 'SERVICE',
  FEATURE = 'FEATURE',
}

export interface Product {
  productId: ProductId;
  productName: string;
  productType: ProductType;
  homepage?: string;
  regionalAvailability: Record<RegionCode, AvailabilityStatus>;
  launchDates?: Record<RegionCode, string>;
  childProducts?: Product[];
}
```

**Truncated example**:

```json
[
  {
    "productId": "amazon-s3",
    "productName": "Amazon S3",
    "productType": "SERVICE",
    "homepage": "https://aws.amazon.com/s3/",
    "regionalAvailability": {
      "us-east-1": "Available",
      "eu-west-1": "Available",
      "ap-southeast-3": "Available"
    },
    "childProducts": [
      {
        "productId": "amazon-s3-glacier-instant-retrieval",
        "productName": "S3 Glacier Instant Retrieval",
        "productType": "FEATURE",
        "regionalAvailability": {
          "us-east-1": "Available",
          "eu-west-1": "Available"
        }
      }
    ]
  }
]
```

**Deduplication key**: `productId` (top-level), `productId` (child products)

---

### `data/json/apis.json`

**Description**: SDK services and their API operations with per-region availability. Each service groups its operations and optionally links to a product.

**Top-level structure**: JSON array of `ApiService` objects.

**TypeScript interface**: `source/shared/types/capability/api.ts`

```typescript
export interface ApiOperation {
  apiName: string;
  apiAction: string;
  homepage: string;
  regionalAvailability: Record<RegionCode, AvailabilityStatus>;
}

export interface ApiService {
  sdkServiceName: string;
  sdkServiceFullName: string;
  productID?: ProductId;
  productName?: string;
  apis: ApiOperation[];
}
```

**Truncated example**:

```json
[
  {
    "sdkServiceName": "s3",
    "sdkServiceFullName": "Amazon Simple Storage Service",
    "productID": "amazon-s3",
    "productName": "Amazon S3",
    "apis": [
      {
        "apiName": "s3:PutObject",
        "apiAction": "PutObject",
        "homepage": "https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html",
        "regionalAvailability": {
          "us-east-1": "Available",
          "eu-west-1": "Available"
        }
      }
    ]
  }
]
```

**Deduplication key**: `sdkServiceName` (top-level), `apiName` (operations)

---

### `data/json/cfn_resources.json`

**Description**: CloudFormation resource types organized by service, with per-region availability at the resource type, property, and configuration levels.

**Top-level structure**: JSON array of `CfnResource` objects (grouped by service).

**TypeScript interface**: `source/shared/types/capability/cfn.ts`

```typescript
export interface CfnResourceConfiguration {
  resourceConfigurationName: string;
  regionalAvailability: Record<RegionCode, AvailabilityStatus>;
}

export interface CfnResourceProperty {
  resourcePropertyName: string;
  resourceConfigurations: CfnResourceConfiguration[];
}

export interface CfnResourceType {
  resourceTypeName: string;
  resourceTypeHomepage: string;
  regionalAvailability: Record<RegionCode, AvailabilityStatus>;
  resourceProperties?: CfnResourceProperty[];
}

export interface CfnResource {
  serviceName: string;
  resourceTypes: CfnResourceType[];
}
```

**Truncated example**:

```json
[
  {
    "serviceName": "AWS::S3",
    "resourceTypes": [
      {
        "resourceTypeName": "AWS::S3::Bucket",
        "resourceTypeHomepage": "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-s3-bucket.html",
        "regionalAvailability": {
          "us-east-1": "Available",
          "eu-west-1": "Available"
        },
        "resourceProperties": [
          {
            "resourcePropertyName": "AccelerateConfiguration",
            "resourceConfigurations": [
              {
                "resourceConfigurationName": "AccelerationStatus",
                "regionalAvailability": {
                  "us-east-1": "Available"
                }
              }
            ]
          }
        ]
      }
    ]
  }
]
```

**Deduplication keys**: `serviceName` (top-level), `resourceTypeName` (resource types), `resourcePropertyName` (properties), `resourceConfigurationName` (configurations)

---

### `data/json/terraform_overlay.json`

**Description**: Mapping between CloudFormation resource type names and their Terraform equivalents (both AWSCC and classic AWS provider). Generated by the Terraform Overlay Lambda from HashiCorp provider source repositories.

**Top-level structure**: JSON object with `metadata`, `awscc`, and `classicAws` fields.

**TypeScript interface**: `source/shared/types/terraform-overlay.ts`

```typescript
export interface OverlayMetadata {
  generatedAt: string; // ISO 8601 timestamp
  awsccProviderCommitSha: string;
  classicAwsProviderCommitSha: string;
  awsccResourceCount: number;
  classicAwsResourceCount: number;
}

export interface AwsccMapping {
  terraformType: string; // e.g., "awscc_s3_bucket"
  cfnType: string; // e.g., "AWS::S3::Bucket"
}

export interface ClassicAwsMapping {
  terraformType: string; // e.g., "aws_s3_bucket"
  cfnType: string | null; // null for unmapped resources
}

export interface TerraformOverlayData {
  metadata: OverlayMetadata;
  awscc: AwsccMapping[];
  classicAws: ClassicAwsMapping[];
}
```

**Truncated example**:

```json
{
  "metadata": {
    "generatedAt": "2024-11-15T08:30:00.000Z",
    "awsccProviderCommitSha": "abc123def456",
    "classicAwsProviderCommitSha": "789ghi012jkl",
    "awsccResourceCount": 950,
    "classicAwsResourceCount": 1200
  },
  "awscc": [
    { "terraformType": "awscc_s3_bucket", "cfnType": "AWS::S3::Bucket" },
    { "terraformType": "awscc_lambda_function", "cfnType": "AWS::Lambda::Function" }
  ],
  "classicAws": [
    { "terraformType": "aws_s3_bucket", "cfnType": "AWS::S3::Bucket" },
    { "terraformType": "aws_instance", "cfnType": "AWS::EC2::Instance" }
  ]
}
```

**Note**: This file is not merged from source folders. It is generated directly by the Terraform Overlay Lambda and written to the Website Bucket.

---

### `data/json/terraform_classic_api_mapping.json`

**Description**: Mapping of classic AWS Terraform provider resources to their required SDK API operations. Used by the Classic API Availability Engine to determine per-region availability of Terraform resources based on whether their required API operations are available.

**Top-level structure**: JSON object with `metadata` and `resources` fields.

**TypeScript interface**: `source/shared/types/terraform-classic-api-mapping.ts`

```typescript
export interface ClassicApiMappingMetadata {
  generatedAt: string; // ISO 8601 timestamp
  providerCommitSha: string;
  resourceCount: number;
  serviceCount: number;
}

export interface ClassicApiServiceEntry {
  sdkService: string; // e.g., "elasticloadbalancingv2"
  requiredApis: string[]; // e.g., ["CreateLoadBalancer", "DescribeLoadBalancers"]
}

export interface ClassicApiResourceMapping {
  terraformType: string; // e.g., "aws_s3_bucket"
  sdkService: string; // Primary service (backward compat)
  requiredApis: string[]; // Primary service APIs (backward compat)
  registryPath: string; // e.g., "s3_bucket" (for Registry URL)
  services?: ClassicApiServiceEntry[]; // Full multi-service breakdown
}

export interface ClassicApiMappingData {
  metadata: ClassicApiMappingMetadata;
  resources: ClassicApiResourceMapping[];
}
```

**Truncated example**:

```json
{
  "metadata": {
    "generatedAt": "2024-11-15T08:35:00.000Z",
    "providerCommitSha": "abc123def456",
    "resourceCount": 1100,
    "serviceCount": 180
  },
  "resources": [
    {
      "terraformType": "aws_lb",
      "sdkService": "elasticloadbalancingv2",
      "requiredApis": ["CreateLoadBalancer", "DescribeLoadBalancers", "DeleteLoadBalancer"],
      "registryPath": "lb",
      "services": [
        {
          "sdkService": "elasticloadbalancingv2",
          "requiredApis": ["CreateLoadBalancer", "DescribeLoadBalancers", "DeleteLoadBalancer"]
        },
        {
          "sdkService": "ec2",
          "requiredApis": ["DescribeSecurityGroups"]
        }
      ]
    }
  ]
}
```

**Note**: This file is not merged from source folders. It is generated by the Terraform Overlay Lambda (classic API mapping step) and written to the Website Bucket.

---

### `data/sync-metadata.json`

**Description**: Metadata about the most recent data sync operation. Records success/failure status, timestamps, and overlay generation results.

**Top-level structure**: JSON object.

**TypeScript interface**: `source/shared/types/sync-metadata.ts`

```typescript
export interface SyncMetadata {
  lastSyncTime?: string; // ISO 8601, only set on success
  errors?: string[]; // Set when sync fails
  dataSyncSkipped?: boolean; // true when scheduled sync was skipped
  terraformOverlay?: {
    generatedAt: string;
    awsccResourceCount: number;
    classicAwsResourceCount: number;
  };
  terraformClassicApiMapping?: {
    generatedAt: string;
    resourceCount: number;
    serviceCount: number;
  };
  terraformOverlaySkipped?: boolean; // true when overlay was skipped
}
```

**Truncated example (successful sync)**:

```json
{
  "lastSyncTime": "2024-11-15T08:40:00.000Z",
  "terraformOverlay": {
    "generatedAt": "2024-11-15T08:35:00.000Z",
    "awsccResourceCount": 950,
    "classicAwsResourceCount": 1200
  },
  "terraformClassicApiMapping": {
    "generatedAt": "2024-11-15T08:35:00.000Z",
    "resourceCount": 1100,
    "serviceCount": 180
  }
}
```

**Truncated example (sync with errors)**:

```json
{
  "errors": ["No manifest found for folder: folderC", "Terraform overlay Lambda returned error: timeout"]
}
```

**Note**: This file is written directly by the DataFetch Lambda at the end of each sync run. It is not merged from source folders.

---

## Transformations

The **DataFetch Lambda** (`source/lambda/data-fetch-lambda-main.ts`) applies the following transformations when syncing data from the S3 Access Point to the Website Bucket:

### 1. Source Folder Validation

Each folder listed in the `SOURCE_FOLDERS` environment variable is validated by checking for a `v1/manifest.json` file. Folders without a manifest are skipped and logged as errors.

### 2. Multi-Folder Merge

For each file type (`regions`, `products`, `apis`, `cfn_resources`) and each format (`json`, `csv`), the Lambda fetches the file from every valid source folder and merges the results into a single output file.

### 3. JSON Deduplication

JSON files are merged using identity-based deduplication (`source/lambda/data-fetch/merge/merge-json.ts`):

| File                 | Top-level ID           | Nested deduplication                                                                                                                           |
| -------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `regions.json`       | `Region` (region code) | None                                                                                                                                           |
| `products.json`      | `productId`            | `childProducts` by `productId`                                                                                                                 |
| `apis.json`          | `sdkServiceName`       | `apis` by `apiName`                                                                                                                            |
| `cfn_resources.json` | `serviceName`          | `resourceTypes` by `resourceTypeName`, `resourceProperties` by `resourcePropertyName`, `resourceConfigurations` by `resourceConfigurationName` |

When two items share the same ID across source folders:

- **Scalars**: last-write-wins (later folder overwrites earlier)
- **Plain arrays** (without a deduplication config): concatenated
- **Configured child arrays**: recursively deduplicated by their own ID
- **Nested objects**: recursively deep-merged

### 4. CSV Merge

CSV files are merged by preserving the header from the first chunk and appending data rows from all subsequent chunks (`source/lambda/data-fetch/merge/merge-csv.ts`). Duplicate headers from later chunks are discarded. Empty rows are filtered out.

### 5. Terraform Overlay Generation

After the core data sync, the DataFetch Lambda optionally invokes the **Terraform Overlay Lambda** (if enabled in sync settings and a GitHub token is available). The overlay Lambda:

- Fetches AWSCC provider JSON schemas from `hashicorp/terraform-provider-awscc`
- Fetches classic AWS provider Go source from `hashicorp/terraform-provider-aws`
- Writes `terraform_overlay.json` and `terraform_classic_api_mapping.json` directly to the Website Bucket

### 6. Sync Metadata

At the end of each run, the Lambda writes `data/sync-metadata.json` recording:

- `lastSyncTime` on success (no errors)
- `errors` array if any step failed
- `terraformOverlay` and `terraformClassicApiMapping` metadata if the overlay ran
- `terraformOverlaySkipped` if the overlay was disabled or missing a token
- `dataSyncSkipped` if the scheduled sync was skipped due to the `dataSyncEnabled` toggle being off

---

## Plans Data

### `data/plans/{planId}/capability-set.json`

**Description**: The extracted capability data for an Infrastructure Plan. Generated when a user uploads a CloudFormation/Terraform template or provides a GitHub repository URL for analysis.

**Top-level structure**: JSON object.

**TypeScript interface**: `source/shared/types/infrastructure-planning/plan-configuration.ts`

```typescript
export interface CapabilitySet {
  /** CloudFormation resource types (e.g., "AWS::S3::Bucket"). */
  cfnResourceTypes: string[];
  /** Original Terraform resource types if source was Terraform (e.g., "aws_s3_bucket"). */
  terraformResourceTypes: string[];
  /** API operations extracted from source files (e.g., "s3:PutObject", "dynamodb:GetItem"). */
  apiOperations: string[];
  /** Service names derived from resource types (e.g., "Amazon S3"). */
  serviceNames: string[];
  /** Mapping of terraform type → CFN type for types that have a mapping. */
  terraformToCfnMapping: Record<string, string>;
  /** Property value matches extracted from the template. */
  propertyMatches?: Array<{
    serviceName: string;
    resourceTypeName: string;
    propertyName: string;
    value: string;
  }>;
  /** Indicates whether the analysis was terminated early due to timeout. */
  partialResult?: {
    isPartial: boolean;
    filesProcessed: number;
    totalFilesIdentified: number;
  };
}
```

**Truncated example**:

```json
{
  "cfnResourceTypes": ["AWS::S3::Bucket", "AWS::Lambda::Function", "AWS::DynamoDB::Table"],
  "terraformResourceTypes": [],
  "apiOperations": ["s3:PutObject", "s3:GetObject", "dynamodb:PutItem"],
  "serviceNames": ["Amazon S3", "AWS Lambda", "Amazon DynamoDB"],
  "terraformToCfnMapping": {},
  "propertyMatches": [
    {
      "serviceName": "Amazon DynamoDB",
      "resourceTypeName": "AWS::DynamoDB::Table",
      "propertyName": "BillingMode",
      "value": "PAY_PER_REQUEST"
    }
  ]
}
```

**Storage**: Each plan's capability set is stored at `data/plans/{planId}/capability-set.json` in the Website Bucket. The `planId` is a UUID generated when the plan is created. The plan's metadata (name, status, labels) is stored in DynamoDB, with the `capabilitySetKey` field pointing to this S3 object.

**Source types**: The capability set is populated differently depending on the plan's `sourceType`:

- **`cloudformation`**: Parses CloudFormation template YAML/JSON to extract resource types and property values
- **`terraform`**: Parses `.tf` files to extract resource blocks, then maps Terraform types to CFN types
- **`github`**: Analyzes an entire repository — classifies files by extension, parses SDK calls (Go, Java, Python, TypeScript), extracts `.tf` resource blocks, and detects CloudFormation templates

---

## CSV Files

The `data/csv/` directory contains CSV versions of the core JSON data files:

| CSV File                     | JSON Counterpart               | Description                                                               |
| ---------------------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `data/csv/regions.csv`       | `data/json/regions.json`       | Flat table of regions with columns for each field                         |
| `data/csv/products.csv`      | `data/json/products.json`      | Flattened products with one row per product-region combination            |
| `data/csv/apis.csv`          | `data/json/apis.json`          | Flattened API operations with one row per operation-region combination    |
| `data/csv/cfn_resources.csv` | `data/json/cfn_resources.json` | Flattened CFN resource types with one row per resource-region combination |

CSV files serve as an export format for users who want to analyze availability data in spreadsheet tools or import it into other systems. They contain the same underlying data as their JSON counterparts but in a tabular format suitable for tools like Excel, Google Sheets, or pandas.

**Merge behavior**: CSV files from multiple source folders are merged by preserving the header row from the first source and appending all data rows from subsequent sources. No deduplication is applied at the CSV level — the assumption is that source folders produce non-overlapping rows, or that downstream consumers handle duplicates.

**Download**: The Frontend provides download links for CSV files via the export functionality in each availability table.
