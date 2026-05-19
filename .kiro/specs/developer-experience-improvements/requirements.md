# Requirements Document

## Introduction

This feature covers improvements to the repository's developer experience, documentation, and code organization for Capability Insights for AWS. The goal is to make it easier for new contributors — especially new college graduates — to understand, navigate, and contribute to the codebase, and to help dashboard users trust the data by explaining how it's derived. The improvements are based on a comprehensive audit of the repository and focus on surfacing the system's core data flow (from S3 access point through the system) through clear documentation, decomposing monolithic components, consolidating test placement, and providing step-by-step contribution guides.

## Glossary

- **System**: The Capability Insights for AWS application, encompassing all workspaces (shared, lambda, constructs, website)
- **S3_Access_Point**: The AWS S3 access point that serves as the primary data source for all capability and availability information
- **DataFetch_Lambda**: The Lambda function (`data-fetch-lambda-main.ts`) that reads capability data from the S3 access point, merges data across source folders, and writes results to the website bucket
- **API_Lambda**: The Lambda function (`api-lambda-main.ts`) that runs inside the VPC, backs the API Gateway, and routes requests from the website
- **Website_Bucket**: The S3 bucket that hosts both the static website assets and the processed capability data (JSON/CSV)
- **Frontend**: The React dashboard built with Cloudscape Design System (`source/website`)
- **Terraform_Overlay_Pipeline**: The process that translates CloudFormation resource type names into Terraform naming conventions (AWSCC and classic AWS provider)
- **OperationAvailabilityIndex**: The data structure that maps sdkService → operationName → Set<availableRegions>, used to compute Terraform resource availability and attribute operations to services
- **Capability_By_Region_Page**: The main dashboard page (`capability-by-region.tsx`) containing three Cloudscape Tabs (Services and features, API operations, CloudFormation resources) with the API operations tab containing a sub-view toggle between "API Operations" and "Terraform AWS"
- **Architecture_Document**: The `docs/ARCHITECTURE.md` file explaining system data flow, Lambda topology, and key subsystems
- **Methodology_Document**: The `docs/METHODOLOGY.md` file explaining how data mappings are derived, aimed at both dashboard users and contributors
- **API_Document**: The `docs/API.md` file containing a route table with request/response examples for all REST endpoints
- **Data_Model_Document**: The `docs/DATA_MODEL.md` file documenting the shape of all data files produced and consumed by the system
- **Contributing_Guide**: The `CONTRIBUTING.md` file extended with a step-by-step checklist for adding new features
- **Help_Panel**: The Cloudscape HelpPanel component providing contextual methodology explanations to dashboard users

## Requirements

### Requirement 1: Architecture Documentation

**User Story:** As a new contributor, I want a comprehensive architecture document that explains how data flows from the S3 access point through the system, so that I can understand the system's design before making changes.

#### Acceptance Criteria

1. THE Architecture_Document SHALL exist at the path `docs/ARCHITECTURE.md`
2. THE Architecture_Document SHALL contain a data flow section explaining how data moves from the S3_Access_Point through the DataFetch_Lambda to the Website_Bucket and then to the Frontend
3. THE Architecture_Document SHALL contain a Lambda topology section explaining that the API_Lambda runs inside the VPC and that helper Lambdas (DataFetch_Lambda, Terraform Overlay Lambda, GitHub Fetch Lambda, IAM Policy Helper Lambda) run outside the VPC, including the rationale for each placement (internet access requirements vs VPC security)
4. THE Architecture_Document SHALL contain a section explaining the Terraform_Overlay_Pipeline, including how CloudFormation resource type names are translated to Terraform AWSCC and classic AWS provider naming conventions
5. THE Architecture_Document SHALL contain a section explaining the OperationAvailabilityIndex and how the resource → service → operation tree is built by cross-referencing the classic API mapping data with the authoritative API operations data
6. THE Architecture_Document SHALL include at least one Mermaid diagram illustrating the data flow from S3_Access_Point to Frontend
7. THE Architecture_Document SHALL reference specific source files for each subsystem described, so that readers can navigate directly to the implementation
8. THE Architecture_Document SHALL link to the Methodology_Document for details on how data mappings are derived

### Requirement 2: API Documentation

**User Story:** As a new contributor, I want a formalized API reference document with route tables and request/response examples, so that I can understand the REST API without reading through all route handler source code.

#### Acceptance Criteria

1. THE API_Document SHALL exist at the path `docs/API.md`
2. THE API_Document SHALL contain a route table listing every route registered in `api-lambda-main.ts`, including HTTP method, path, and a brief description
3. THE API_Document SHALL include request/response examples for each route, showing the expected JSON body structure for requests and the JSON response shape
4. THE API_Document SHALL document parameterized routes (routes with path parameters like `:policyId`, `:planId`, `:stackName`) with parameter descriptions
5. THE API_Document SHALL group routes by feature domain (sync, stacks, analysis, policies, policy parts, sync settings, data utilities, infrastructure plans)
6. THE API_Document SHALL document error response formats, including the standard error response shape returned by the API_Lambda

### Requirement 3: Decompose Capability By Region Page

**User Story:** As a contributor, I want the monolithic Capability_By_Region_Page split into per-tab components, so that I can work on one tab's logic without understanding the entire file.

#### Acceptance Criteria

1. WHEN the decomposition is complete, THE System SHALL have a `ServicesAndFeaturesTab.tsx` component that owns all rendering and state for the services and features tab content
2. WHEN the decomposition is complete, THE System SHALL have an `ApiOperationsTab.tsx` component that owns the `ApiViewSelector` toggle, the standard API operations view, and the Terraform AWS sub-view (including the `terraformFilteringFunction`, `getResourceMissingApis`, `useClassicApiAvailability` hook, and `MissingApiPopover` integration)
3. WHEN the decomposition is complete, THE System SHALL have a `CfnResourcesTab.tsx` component that owns the `ViewSelector` toggle, the `useTerraformOverlay` hook, and all rendering for the CloudFormation/Terraform AWSCC resources tab content
4. WHEN the decomposition is complete, THE Capability_By_Region_Page SHALL import and compose the three tab components and the stat cards without containing tab-specific filtering logic, custom filtering functions, or view-mode state
5. THE System SHALL preserve all existing functionality after decomposition, including tree-aware filtering in the Terraform AWS view, the API view mode toggle, the Terraform overlay convention toggle, missing API popovers, plan filter integration, and stat card counts
6. EACH tab component SHALL accept shared data as props (regions, loading state, raw data rows, download URLs) loaded once at the page level, avoiding duplicate data fetching
7. THE stat cards SHALL compute their row counts from the shared data arrays and any derived data (e.g., `classicApi.rows` for the Terraform AWS view count), without requiring tab-internal state to be lifted to the parent

### Requirement 4: Consolidate Test File Placement

**User Story:** As a contributor, I want test files co-located with their corresponding source files, so that I can find tests using the same navigation pattern used throughout the rest of the codebase.

#### Acceptance Criteria

1. WHEN the consolidation is complete, THE System SHALL have `analyze-route.test.ts` located in the `source/lambda/routes/` directory alongside its source file
2. WHEN the consolidation is complete, THE System SHALL have `usage-route.test.ts` located in the `source/lambda/routes/` directory alongside its source file
3. IF a test file import path references a relative module, THEN THE System SHALL update the import path to reflect the new file location
4. THE System SHALL pass all existing tests after the file moves without modification to test logic

### Requirement 5: Feature Methodology Documentation (Contributor-Facing)

**User Story:** As a contributor, I want a standalone methodology document that explains how each data transformation works at a technical level, so that I can understand the derivation logic when debugging or extending the system.

#### Acceptance Criteria

1. THE Methodology_Document SHALL exist at the path `docs/METHODOLOGY.md`
2. THE Methodology_Document SHALL explain how Terraform classic AWS resources (e.g., `aws_alb`) are mapped to their required API operations, including: that the Terraform Overlay Lambda parses Go source files from the `hashicorp/terraform-provider-aws` GitHub repository, that `service_package_gen.go` files are parsed to discover resource factory functions, that SDK client method calls (`conn.Method(`, `client.Method(`, `svc.Method(`) are extracted via regex, and that `extractSdkServiceName` reads Go import paths to determine the primary SDK service
3. THE Methodology_Document SHALL explain how operations are attributed to their correct service at display time: the frontend's `buildAvailabilityTree` function looks up each operation in the OperationAvailabilityIndex (built from the authoritative API data) to determine which service owns it, rather than trusting the single `sdkService` field from the mapping
4. THE Methodology*Document SHALL explain how AWSCC resources are mapped to CloudFormation resource types, including: that the mapping uses the `typeName` field from the AWSCC provider's JSON schema files fetched from `hashicorp/terraform-provider-awscc`, and that the naming convention is deterministic (`awscc*{service}\_{resource}`→`AWS::{Service}::{Resource}`)
5. THE Methodology_Document SHALL explain how the "Available" / "Not Available" status is computed for Terraform resources: a resource is "Available" in a region only if ALL of its required API operations are available in that region according to the authoritative API data from the S3_Access_Point
6. THE Methodology_Document SHALL explain how GitHub repository analysis works for Infrastructure Planning, including: file classification by extension, Go/Java/Python/TypeScript SDK call parsing, `.tf` resource block extraction, and `.yaml`/`.json` CloudFormation template detection
7. THE Methodology_Document SHALL document known limitations, including: that the parser only captures operations called on `conn`/`client`/`svc` variables (not secondary service clients like `ec2conn`), that the mapping is regenerated periodically and may lag behind provider releases, and that ambiguous operation names (e.g., `TagResource`) are attributed using the resource's declared primary service as a tiebreaker
8. THE Methodology_Document SHALL explain the data refresh cadence: capability data refreshes every 24 hours from the S3_Access_Point, and the Terraform overlay/classic API mapping is regenerated when the DataFetch Lambda runs with the overlay enabled
9. THE Methodology_Document SHALL reference the specific source files that implement each step (e.g., `classic-resource-parser.ts`, `classic-api-availability-engine.ts`, `handler.ts`)

### Requirement 6: Contributing a New Feature Guide

**User Story:** As a new contributor, I want a step-by-step checklist for adding a new feature end-to-end, so that I can follow a proven path without missing integration points.

#### Acceptance Criteria

1. THE Contributing_Guide SHALL contain a "Contributing a new feature" section with a numbered checklist
2. THE Contributing_Guide SHALL list the following steps in order: add shared types → add service layer → add route → register route in api-lambda-main → add frontend client method → add page component → add navigation entry → add tests
3. THE Contributing_Guide SHALL include a one-paragraph explanation for each step describing what to do and which files to modify
4. THE Contributing_Guide SHALL reference at least one existing feature (such as infrastructure planning or policy enforcer) as a concrete example to follow
5. THE Contributing_Guide SHALL explain the npm workspaces structure (`source/shared`, `source/lambda`, `source/constructs`, `source/website`) and how changes in shared types propagate to dependent workspaces
6. THE Contributing_Guide SHALL describe the testing approach, including the use of Vitest and fast-check for property-based testing, and the co-location pattern for test files

### Requirement 7: In-App Methodology Help Panel

**User Story:** As a dashboard user viewing the Terraform AWS view, I want an in-app explanation of how resource-to-API mappings are derived, so that I can trust the availability data without leaving the application.

#### Acceptance Criteria

1. THE Frontend SHALL display an info icon in the AvailabilityTable header area when the Terraform AWS sub-view is active (within the API operations tab), that opens a Help_Panel when clicked
2. THE Help_Panel SHALL explain that each Terraform resource's required API operations are derived from the HashiCorp Terraform AWS provider source code
3. THE Help_Panel SHALL explain that a resource is shown as "Available" in a region only when ALL of its required API operations are available in that region, and "Not Available" if any required operation is missing
4. THE Help_Panel SHALL explain that operations are attributed to their correct AWS service by cross-referencing against the authoritative API operations data (the same data shown in the API Operations view)
5. THE Help_Panel SHALL explain the data refresh cadence (mapping data is regenerated when the Terraform overlay sync runs; availability data refreshes every 24 hours)
6. THE Help_Panel SHALL include a brief explanation of the tree hierarchy: Resource → SDK Service → API Operation
7. THE Frontend SHALL display an info icon in the AvailabilityTable header area for the CloudFormation resources tab that opens a Help_Panel explaining: the AWSCC naming convention mapping, how classic AWS provider types are mapped via the overlay, and how resource availability is determined from the authoritative data
8. THE Help_Panel content SHALL be concise (under 300 words per panel) and written for a technical audience that understands AWS but not the system internals

### Requirement 8: Data Model Documentation

**User Story:** As a contributor, I want documentation of the data file shapes (JSON structures) produced and consumed by the system, so that I can understand what the S3 access point provides and how it's transformed.

#### Acceptance Criteria

1. THE Data_Model_Document SHALL exist at the path `docs/DATA_MODEL.md`
2. THE Data_Model_Document SHALL document the shape of each JSON data file in the Website_Bucket, including: `data/json/regions.json`, `data/json/products.json`, `data/json/apis.json`, `data/json/cfn_resources.json`, `data/json/terraform_overlay.json`, `data/json/terraform_classic_api_mapping.json`, and `data/sync-metadata.json`
3. FOR EACH data file, THE Data_Model_Document SHALL include: a description of what the file contains, the top-level JSON structure (array vs object), the TypeScript interface it corresponds to in `source/shared/types/`, and a truncated example showing 1-2 entries
4. THE Data_Model_Document SHALL explain the relationship between the raw data from the S3_Access_Point and the processed data in the Website_Bucket, including what transformations the DataFetch_Lambda applies (merging across source folders, deduplication, format conversion)
5. THE Data_Model_Document SHALL document the `data/plans/{planId}/capability-set.json` structure used by Infrastructure Planning
6. THE Data_Model_Document SHALL document the `data/csv/` files and how they relate to their JSON counterparts

### Requirement 9: README Links to Documentation

**User Story:** As a new visitor to the repository, I want the README to link to the architecture, API, and data model documentation, so that I can discover these resources without browsing the `docs/` folder.

#### Acceptance Criteria

1. THE README SHALL contain a "Documentation" section that links to `docs/ARCHITECTURE.md`, `docs/METHODOLOGY.md`, `docs/API.md`, and `docs/DATA_MODEL.md`
2. THE README Documentation section SHALL appear in the Table of Contents
3. THE README Documentation section SHALL include a one-line description of what each linked document covers
4. THE README SHALL link to the Contributing_Guide's "Contributing a new feature" section from the Development section
