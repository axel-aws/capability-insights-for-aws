# Infrastructure Plan to Capabilities filter connection is invisible

**Severity:** High
**Category:** Feature Request
**Page:** /infrastructure-planning and /
**Component:** source/website/app/pages/infrastructure-planning/plan-detail-page.tsx, source/website/app/pages/capability-by-region.tsx

## Problem

Infrastructure Planning creates plans that become available as filters in the Capabilities by Region views, but this connection is completely invisible to users. After creating a plan, there is no guidance saying "Your plan is now available as a filter on the Capabilities by Region page." Users have no way to discover that these two features are connected or that the primary value of creating a plan is to filter the main availability table to just their services.

The workflow should be: Upload template → Extract services → Filter availability table by those services → Understand regional gaps. But the UI presents these as two disconnected features.

## Screenshot

N/A - this is a missing feature/guidance issue.

## Fix Instructions

1. **Plan detail page (after creation success):** Add a Cloudscape `Alert` component with `type="success"` at the top of the plan detail page after a plan is first created:
   - Header: "Plan created successfully"
   - Content: "Your infrastructure services are now available as a filter on the Capabilities by Region page."
   - Action button: "View availability for your services" that navigates to `/` with the plan filter pre-applied (e.g., `/?plan={planId}`)

2. **Home page filter:** In the PropertyFilter component's `filteringProperties` array, add a new property:
   - Key: `infrastructurePlan`
   - Label: "Infrastructure Plan"
   - Operators: `["="]`
   - Values: dynamically populated from the list of existing plans
   - When applied, filter the table to only show services/resources that are in the selected plan's extracted capability set

3. **Infrastructure Planning list page:** Add descriptive text below the page header using a Cloudscape `Box` component:
   - Text: "Upload your infrastructure templates to filter the Capabilities by Region table by the services and resources you actually use. After creating a plan, use it as a filter on the home page to see regional availability for just your stack."

4. **Plan detail page "View in Capabilities" button:** Add a secondary action button in the plan detail header actions:
   - Label: "Filter Capabilities by Region"
   - onClick: Navigate to home page with this plan's filter pre-applied

**Acceptance Criteria:**
- [ ] After creating a new plan, a success alert is shown with a link to filter the home page by that plan
- [ ] The Capabilities by Region filter dropdown includes "Infrastructure Plan" as a filterable property
- [ ] Selecting a plan in the filter narrows the table to only show services/resources extracted from that plan
- [ ] The Infrastructure Planning list page explains the connection to the Capabilities by Region page
- [ ] Plan detail page has a "Filter Capabilities by Region" action button
