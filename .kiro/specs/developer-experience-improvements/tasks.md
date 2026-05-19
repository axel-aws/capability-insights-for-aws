# Implementation Plan: Developer Experience Improvements

## Overview

This implementation plan covers documentation, code decomposition, test consolidation, and in-app help panels for Capability Insights for AWS. The work is organized to allow documentation tasks to proceed in parallel while the component decomposition and help panel integration follow a sequential path. TypeScript is used throughout.

## Tasks

- [x] 1. Create architecture documentation
  - [x] 1.1 Create `docs/ARCHITECTURE.md` with system overview, data flow, Lambda topology, Terraform overlay pipeline, classic API availability engine, and key source file references
    - Include a Mermaid diagram illustrating data flow from S3 Access Point → DataFetch Lambda → Website Bucket → Frontend → API Lambda
    - Document VPC placement rationale for each Lambda (API Lambda inside VPC; DataFetch, Terraform Overlay, GitHub Fetch, IAM Policy Helper outside VPC)
    - Explain the OperationAvailabilityIndex and tree construction in `classic-api-availability-engine.ts`
    - Link to `docs/METHODOLOGY.md` for derivation details
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 2. Create API documentation
  - [x] 2.1 Create `docs/API.md` with route table, request/response examples, and error response format
    - Extract all routes from `api-lambda-main.ts` (both `registerRoute` and `registerParameterizedRoute` calls)
    - Group routes by domain: sync, stacks, analysis, policies, policy parts, sync settings, data utilities, infrastructure plans
    - Document parameterized routes with path parameter descriptions
    - Include standard error response shape from `ErrorResponse` class
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 2.2 Write property test for API route documentation completeness
    - **Property 1: API route documentation completeness**
    - Parse `api-lambda-main.ts` to extract all registered routes (via `registerRoute` and `registerParameterizedRoute`)
    - Verify each route's HTTP method and path appears in `docs/API.md`
    - **Validates: Requirements 2.2**

- [x] 3. Create methodology documentation
  - [x] 3.1 Create `docs/METHODOLOGY.md` explaining Terraform classic AWS resource mapping, operation-to-service attribution, AWSCC mapping, availability computation, infrastructure planning analysis, data refresh cadence, and known limitations
    - Explain Go source file parsing (regex patterns for `conn`/`client`/`svc` variables)
    - Explain `buildAvailabilityTree` and why the single `sdkService` field is not trusted
    - Document the deterministic AWSCC naming convention
    - Explain AND-logic for availability computation
    - Document known limitations (parser variable scope, mapping lag, ambiguous operation tiebreaker)
    - Reference specific source files: `classic-resource-parser.ts`, `classic-api-availability-engine.ts`, `handler.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [x] 4. Create data model documentation
  - [x] 4.1 Create `docs/DATA_MODEL.md` documenting JSON file shapes, TypeScript interfaces, transformations, plans data, and CSV files
    - Document each file: `regions.json`, `products.json`, `apis.json`, `cfn_resources.json`, `terraform_overlay.json`, `terraform_classic_api_mapping.json`, `sync-metadata.json`
    - Include top-level JSON structure, corresponding TypeScript interface in `source/shared/types/`, and truncated examples
    - Explain DataFetch Lambda transformations (merge across source folders, deduplication, format conversion)
    - Document `data/plans/{planId}/capability-set.json` structure
    - Document CSV file relationship to JSON counterparts
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [x] 5. Checkpoint - Ensure documentation builds correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Decompose Capability By Region page into per-tab components
  - [x] 6.1 Create `HelpPanelContext` in `source/website/app/contexts/help-panel-context.tsx`
    - Implement `HelpPanelContextValue` interface with `setToolsContent` and `setToolsOpen`
    - Create provider component that manages `toolsOpen` and `toolsContent` state
    - Integrate provider into the app shell (`AppShell` or equivalent layout component) so it feeds `AppLayout`'s `tools` and `toolsOpen` props
    - _Requirements: 7.1, 7.7_

  - [x] 6.2 Create `ServicesAndFeaturesTab` component at `source/website/app/components/tabs/ServicesAndFeaturesTab.tsx`
    - Accept `SharedTabProps` + `productRows` + `downloadUrls` as props
    - Move services/features `AvailabilityTable` rendering (including `nameCell` with homepage links and type badges) from `capability-by-region.tsx`
    - _Requirements: 3.1, 3.6_

  - [x] 6.3 Create `ApiOperationsTab` component at `source/website/app/components/tabs/ApiOperationsTab.tsx`
    - Accept `SharedTabProps` + `apiRows` + `classicApi` + `apiViewMode` + `onApiViewModeChange` + `downloadUrls` as props
    - Move `ApiViewSelector`, both API operations and Terraform AWS `AvailabilityTable` renderings, `terraformFilteringFunction` memo, `getResourceMissingApis` memo, `MissingApiPopover` integration, and error flashbar from `capability-by-region.tsx`
    - Add info icon button in Terraform AWS view header that triggers `HelpPanelContext` with `TerraformAwsHelpPanel` content
    - _Requirements: 3.2, 3.5, 3.6, 7.1_

  - [x] 6.4 Create `CfnResourcesTab` component at `source/website/app/components/tabs/CfnResourcesTab.tsx`
    - Accept `SharedTabProps` + `cfnRows` + `overlay` + `downloadUrls` as props
    - Move `ViewSelector`, `AvailabilityTable` with translated rows and Terraform Registry links, and error flashbar from `capability-by-region.tsx`
    - Add info icon button in header that triggers `HelpPanelContext` with `CfnResourcesHelpPanel` content
    - _Requirements: 3.3, 3.5, 3.6, 7.7_

  - [x] 6.5 Refactor `capability-by-region.tsx` to compose tab components
    - Keep shared data loading (`useEffect`), `useTerraformOverlay`, `useClassicApiAvailability`, and `apiViewMode` state at page level
    - Replace inline tab content with `ServicesAndFeaturesTab`, `ApiOperationsTab`, and `CfnResourcesTab` components
    - Stat cards compute counts from shared data (`productRows`, `classicApi.rows`/`apiRows` based on `apiViewMode`, `translatedCfnRows`)
    - Verify no tab-specific filtering logic, custom filtering functions, or view-mode state remains in the parent
    - _Requirements: 3.4, 3.5, 3.7_

  - [x] 6.6 Write unit tests for tab components
    - Test `ServicesAndFeaturesTab` renders product rows and passes correct props
    - Test `ApiOperationsTab` renders both sub-views, info icon appears in Terraform AWS mode
    - Test `CfnResourcesTab` renders with overlay, info icon appears, ViewSelector toggles
    - Test parent page composes tabs and stat cards receive correct data
    - _Requirements: 3.5_

- [x] 7. Checkpoint - Ensure decomposition preserves all functionality
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Help Panel components
  - [x] 8.1 Create `TerraformAwsHelpPanel` at `source/website/app/components/help/TerraformAwsHelpPanel.tsx`
    - Explain that required API operations are derived from HashiCorp Terraform AWS provider source code
    - Explain AND-logic: "Available" only when ALL required operations are available
    - Explain operation-to-service attribution via authoritative API data
    - Explain data refresh cadence and tree hierarchy (Resource → SDK Service → API Operation)
    - Keep content under 300 words
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_

  - [x] 8.2 Create `CfnResourcesHelpPanel` at `source/website/app/components/help/CfnResourcesHelpPanel.tsx`
    - Explain AWSCC naming convention mapping
    - Explain how classic AWS provider types are mapped via the overlay
    - Explain how resource availability is determined from authoritative data
    - Keep content under 300 words
    - _Requirements: 7.7, 7.8_

  - [x] 8.3 Write unit tests for Help Panel components
    - Test `TerraformAwsHelpPanel` mentions required topics and word count < 300
    - Test `CfnResourcesHelpPanel` mentions required topics and word count < 300
    - _Requirements: 7.8_

- [x] 9. Consolidate test file placement
  - [x] 9.1 Move `source/lambda/analyze-route.test.ts` to `source/lambda/routes/analyze-route.test.ts` and update import paths
    - Change `'./routes/analyze-route'` to `'./analyze-route'`
    - Update any other relative imports (e.g., `'./types/api'` → `'../types/api'`)
    - _Requirements: 4.1, 4.3, 4.4_

  - [x] 9.2 Move `source/lambda/usage-route.test.ts` to `source/lambda/routes/usage-route.test.ts` and update import paths
    - Change `'./routes/usage-route'` to `'./usage-route'`
    - Update any other relative imports (e.g., `'./types/api'` → `'../types/api'`)
    - _Requirements: 4.2, 4.3, 4.4_

- [x] 10. Update Contributing Guide and README
  - [x] 10.1 Add "Contributing a new feature" section to `CONTRIBUTING.md`
    - Add numbered checklist: shared types → service layer → route → register route in api-lambda-main → frontend client method → page component → navigation entry → tests
    - Include one-paragraph explanation for each step
    - Reference infrastructure planning or policy enforcer as a concrete example
    - Explain npm workspaces structure and how shared type changes propagate
    - Describe testing approach (Vitest, fast-check, co-location pattern)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 10.2 Add "Documentation" section to `README.md` with links to all docs
    - Add links to `docs/ARCHITECTURE.md`, `docs/METHODOLOGY.md`, `docs/API.md`, `docs/DATA_MODEL.md`
    - Include one-line description for each document
    - Add section to Table of Contents
    - Link to Contributing Guide's "Contributing a new feature" section from the Development section
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (API route documentation completeness)
- Documentation tasks (1, 2, 3, 4) are independent and can be parallelized
- The decomposition (task 6) is the most complex — it requires careful extraction of memos, hooks, and rendering logic
- Help panel components (task 8) depend on the `HelpPanelContext` created in task 6.1
- Test file moves (task 9) are simple but require verifying import path correctness
- The `useClassicApiAvailability` and `useTerraformOverlay` hooks are called at the page level (not inside tabs) because stat cards need their data regardless of active sub-view

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["2.2", "6.1", "9.1", "9.2"] },
    { "id": 2, "tasks": ["6.2", "6.3", "6.4", "8.1", "8.2"] },
    { "id": 3, "tasks": ["6.5", "8.3"] },
    { "id": 4, "tasks": ["6.6", "10.1", "10.2"] }
  ]
}
```
