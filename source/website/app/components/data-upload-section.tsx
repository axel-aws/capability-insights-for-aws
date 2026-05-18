import { useEffect, useRef, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Table from '@cloudscape-design/components/table';
import Select from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { SelectProps } from '@cloudscape-design/components/select';
import { DataFile, capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { DataFileInfo } from '~/clients/capability-insights-client';
import { formatTimestamp } from '~/utils/time-utils';

const DATA_FILE_OPTIONS: SelectProps.Option[] = [
  { label: 'regions', value: DataFile.REGIONS },
  { label: 'products', value: DataFile.PRODUCTS },
  { label: 'apis', value: DataFile.APIS },
  { label: 'cfn_resources', value: DataFile.CFN_RESOURCES },
];

export function DataUploadSection() {
  const [files, setFiles] = useState<DataFileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [selectedFile, setSelectedFile] = useState<SelectProps.Option | null>(DATA_FILE_OPTIONS[0]);
  const [uploading, setUploading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = async () => {
    setLoadingFiles(true);
    try {
      const info = await capabilityInsightsClient.getDataFilesInfo();
      setFiles(info.files);
    } catch {
      setNotification({ type: 'error', message: 'Failed to load data file information.' });
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValidationError(null);
    setFileContent(null);
    setFileName(null);

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

  const handleUpload = async () => {
    if (!selectedFile?.value || !fileContent) return;

    setUploading(true);
    setNotification(null);
    try {
      await capabilityInsightsClient.uploadDataFile(selectedFile.value as DataFile, fileContent);
      setNotification({ type: 'success', message: `Successfully uploaded ${selectedFile.value}.json` });
      setFileContent(null);
      setFileName(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await fetchFiles();
    } catch (e) {
      setNotification({ type: 'error', message: e instanceof Error ? e.message : 'Upload failed.' });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Container header={<Header variant="h2">Data upload</Header>}>
      <SpaceBetween size="l">
        <Alert type="info">
          Replace the authoritative data file in your data store with an uploaded file. This completely overwrites the
          existing file.
        </Alert>

        <Table
          columnDefinitions={[
            {
              id: 'name',
              header: 'File',
              cell: (item: DataFileInfo) => item.name,
            },
            {
              id: 'lastModified',
              header: 'Last modified',
              cell: (item: DataFileInfo) =>
                item.lastModified ? (
                  <StatusIndicator type="success">{formatTimestamp(item.lastModified)}</StatusIndicator>
                ) : (
                  <StatusIndicator type="stopped">Not present</StatusIndicator>
                ),
            },
          ]}
          items={files}
          loading={loadingFiles}
          loadingText="Loading file information"
          empty={<Box textAlign="center">No data files found.</Box>}
        />

        <SpaceBetween size="m">
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Target file</Box>
            <Select
              selectedOption={selectedFile}
              onChange={({ detail }) => setSelectedFile(detail.selectedOption)}
              options={DATA_FILE_OPTIONS}
              placeholder="Select a data file"
            />
          </SpaceBetween>

          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">JSON file</Box>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileChange}
              aria-label="Select JSON file to upload"
            />
            {fileName && fileContent && (
              <StatusIndicator type="success">Valid JSON array: {fileName}</StatusIndicator>
            )}
          </SpaceBetween>

          {validationError && <Alert type="error">{validationError}</Alert>}

          <Box variant="small" color="text-body-secondary">
            Uploading will completely replace the selected data file. This action cannot be undone.
          </Box>

          <Button
            variant="primary"
            onClick={handleUpload}
            loading={uploading}
            disabled={!fileContent || !selectedFile}
          >
            Upload
          </Button>
        </SpaceBetween>

        {notification && <Alert type={notification.type}>{notification.message}</Alert>}
      </SpaceBetween>
    </Container>
  );
}
