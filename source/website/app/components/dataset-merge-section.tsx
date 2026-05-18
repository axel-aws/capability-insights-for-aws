import { useRef, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Select from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { SelectProps } from '@cloudscape-design/components/select';
import { DataFile, capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { MergePreview } from '~/clients/capability-insights-client';

const DATA_FILE_OPTIONS: SelectProps.Option[] = [
  { label: 'regions', value: DataFile.REGIONS },
  { label: 'products', value: DataFile.PRODUCTS },
  { label: 'apis', value: DataFile.APIS },
  { label: 'cfn_resources', value: DataFile.CFN_RESOURCES },
];

export function DatasetMergeSection() {
  const [selectedFile, setSelectedFile] = useState<SelectProps.Option | null>(DATA_FILE_OPTIONS[0]);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValidationError(null);
    setFileContent(null);
    setFileName(null);
    setMergePreview(null);
    setNotification(null);

    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
          setValidationError('File content must be a JSON array.');
          return;
        }
        setFileContent(content);
      } catch {
        setValidationError('File content is not valid JSON.');
      }
    };
    reader.readAsText(file);
  };

  const handlePreviewMerge = async () => {
    if (!selectedFile?.value || !fileContent) return;

    setPreviewing(true);
    setNotification(null);
    setMergePreview(null);
    try {
      const preview = await capabilityInsightsClient.previewMerge(selectedFile.value as DataFile, fileContent);
      setMergePreview(preview);
    } catch (e) {
      setNotification({ type: 'error', message: e instanceof Error ? e.message : 'Failed to preview merge.' });
    } finally {
      setPreviewing(false);
    }
  };

  const handleConfirmMerge = async () => {
    if (!selectedFile?.value || !mergePreview) return;

    setCommitting(true);
    setNotification(null);
    try {
      await capabilityInsightsClient.commitMerge(selectedFile.value as DataFile, mergePreview.mergeId);
      setNotification({ type: 'success', message: `Successfully merged data into ${selectedFile.value}.json` });
      resetState();
    } catch (e) {
      setNotification({ type: 'error', message: e instanceof Error ? e.message : 'Failed to commit merge.' });
    } finally {
      setCommitting(false);
    }
  };

  const handleCancel = () => {
    resetState();
  };

  const resetState = () => {
    setMergePreview(null);
    setFileContent(null);
    setFileName(null);
    setValidationError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Container header={<Header variant="h2">Dataset merge</Header>}>
      <SpaceBetween size="l">
        <Alert type="info">
          Combine an uploaded file with your existing data. New items are added, existing items are updated, and nothing
          is deleted. Use this to bring together data from multiple sources.
        </Alert>

        <Box>
          <ol>
            <li>Select which data file to merge into</li>
            <li>Upload a JSON file containing new or updated data</li>
            <li>Preview what will change (additions, updates, unchanged)</li>
            <li>Confirm to apply or cancel to discard</li>
          </ol>
        </Box>

        <SpaceBetween size="m">
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Target file</Box>
            <Select
              selectedOption={selectedFile}
              onChange={({ detail }) => {
                setSelectedFile(detail.selectedOption);
                setMergePreview(null);
                setNotification(null);
              }}
              options={DATA_FILE_OPTIONS}
              placeholder="Select a data file"
              disabled={!!mergePreview}
            />
          </SpaceBetween>

          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">JSON file to merge</Box>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              disabled={!!mergePreview}
              aria-label="Select JSON file to merge"
            />
            {fileName && fileContent && (
              <StatusIndicator type="success">Valid JSON array: {fileName}</StatusIndicator>
            )}
          </SpaceBetween>

          {validationError && <Alert type="error">{validationError}</Alert>}

          <Box variant="small" color="text-body-secondary">
            Merging is non-destructive — existing items are preserved and only additions or updates are applied.
          </Box>

          {!mergePreview && (
            <Button
              variant="primary"
              onClick={handlePreviewMerge}
              loading={previewing}
              disabled={!fileContent || !selectedFile}
            >
              Preview merge
            </Button>
          )}
        </SpaceBetween>

        {mergePreview && (
          <SpaceBetween size="m">
            <Box variant="awsui-key-label">Merge preview</Box>
            <ColumnLayout columns={4} variant="text-grid">
              <div>
                <Box variant="awsui-key-label">Additions</Box>
                <Box variant="awsui-value-large">{mergePreview.additions}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Updates</Box>
                <Box variant="awsui-value-large">{mergePreview.updates}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Unchanged</Box>
                <Box variant="awsui-value-large">{mergePreview.unchanged}</Box>
              </div>
              <div>
                <Box variant="awsui-key-label">Total after merge</Box>
                <Box variant="awsui-value-large">{mergePreview.totalAfterMerge}</Box>
              </div>
            </ColumnLayout>

            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="primary" onClick={handleConfirmMerge} loading={committing}>
                Confirm merge
              </Button>
              <Button variant="normal" onClick={handleCancel} disabled={committing}>
                Cancel
              </Button>
            </SpaceBetween>
          </SpaceBetween>
        )}

        {notification && <Alert type={notification.type}>{notification.message}</Alert>}
      </SpaceBetween>
    </Container>
  );
}
