# Bugfix Requirements Document

## Introduction

The Settings page (implemented as part of the external-sync-settings feature) has several UX issues that make it difficult for non-technical users to understand and use the Utilities tab, and lacks a critical toggle to disable the scheduled daily data sync. These issues affect usability and data safety — a user cannot prevent the daily sync from overwriting their manually uploaded data, the Utilities tab sections lack explanatory descriptions, the dataset merge workflow is unclear, and the Export section may not render properly.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user wants to prevent the scheduled daily S3 access point sync from overwriting their data THEN the system provides no toggle to disable the automatic data sync — only a manual "Sync capability data" button exists, but the scheduled sync still runs unconditionally and overwrites user data.

1.2 WHEN a user views the Data Upload section in the Utilities tab THEN the system displays no description or helper text explaining what the upload action does (that it completely overwrites the existing file).

1.3 WHEN a user views the Dataset Merge section in the Utilities tab THEN the system displays no description or helper text explaining what the merge action does (additive merge: new items added, existing updated, nothing deleted).

1.4 WHEN a user views the Export section in the Utilities tab THEN the system displays no description or helper text explaining what the export action does (download current data for backup or sharing).

1.5 WHEN a user attempts to perform a dataset merge THEN the system does not clearly communicate the step-by-step workflow (select target file → upload merge file → preview changes → confirm/cancel), leaving users confused about the process.

1.6 WHEN the Data Upload section renders THEN the system does not display contextual guidance about the consequences of uploading (that it completely replaces the authoritative data file).

1.7 WHEN the Dataset Merge section renders THEN the system does not display contextual guidance about what "merge" means in this context (combine data from multiple sources without deleting existing items).

### Expected Behavior (Correct)

2.1 WHEN a user views the Data Synchronization container on the Settings tab THEN the system SHALL display a toggle to enable/disable the scheduled daily data sync, and WHEN the toggle is off the Data Fetch Lambda SHALL skip fetching from the S3 access point.

2.2 WHEN a user views the Data Upload section THEN the system SHALL display a description: "Replace the authoritative data file in your data store with an uploaded file. This completely overwrites the existing file."

2.3 WHEN a user views the Dataset Merge section THEN the system SHALL display a description: "Combine an uploaded file with your existing data. New items are added, existing items are updated, and nothing is deleted. Use this to bring together data from multiple sources."

2.4 WHEN a user views the Export section THEN the system SHALL display a description: "Download your current data files for backup or sharing with other deployments."

2.5 WHEN a user views the Dataset Merge section THEN the system SHALL display step-by-step guidance indicating the workflow: (1) select which data file to merge into, (2) upload a file containing new/updated data, (3) preview what will change, (4) confirm or cancel.

2.6 WHEN a user views the Data Upload section THEN the system SHALL display an informational alert or helper text warning that uploading will completely replace the selected data file.

2.7 WHEN a user views the Dataset Merge section THEN the system SHALL display helper text clarifying that merging is non-destructive — existing items are preserved and only additions/updates are applied.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user clicks "Sync capability data" manually THEN the system SHALL CONTINUE TO trigger the data fetch Lambda and sync data from the S3 access point regardless of the scheduled sync toggle state.

3.2 WHEN a user uploads a valid JSON array file via the Data Upload section THEN the system SHALL CONTINUE TO validate the file, upload it to S3, and refresh the file list with updated timestamps.

3.3 WHEN a user performs a dataset merge (preview → confirm) THEN the system SHALL CONTINUE TO compute the merge preview with addition/update/unchanged counts and commit the merge to S3 upon confirmation.

3.4 WHEN a user downloads individual files or the ZIP archive from the Export section THEN the system SHALL CONTINUE TO provide correct download links and generate a valid ZIP file.

3.5 WHEN the Terraform overlay toggle is enabled with a valid token THEN the system SHALL CONTINUE TO invoke the Overlay Lambda during data sync and report overlay metadata.

3.6 WHEN the Settings page loads THEN the system SHALL CONTINUE TO default to the "Settings" tab and display both tabs (Settings and Utilities) with their existing containers and sections.
