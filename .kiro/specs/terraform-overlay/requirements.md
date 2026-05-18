# Requirements Document

## Introduction

The Terraform Overlay feature adds Terraform resource type naming support to the existing Capabilities by Region page. Users can switch between CloudFormation, Terraform AWS (classic provider), and Terraform AWSCC (Cloud Control provider) naming conventions to view the same underlying regional availability data through their preferred infrastructure-as-code lens.

The feature consists of a backend data pipeline that derives Terraform-to-CloudFormation mappings entirely from Terraform provider source code at fetch time, and a frontend "View by" selector that translates resource type labels based on the user's chosen naming convention.

**Key constraint:** No static mapping tables, curated lookup files, or hosted data are maintained in this repository. All mappings are derived dynamically from Terraform's open-source provider repositories during each scheduled fetch. This ensures mappings stay current automatically as providers evolve.

## Glossary

- **Overlay_Service**: The backend Lambda function responsible for fetching Terraform provider data and producing the mapping file
- **Mapping_Store**: The S3-hosted JSON file (`terraform_overlay.json`) containing Terraform-to-CloudFormation type mappings
- **View_Selector**: The frontend UI control that allows users to switch between naming conventions
- **Availability_Table**: The existing regional availability matrix component on the Capabilities by Region page
- **CFN_Type**: A CloudFormation resource type identifier in the format `AWS::{Service}::{Resource}`
- **AWSCC_Type**: A Terraform AWSCC provider resource type in the format `awscc_{service}_{resource}`
- **Classic_AWS_Type**: A Terraform classic AWS provider resource type in the format `aws_{service}_{resource}`
- **Naming_Convention**: One of the three supported resource type label formats (CloudFormation, Terraform AWS, Terraform AWSCC)
- **Unmapped_Resource**: A Terraform resource type that has no corresponding CloudFormation type

## Requirements

### Requirement 1: Scheduled Terraform Mapping Data Fetch

**User Story:** As a platform operator, I want the system to automatically fetch and derive mappings from Terraform provider source code on a schedule, so that the mapping data stays current without any manually maintained lookup tables.

#### Acceptance Criteria

1. WHEN the scheduled trigger fires, THE Overlay_Service SHALL fetch AWSCC provider schema filenames directly from the `hashicorp/terraform-provider-awscc` GitHub repository at path `internal/service/cloudformation/schemas/`
2. WHEN the scheduled trigger fires, THE Overlay_Service SHALL fetch classic AWS provider source code from the `hashicorp/terraform-provider-aws` GitHub repository and parse `@SDKResource` annotations to derive CFN type mappings
3. THE Overlay_Service SHALL NOT rely on any static mapping tables, curated lookup files, or manually maintained data — all mappings SHALL be derived from provider source code at fetch time
4. WHEN the Overlay_Service has processed both providers, THE Overlay_Service SHALL write a `terraform_overlay.json` file to the website S3 bucket at path `data/json/terraform_overlay.json`
5. IF the GitHub API is unreachable, THEN THE Overlay_Service SHALL log the error and retain the previously generated mapping file
6. WHEN the Overlay_Service completes successfully, THE Overlay_Service SHALL record the fetch timestamp and provider commit SHAs in the mapping file metadata

### Requirement 2: AWSCC Provider Type Mapping

**User Story:** As a developer using the AWSCC Terraform provider, I want to see resource types labeled in AWSCC naming format, so that I can find resources using the names I use in my Terraform configurations.

#### Acceptance Criteria

1. WHEN processing an AWSCC schema filename, THE Overlay_Service SHALL derive the CFN_Type by replacing underscores with `::` and prepending `AWS::` (e.g., `AWS_S3_Bucket.json` becomes `AWS::S3::Bucket`)
2. WHEN processing an AWSCC schema filename, THE Overlay*Service SHALL derive the AWSCC_Type by lowercasing and prefixing with `awscc*`(e.g.,`AWS_S3_Bucket.json`becomes`awscc_s3_bucket`)
3. THE Overlay_Service SHALL produce a mapping entry for each schema file that links the AWSCC_Type to its corresponding CFN_Type
4. FOR ALL valid AWSCC schema filenames, parsing the filename into a CFN_Type and then converting that CFN_Type back to an AWSCC_Type SHALL produce the original AWSCC_Type (round-trip property)

### Requirement 3: Classic AWS Provider Type Mapping

**User Story:** As a developer using the classic Terraform AWS provider, I want to see resource types labeled in classic AWS naming format, so that I can cross-reference regional availability with my existing Terraform configurations.

#### Acceptance Criteria

1. WHEN processing classic AWS provider source code, THE Overlay_Service SHALL parse `@SDKResource` annotations from Go source files to extract the Terraform resource name and its corresponding CFN_Type
2. WHEN a `@SDKResource` annotation includes a CloudFormation type reference, THE Overlay_Service SHALL use that as the authoritative CFN_Type mapping
3. WHEN a classic AWS resource's source file contains no CFN_Type annotation, THE Overlay_Service SHALL mark the resource as unmapped rather than guessing
4. THE Overlay_Service SHALL NOT use any static lookup table or curated mapping file — all classic AWS provider mappings SHALL be derived from parsing the provider's Go source code
5. THE Overlay_Service SHALL produce mappings for all resource types discoverable in the classic AWS provider source

### Requirement 4: Mapping File Schema

**User Story:** As a frontend developer, I want the mapping file to have a well-defined schema, so that I can reliably consume it for label translation.

#### Acceptance Criteria

1. THE Mapping_Store SHALL contain a top-level `metadata` object with fields for `generatedAt` timestamp, `awsccProviderCommitSha`, `classicAwsProviderCommitSha`, `awsccResourceCount`, and `classicAwsResourceCount`
2. THE Mapping_Store SHALL contain an `awscc` array where each entry includes `terraformType` and `cfnType`
3. THE Mapping_Store SHALL contain a `classicAws` array where each entry includes `terraformType` and `cfnType` (nullable for unmapped resources)
4. THE Mapping_Store SHALL be valid JSON parseable by the frontend without transformation
5. FOR ALL entries in the Mapping_Store, serializing the mapping file to JSON and parsing it back SHALL produce an equivalent data structure (round-trip property)

### Requirement 5: View Selector UI Control

**User Story:** As a user of the Capabilities by Region page, I want a "View by" control that lets me switch between CloudFormation, Terraform AWS, and Terraform AWSCC naming conventions, so that I can view availability data using my preferred resource type format.

#### Acceptance Criteria

1. THE View_Selector SHALL display three options: "CloudFormation" (default), "Terraform AWS", and "Terraform AWSCC"
2. WHEN the page loads, THE View_Selector SHALL default to the "CloudFormation" naming convention
3. WHEN the user selects a Naming_Convention, THE Availability_Table SHALL update resource type labels to reflect the selected convention without a full page reload
4. WHILE the Mapping_Store is loading, THE View_Selector SHALL be disabled and display a loading indicator
5. IF the Mapping_Store fails to load, THEN THE View_Selector SHALL remain disabled and THE Availability_Table SHALL display CloudFormation names with an error notification

### Requirement 6: Resource Type Label Translation

**User Story:** As a user viewing the availability matrix, I want resource type labels to accurately reflect the selected naming convention, so that I can identify resources using familiar terminology.

#### Acceptance Criteria

1. WHEN "CloudFormation" is selected, THE Availability_Table SHALL display resource types in CFN_Type format (e.g., `AWS::S3::Bucket`)
2. WHEN "Terraform AWSCC" is selected, THE Availability_Table SHALL display resource types in AWSCC_Type format (e.g., `awscc_s3_bucket`)
3. WHEN "Terraform AWS" is selected, THE Availability_Table SHALL display resource types in Classic_AWS_Type format (e.g., `aws_s3_bucket`)
4. WHEN a CFN_Type has no corresponding Terraform type for the selected convention, THE Availability_Table SHALL hide that resource from the table
5. WHEN a Terraform type has no corresponding CFN_Type (Unmapped_Resource), THE Availability_Table SHALL display the resource with an "Unknown availability" indicator in all region columns

### Requirement 7: Cross-Convention Search

**User Story:** As a user searching for a resource, I want search to match across all three naming conventions regardless of which view is active, so that I can find resources without knowing the exact name format.

#### Acceptance Criteria

1. WHEN the user enters a search query, THE Availability_Table SHALL match against CloudFormation, Terraform AWS, and Terraform AWSCC type names simultaneously
2. WHEN a search matches a resource via a non-active naming convention, THE Availability_Table SHALL include that resource in the filtered results
3. WHEN the user searches for a partial term (e.g., "s3" or "bucket"), THE Availability_Table SHALL return all resources where any naming convention contains the search term as a substring (case-insensitive)
4. THE Availability_Table SHALL display matched resources using the currently selected Naming_Convention labels regardless of which convention matched the search

### Requirement 8: Unmapped Resource Handling

**User Story:** As a user viewing Terraform resources, I want to see resources that exist in Terraform but have no CloudFormation equivalent, so that I have a complete picture of the Terraform provider coverage.

#### Acceptance Criteria

1. WHEN "Terraform AWS" or "Terraform AWSCC" is selected, THE Availability_Table SHALL include Unmapped_Resources that have no CFN_Type association
2. WHEN displaying an Unmapped_Resource, THE Availability_Table SHALL show a distinct visual indicator (e.g., "No CFN mapping") in place of availability status cells
3. WHEN "CloudFormation" is selected, THE Availability_Table SHALL exclude resources that exist only in Terraform providers and have no CFN_Type
4. THE Availability_Table SHALL allow users to filter or sort by mapping status to separate mapped from unmapped resources

### Requirement 9: Statistics Update

**User Story:** As a user, I want the summary statistics on the page to reflect the currently selected naming convention, so that resource counts are accurate for my chosen view.

#### Acceptance Criteria

1. WHEN the user changes the Naming_Convention via the View_Selector, THE Availability_Table statistics card SHALL update the resource count to reflect the number of resources visible in the selected convention
2. WHEN "Terraform AWS" is selected, THE statistics card SHALL display the count of classic AWS provider resources (including unmapped)
3. WHEN "Terraform AWSCC" is selected, THE statistics card SHALL display the count of AWSCC provider resources
4. WHEN "CloudFormation" is selected, THE statistics card SHALL display the count of CloudFormation resource types (existing behavior)

### Requirement 10: Data Freshness and Sync

**User Story:** As a platform operator, I want the Terraform mapping data to sync alongside the existing capability data, so that all data stays consistent and up to date.

#### Acceptance Criteria

1. WHEN the existing data-fetch Lambda runs, THE Overlay_Service SHALL also execute to refresh the Terraform mapping data
2. WHEN the Overlay_Service completes, THE sync metadata SHALL include the Terraform overlay generation timestamp
3. IF the Overlay_Service fails while the main data sync succeeds, THEN THE sync metadata SHALL report the overlay error without blocking the primary data refresh
4. THE Overlay_Service SHALL complete execution within 60 seconds to stay within Lambda timeout constraints
