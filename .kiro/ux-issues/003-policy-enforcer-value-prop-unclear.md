# Policy Enforcer value proposition is not communicated

**Severity:** High
**Category:** Feature Request
**Page:** /policy-enforcer
**Component:** source/website/app/pages/policy-enforcer/policy-enforcer-page.tsx

## Problem

The Policy Enforcer's value proposition is not communicated anywhere in the UI. Users don't understand WHY they'd create a policy or what problem it solves.

The real value is: "Proactively protect against region expansion failures by generating IAM policies that prevent workloads from calling APIs that aren't available in your target regions. Attach these policies to IAM roles so you discover region gaps at policy-attachment time, not at deploy time."

Instead, the page just shows a table (empty for new users) with a "Create Policy" button and no explanation of what policies do, why they're useful, or how they protect against deployment failures.

## Screenshot

See artifacts/policy_enforcer_empty.png

## Fix Instructions

1. **Add a page-level description** below the "Policy Enforcer" header, above the table. Use the same pattern as the Capabilities by Region page which has descriptive text. Add a Cloudscape `Box` or `TextContent` component:
   - Text: "Generate IAM policies that protect your workloads from calling APIs unavailable in your target regions. Attach these to IAM roles to proactively prevent region expansion failures before they happen at deploy time."

2. **Update the empty state** in the table when no policies exist. Replace the generic "No policy configurations" message with:
   - Header: "No policies yet"
   - Body: "Create a policy to generate an IAM allow-list scoped to your target regions. When attached to a role, it prevents your workload from calling APIs that aren't available, catching region gaps before deployment."
   - CTA: "Create Policy" button (already exists)

3. **Add context in the Create Policy wizard Step 1:** Add a Cloudscape `Alert` with `type="info"` at the top of Step 1:
   - Content: "A policy generates an IAM allow-list based on which APIs are actually available in your selected regions. Attach it to an IAM role to prevent calls to unavailable APIs."

**Acceptance Criteria:**
- [ ] The Policy Enforcer page has a descriptive paragraph explaining what policies do and why they're valuable
- [ ] The empty state clearly communicates the protection-against-region-gaps use case
- [ ] Users understand before clicking "Create Policy" that the output is an attachable IAM policy for deployment safety
- [ ] The Create Policy wizard Step 1 includes brief contextual guidance about the use case
