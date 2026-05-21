# Exceptions input has no autocomplete from known API actions

**Severity:** Medium
**Category:** Feature Request
**Page:** /policy-enforcer/create (Step 4)
**Component:** source/website/app/pages/policy-enforcer/create-policy-wizard.tsx

## Problem

The Exceptions input requires users to type exact IAM action format (`service:Action` or `service:*`) from memory. The system has 17,959 known API operations in its data, but none of that knowledge is surfaced to help users add exceptions.

Users must:
1. Know the exact service prefix (e.g., "s3", "ec2", "lambda")
2. Know the exact action name with correct casing (e.g., "GetObject", not "getobject")
3. Type it perfectly with no assistance

This is a high cognitive load interaction in what should be a guided workflow. The data exists to provide typeahead suggestions.

## Screenshot

N/A

## Fix Instructions

1. Replace the current plain `Input` + "Add" button with a Cloudscape `Autosuggest` component

2. Wire the `onLoadItems` or `options` prop to search the loaded APIs data:
   - As the user types "s3:", filter to all S3 actions and show them as suggestions
   - As the user types "s3:Get", narrow to GetObject, GetBucketPolicy, GetBucketAcl, etc.
   - Show suggestions in format: `s3:GetObject` with description "Amazon Simple Storage Service (S3)"

3. Also support wildcard: when user types "s3:*", show it as a valid option with description "All S3 actions"

4. Source the suggestions from the same APIs data already loaded on the client (the `apis.json` data that powers the API operations tab)

5. Keep the "Add" button to confirm the selection, or allow Enter to add

6. Maintain the existing format validation (`service:Action` or `service:*`) but now users will mostly select from suggestions rather than typing blind

**Acceptance Criteria:**
- [ ] Typing in the exceptions input shows a dropdown of matching IAM actions
- [ ] Typing "s3:" shows all S3 actions as suggestions
- [ ] Typing "s3:Get" narrows suggestions to S3 actions starting with "Get"
- [ ] Selecting a suggestion populates the input and allows adding it
- [ ] Wildcard entries (e.g., "ec2:*") are shown as valid options
- [ ] Invalid formats that don't match known actions still show a validation hint
- [ ] Performance is acceptable (no lag on keystrokes) despite 17,959 possible actions
