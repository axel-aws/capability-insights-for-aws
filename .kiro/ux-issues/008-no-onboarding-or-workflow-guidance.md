# No onboarding or workflow guidance for first-time users

**Severity:** Medium
**Category:** Feature Request
**Page:** / (landing page)
**Component:** source/website/app/pages/capability-by-region.tsx

## Problem

First-time users land on a dense data table with 160 services across 39 regions and no context. They don't know:
- What "Capability Insights for AWS" does
- What each section is for
- How the three main modules serve different use cases

The tool has three distinct, powerful capabilities, but their value is hidden behind an unexplained data table.

## Screenshot

See artifacts/homepage_loaded.png

## Fix Instructions

1. Add a dismissible welcome/overview section at the top of the home page, above the summary counter cards. Use a Cloudscape `Container` with `variant="default"` or an `Alert` with `type="info"` and `dismissible={true}`:

   ```
   Header: "Welcome to Capability Insights for AWS"
   
   Body: "Understand what's available where across AWS. Browse regional 
   availability for every AWS service, API, and CloudFormation resource 
   type — then use that data to plan and protect your deployments."
   ```

2. Below the text, add three action cards in a Cloudscape `ColumnLayout` (columns={3}) showing the three independent capabilities:

   | Card 1 | Card 2 | Card 3 |
   |--------|--------|--------|
   | **Browse Availability** | **Plan Your Infrastructure** | **Enforce Region Safety** |
   | Search and filter availability data for 160+ AWS services across 39 regions | Upload a template or connect a repo to see where YOUR stack will work | Generate IAM policies that prevent calls to APIs unavailable in your target regions |
   | [Browse capabilities] (current page) | [Go to Infrastructure Planning] | [Go to Policy Enforcer] |

3. Store dismissal state in localStorage so returning users don't see it again:
   - Key: `capabilityInsights_onboardingDismissed`
   - On dismiss: set to `true`
   - On page load: check value, hide if `true`

4. Optionally add a "Show welcome guide" link in the help panel or footer for users who want to see it again

**Acceptance Criteria:**
- [ ] First-time visitors see a welcome section explaining the tool's purpose
- [ ] The three capabilities are presented as independent use cases (NOT a sequential pipeline)
- [ ] Each card links to the relevant section of the app
- [ ] The welcome section is dismissible
- [ ] Returning users (who dismissed it) don't see it again
- [ ] Users can re-access the guide from the help panel if needed
