# Policy stuck in "Pending" with no guidance on next steps

**Severity:** High
**Category:** Bug
**Page:** /policy-enforcer/:policyId
**Component:** source/website/app/pages/policy-enforcer/policy-detail-page.tsx

## Problem

After creating a policy, it enters "Pending" status with no guidance on what to do next. The user sees:
- Status: "Pending"
- Parts tab: "No policy parts available"
- No explanation of what "Pending" means or what action is required

The user doesn't know they need to click "Refresh" to generate the actual IAM policy JSON. The workflow dead-ends at creation. Users expect that creating a policy means the policy is generated, but instead they get an incomplete state with no path forward.

## Screenshot

See artifacts/policy_review_step6.png (shows the creation flow that leads to this state)

## Fix Instructions

**Option A (preferred): Auto-trigger refresh on creation**

1. In `source/website/app/pages/policy-enforcer/create-policy-wizard.tsx`, after the successful POST to create the policy, immediately call the refresh/generate endpoint for the newly created policy
2. Show a loading state on the detail page: "Generating your IAM policy..." with a Cloudscape `Spinner` or `ProgressBar`
3. When generation completes, transition to "Ready" status and show the policy parts

**Option B: Add prominent guidance when Pending**

1. In `policy-detail-page.tsx`, when `policy.status === 'Pending'`, render a Cloudscape `Alert` component:
   - `type="info"`
   - Header: "Policy generation required"
   - Content: "Your policy configuration is saved. Click 'Generate policy' to compute the IAM allow-list based on your selected regions and settings. This process typically takes a few seconds."
   - Action: `<Button variant="primary">Generate policy now</Button>` that triggers the refresh endpoint
2. After refresh completes, remove the alert and show the generated policy parts
3. Also update the "No policy parts available" message in the Parts tab to say: "Policy parts will appear here after generation. Click 'Generate policy' above to create them now."

**Acceptance Criteria:**
- [ ] After creating a policy, the user either sees a loading state (Option A) or clear instructions to generate (Option B)
- [ ] The user never sees a dead-end "Pending" state without knowing what to do
- [ ] Within one click of creation, the user has a generated IAM policy visible in the Parts tab
- [ ] The generated policy shows the IAM JSON that can be attached to a role
