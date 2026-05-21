# Region selection requires one-at-a-time picking with no bulk options

**Severity:** Medium
**Category:** Feature Request
**Page:** /policy-enforcer/create (Step 2)
**Component:** source/website/app/pages/policy-enforcer/create-policy-wizard.tsx

## Problem

Selecting regions in the policy wizard requires searching and clicking one region at a time. For users targeting 10-15 regions (common for multi-region deployments), this is tedious and error-prone. There are no bulk-select options, no region group shortcuts, and no "Select all" capability.

Common deployment patterns target groups of regions:
- All US commercial (us-east-1, us-east-2, us-west-1, us-west-2)
- All EU (eu-central-1, eu-west-1, eu-west-2, eu-west-3, eu-north-1, eu-south-1, eu-south-2, eu-central-2)
- All APAC (10+ regions)
- All commercial (37 non-ISO regions)

Currently each of these requires 4-37 individual search-and-click operations.

## Screenshot

N/A

## Fix Instructions

1. Above the existing multi-select combobox in Step 2, add a Cloudscape `SpaceBetween` section with `ButtonGroup` or inline `Button` components for region group shortcuts:
   ```
   Quick select: [All commercial] [US regions] [EU regions] [APAC regions] [GovCloud] [ISO]
   ```

2. Each button, when clicked, adds all regions in that group to the selected set (without removing existing selections)

3. Add a "Select all" / "Clear all" toggle at the top of the dropdown list

4. Region groupings:
   - **All commercial**: All regions with partition "aws" (37 regions)
   - **US regions**: us-east-1, us-east-2, us-west-1, us-west-2
   - **EU regions**: eu-central-1, eu-central-2, eu-north-1, eu-south-1, eu-south-2, eu-west-1, eu-west-2, eu-west-3
   - **APAC regions**: ap-east-1, ap-east-2, ap-northeast-1/2/3, ap-south-1/2, ap-southeast-1/2/3/4/5/6/7
   - **GovCloud**: us-gov-east-1, us-gov-west-1
   - **ISO**: us-iso-east-1, us-iso-west-1

5. Use the regions.json data (already loaded) to derive these groups from the `Partition` field

**Acceptance Criteria:**
- [ ] Region group shortcut buttons appear above the multi-select in Step 2
- [ ] Clicking "All commercial" selects all 37 commercial regions
- [ ] Clicking "US regions" adds the 4 US commercial regions to the selection
- [ ] Shortcuts are additive (clicking "US regions" then "EU regions" selects both groups)
- [ ] A "Clear all" option exists to reset selections
- [ ] Users can still search and individually add/remove regions after using shortcuts
