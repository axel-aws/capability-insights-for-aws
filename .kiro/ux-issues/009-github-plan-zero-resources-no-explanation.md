# GitHub plan shows 0 resources with "Ready" status and no explanation

**Severity:** Medium
**Category:** Bug
**Page:** /infrastructure-planning/:planId
**Component:** source/website/app/pages/infrastructure-planning/plan-detail-page.tsx

## Problem

The "amazon-ecs-fullstack-app-terraform" plan sourced from GitHub shows:
- Status: "Ready"
- Resource Types: 0
- API Operations: 0
- Services: 0

"Ready" implies successful completion, but 0 resources implies the analysis found nothing. There is no indication of what happened:
- Did the analysis fail silently?
- Is the repo format unsupported?
- Were the files in unexpected locations?
- Does the repo require different analysis configuration?

Users cannot distinguish between "analysis succeeded and found nothing" vs. "analysis failed but was marked as complete." This erodes trust in the tool's analysis capability.

## Screenshot

See artifacts/infrastructure_planning_list.png (showing the 0/0 row)

## Fix Instructions

1. In the plan detail page component, add conditional rendering when `status === 'Ready'` AND `resourceTypes === 0` AND `apiOperations === 0`:

2. Show a Cloudscape `Alert` component with `type="warning"`:
   ```
   Header: "No AWS resources detected"
   Content: "Analysis completed but no AWS resources were found. This may happen if:
   • The repository doesn't contain supported IaC files (.tf, .yaml, .json) in the expected locations
   • The Terraform or CDK code uses patterns not yet supported by the analyzer
   • The repository requires specific branch or path configuration
   
   Try re-processing the plan or creating a new plan with a different source configuration."
   ```

3. Optionally update the status display logic:
   - If resources === 0 after processing, show status as "Ready (no resources found)" or use a warning badge color instead of success green

4. In the plan list table, for rows where resources === 0 and status === "Ready", add a warning icon or different status badge color to indicate an anomalous state

**Acceptance Criteria:**
- [ ] Plans with 0 extracted resources show a warning alert explaining possible causes
- [ ] Users can distinguish between "successful analysis with results" and "completed but found nothing"
- [ ] The warning provides actionable next steps (re-process, try different config)
- [ ] List view gives visual indication that a "Ready" plan with 0 resources may need attention
