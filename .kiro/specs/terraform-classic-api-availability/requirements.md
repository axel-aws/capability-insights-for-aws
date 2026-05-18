# Requirements Document

## Introduction

The Terraform AWS (Classic) API Availability feature adds a "Terraform AWS" view to the API Operations tab on the Capability by Region page. When toggled on, it re-groups the existing API operations data under Terraform resource names, showing whether each classic Terraform AWS provider resource will work in a given region based on the availability of its underlying SDK API operations.

The classic Terraform AWS provider (`hashicorp/terraform-provider-aws`) calls AWS APIs directly — it does NOT go through CloudFormation. Each Terraform resource (e.g., `aws_s3_bucket`) depends on one or more SDK API operations (e.g., `s3:CreateBucket`, `s3:PutBucketPolicy`). If any required API is unavailable in a region, the Terraform resource won't work there.

**Key design principle:** The Terraform resource becomes a new parent level in the existing API operations tree hierarchy. The existing SDK service and operation data is re-grouped underneath it. Availability is computed as the AND of all child operations.

**Data source:** The mapping of Terraform resources to required API operations is extracted from the Terraform provider Go source code. This extraction runs during the scheduled sync (not on-demand), with sufficient compute time allocated. The provider source is stored in AWS (e.g., S3) — no runtime dependency on GitHub.

## Glossary

- **Classic_Terraform_Resource**: A resource type from the `hashicorp/terraform-provider-aws` provider (e.g., `aws_s3_bucket`)
- **Required_API**: An AWS SDK API operation that a Classic_Terraform_Resource calls to function (e.g., `s3:CreateBucket`)
- **Computed_Availability**: The per-region availability of a Classic_Terraform_Resource, derived as the AND of all its Required_APIs' availability
- **Resource_API_Mapping**: The data structure associating each Classic_Terraform_Resource with its Required_APIs
- **Mapping_Store**: The JSON file (`terraform_classic_api_mapping.json`) stored in S3 containing all Resource_API_Mappings
- **API_View_Selector**: The UI control on the API Operations tab that switches between "API Operations" and "Terraform AWS" views
- **Missing_API_Popover**: The UI element that explains which API operations are missing when a resource is unavailable in a region
- **Mapping_Pipeline**: The backend process that extracts Resource_API_Mappings from the Terraform provider source code, running during scheduled sync with extended compute time

## Requirements

### Requirement 1: Hierarchical Tree View

**User Story:** As a user viewing the Terraform AWS view, I want to see Terraform resources as top-level rows that expand to show the SDK services and API operations underneath, so that I can understand what APIs each resource depends on.

#### Acceptance Criteria

1. WHEN the "Terraform AWS" view is active, THE table SHALL display Classic_Terraform_Resources as top-level parent rows
2. WHEN a user expands a Classic_Terraform_Resource row, THE table SHALL show the SDK service(s) it depends on as intermediate rows
3. WHEN a user expands an SDK service row under a Terraform resource, THE table SHALL show the individual API operations as leaf rows
4. THE hierarchy SHALL be: Terraform Resource → SDK Service → API Operation (three levels)
5. EACH leaf API operation row SHALL display its actual per-region availability status from the existing API operations data
6. THE Terraform resource (top-level) row SHALL display a Computed_Availability per region that is the AND of all its child API operations

### Requirement 2: Computed Availability (AND Logic)

**User Story:** As a user, I want to see at a glance whether a Terraform resource will work in a region, without having to expand and check each API individually.

#### Acceptance Criteria

1. WHEN all Required_APIs for a Classic_Terraform_Resource are available in a region, THE Computed_Availability SHALL be "Available"
2. WHEN one or more Required_APIs for a Classic_Terraform_Resource are unavailable in a region, THE Computed_Availability SHALL be "Unavailable"
3. WHEN a Classic_Terraform_Resource has no Required_APIs mapped (empty list), THE Computed_Availability SHALL be "Unknown" in all regions
4. FOR ALL Classic_Terraform_Resources and regions, the Computed_Availability SHALL be deterministic — the same inputs SHALL always produce the same output

### Requirement 3: Missing API Explanation

**User Story:** As a user seeing an "Unavailable" Terraform resource in a region, I want to understand which specific API operations are missing, so that I can understand the limitation without expanding the tree.

#### Acceptance Criteria

1. WHEN a Classic_Terraform_Resource has Computed_Availability "Unavailable" in a region, THE cell SHALL include a Missing_API_Popover trigger (info icon or similar)
2. WHEN the user activates the Missing_API_Popover, IT SHALL display the list of specific API operations that are unavailable in that region
3. THE Missing_API_Popover SHALL display each missing API in the format `{service}:{action}` (e.g., `s3:CreateBucket`)
4. WHEN multiple API operations are missing, THE Missing_API_Popover SHALL list all missing operations

### Requirement 4: API View Selector

**User Story:** As a user of the API Operations tab, I want to switch between the raw API operations view and the Terraform resource view, so that I can choose the perspective that's most useful to me.

#### Acceptance Criteria

1. THE API_View_Selector SHALL display two options: "API Operations" (default) and "Terraform AWS"
2. WHEN the page loads, THE API_View_Selector SHALL default to "API Operations" showing the existing table unchanged
3. WHEN the user selects "Terraform AWS", THE table SHALL switch to the hierarchical Terraform resource view
4. WHILE the Mapping_Store is loading, THE "Terraform AWS" option SHALL be disabled with a loading indicator
5. IF the Mapping_Store fails to load, THEN THE "Terraform AWS" option SHALL remain disabled and an error notification SHALL be displayed

### Requirement 5: Search and Filtering

**User Story:** As a user, I want to search for Terraform resources by name, so that I can quickly find the resource I'm interested in.

#### Acceptance Criteria

1. WHEN the "Terraform AWS" view is active, THE search/filter SHALL match against Terraform resource names (e.g., typing "s3_bucket" finds `aws_s3_bucket`)
2. THE search SHALL be case-insensitive and support partial substring matching
3. WHEN a search matches a Terraform resource, THE table SHALL show that resource and all its child SDK services and operations
4. THE search SHALL also match against SDK service names and API operation names within the Terraform resource hierarchy

### Requirement 6: Resource Registry Links

**User Story:** As a user viewing a Terraform resource, I want to quickly navigate to its official documentation on the Terraform Registry.

#### Acceptance Criteria

1. WHEN displaying a Classic_Terraform_Resource name, THE table SHALL render it as a hyperlink to the Terraform Registry
2. THE hyperlink SHALL point to `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/{resource_name_without_aws_prefix}`
3. THE hyperlink SHALL open in a new browser tab (external link behavior)

### Requirement 7: Resource-to-API Mapping Pipeline

**User Story:** As a platform operator, I want the system to automatically extract the mapping of Terraform resources to their required API operations from the provider source code, running during the scheduled sync.

#### Acceptance Criteria

1. THE Mapping_Pipeline SHALL extract Required_APIs for each Classic_Terraform_Resource by analyzing the Go source code of the `hashicorp/terraform-provider-aws` provider
2. THE Mapping_Pipeline SHALL run during the scheduled data sync (not on-demand), with sufficient compute time (up to 15 minutes)
3. THE Mapping_Pipeline SHALL NOT depend on GitHub at runtime — the provider source SHALL be stored in AWS (e.g., S3 bucket or included in the deployment package)
4. WHEN the Mapping_Pipeline completes, IT SHALL write `terraform_classic_api_mapping.json` to the website S3 bucket at path `data/json/terraform_classic_api_mapping.json`
5. IF the Mapping_Pipeline fails, IT SHALL log the error and retain the previously generated mapping file
6. THE Mapping_Pipeline SHALL identify SDK API calls by parsing Go source patterns (e.g., `conn.CreateBucket`, `client.PutObject`, AWS SDK v2 client method calls)
7. THE Mapping_Pipeline SHALL record metadata including generation timestamp, provider version, and total resource count

### Requirement 8: Mapping File Schema

**User Story:** As a frontend developer, I want the mapping file to have a well-defined schema, so that I can reliably consume it for availability computation.

#### Acceptance Criteria

1. THE Mapping_Store SHALL contain a `metadata` object with `generatedAt`, `providerVersion`, and `resourceCount`
2. THE Mapping_Store SHALL contain a `resources` array where each entry includes `terraformType` (string), `sdkService` (string matching the API operations data service name), and `requiredApis` (array of action name strings)
3. THE `sdkService` field SHALL match the SDK service identifier used in the existing API operations data so the frontend can cross-reference
4. THE Mapping_Store SHALL be valid JSON parseable by the frontend without transformation

### Requirement 9: Statistics Display

**User Story:** As a user, I want to see summary statistics for the Terraform AWS view.

#### Acceptance Criteria

1. WHEN the "Terraform AWS" view is active, THE statistics SHALL show the total count of Classic_Terraform_Resources
2. WHEN the "Terraform AWS" view is active, THE statistics SHALL show the count of distinct SDK services referenced
3. WHEN the "API Operations" view is active, THE statistics SHALL show the existing API operations statistics (unchanged)

### Requirement 10: Data Freshness

**User Story:** As a platform operator, I want the mapping data to stay current as the Terraform provider evolves.

#### Acceptance Criteria

1. WHEN the scheduled data sync runs, THE Mapping_Pipeline SHALL also execute to refresh the mapping data
2. IF the Mapping_Pipeline fails while the main data sync succeeds, THE sync metadata SHALL report the error without blocking the primary data refresh
3. THE sync metadata SHALL include the mapping generation timestamp when successful

### Requirement 11: Fix AWSCC Overlay to Read File Contents

**User Story:** As a platform operator, I want the AWSCC overlay to read the `typeName` field from inside the schema JSON files rather than deriving CFN types from filenames, so that the mapping is authoritative and not based on string manipulation.

#### Acceptance Criteria

1. THE AWSCC overlay Lambda SHALL fetch the content of each schema JSON file from the AWSCC provider repository
2. THE AWSCC overlay Lambda SHALL extract the `typeName` field from each JSON file as the authoritative CFN type (e.g., `"typeName": "AWS::S3::Bucket"`)
3. THE AWSCC overlay Lambda SHALL NOT derive CFN types from filename string manipulation
4. THE AWSCC overlay Lambda timeout SHALL be increased to accommodate fetching file contents (up to 5 minutes)
5. THE AWSCC overlay Lambda SHALL use a `GITHUB_TOKEN` for higher rate limits when fetching file contents
6. THE AWSCC Terraform type SHALL still be derived from the `typeName` field using the documented transformation (lowercase, replace `::` separators, prefix with `awscc_`)
