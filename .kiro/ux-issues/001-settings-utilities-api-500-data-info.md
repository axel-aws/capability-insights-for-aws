# Settings Utilities API returns 500 on /prod/data/info

**Severity:** High
**Category:** Bug
**Page:** /settings (Utilities tab)
**Component:** source/lambda/routes/data-utilities-routes.ts

## Problem

The `/prod/data/info` endpoint returns HTTP 500 with `{"error":"Data storage unavailable"}`. This causes:

- "Failed to load data file information" error message in the Data Upload section
- "No data files found" in the Export section's file table
- "Download all as ZIP" button permanently disabled
- The merge, upload, and export flows for sharing region data are all blocked

This is a critical workflow blocker. Users need to merge region data from external sources and export specific regions to share with other teams/deployments. None of this is possible while the API is broken.

## Screenshot

See artifacts/settings_utilities_tab.png showing the error states.

## Fix Instructions

1. Check the data-utilities-routes.ts handler for the GET `/data/info` route
2. The endpoint likely depends on either a DynamoDB table (for file metadata) or direct S3 listing
3. Verify the S3 bucket policy allows the Lambda role to list objects in the data prefix
4. Verify DynamoDB table exists and the Lambda has read permissions
5. The endpoint should return an array of available data files with metadata:
   ```json
   [
     { "filename": "regions.json", "lastModified": "2026-05-20T08:33:00Z", "size": 6490 },
     { "filename": "apis.json", "lastModified": "2026-05-20T08:33:00Z", "size": 20751837 },
     { "filename": "cfn_resources.json", "lastModified": "2026-05-20T08:33:00Z", "size": 5743304 },
     { "filename": "products.json", "lastModified": "2026-05-20T08:33:00Z", "size": 2776624 }
   ]
   ```
6. Check CloudWatch Logs for the API Lambda to identify the specific error causing "Data storage unavailable"

**Acceptance Criteria:**
- [ ] GET `/prod/data/info` returns 200 with a JSON array of available data files
- [ ] The Utilities tab Upload section shows the file list table with filenames and last-modified dates
- [ ] The Export section shows the file list with download links
- [ ] "Download all as ZIP" button is enabled when files are available
- [ ] "Upload" button works after selecting a target file and uploading a JSON file
- [ ] "Preview merge" button works after selecting a target file and uploading a JSON file
