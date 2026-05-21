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
import type { DataFileInfo, UploadRecord } from '~/clients/capability-insights-client';
import { formatTimestamp } from '~/utils/time-utils';

const DATA_FILE_OPTIONS: SelectProps.Option[] = [
  { label: 'regions', value: DataFile.REGIONS },
  { label: 'products', value: DataFile.PRODUCTS },
  { label: 'apis', value: DataFile.APIS },
  { label: 'cfn_resources', value: DataFile.CFN_RESOURCES },
];

export function DataUploadSection() {
  const [files, setFiles] = useState<DataFileInfo[]>([]);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [selectedFile, setSelectedFile] = useState<SelectProps.Option | null>(DATA_FILE_OPTIONS[0]);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedBrowserFile, setSelectedBrowserFile] = useState<File | null>(null);
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

  const fetchUploads = async () => {
    setLoadingUploads(true);
    try {
      const result = await capabilityInsightsClient.listUploads();
      setUploads(result.uploads);
    } catch {
      // Non-critical
    } finally {
      setLoadingUploads(false);
    }
  };

  useEffect(() => {
    fetchFiles();
    fetchUploads();
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValidationError(null);
    setSelectedBrowserFile(null);
    setFileName(null);

    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.json')) {
      setValidationError('File must be a .json file.');
      return;
    }

    setFileName(file.name);
    setSelectedBrowserFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile?.value || !selectedBrowserFile) return;

    setUploading(true);
    setNotification(null);
    try {
      const dataFile = selectedFile.value as DataFile;

      // 1. Get presigned URL
      const { uploadId, presignedUrl, s3Key } = await capabilityInsightsClient.getPresignedUrl(dataFile);

      // 2. Upload file directly to S3 via presigned URL
      const fileContent = await selectedBrowserFile.arrayBuffer();
      const putResponse = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: fileContent,
      });
      if (!putResponse.ok) {
        throw new Error(`S3 upload failed: ${putResponse.status}`);
      }

      // 3. Complete the upload (validate + rebuild)
      const result = await capabilityInsightsClient.completeUpload(uploadId, dataFile, s3Key);

      setNotification({
        type: 'success',
        message: `Uploaded ${selectedFile.value}.json — ${result.mergeResult.additions} additions, ${result.mergeResult.updates} updates, ${result.mergeResult.total} total items.`,
      });
      setSelectedBrowserFile(null);
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await Promise.all([fetchFiles(), fetchUploads()]);
    } catch (e) {
      setNotification({ type: 'error', message: e instanceof Error ? e.message : 'Upload failed.' });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (uploadId: string) => {
    setDeleting(uploadId);
    setNotification(null);
    try {
      await capabilityInsightsClient.deleteUpload(uploadId);
      setNotification({ type: 'success', message: 'Upload deleted and data rebuilt.' });
      await Promise.all([fetchFiles(), fetchUploads()]);
    } catch (e) {
      setNotification({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed.' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Container header={<Header variant="h2">Data upload</Header>}>
      <SpaceBetween size="l">
        <Alert type="info">
          Upload a JSON data file. It will be merged with canonical data — new items are added, existing items are
          updated. Upload history is preserved and individual uploads can be removed.
        </Alert>

        <Table
          columnDefinitions={[
            { id: 'name', header: 'File', cell: (item: DataFileInfo) => item.name },
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
            {fileName && selectedBrowserFile && (
              <StatusIndicator type="success">Selected: {fileName}</StatusIndicator>
            )}
          </SpaceBetween>

          {validationError && <Alert type="error">{validationError}</Alert>}

          <Button
            variant="primary"
            onClick={handleUpload}
            loading={uploading}
            disabled={!selectedBrowserFile || !selectedFile}
          >
            Upload
          </Button>
        </SpaceBetween>

        {uploads.length > 0 && (
          <Table
            header={<Header variant="h3">Upload history</Header>}
            columnDefinitions={[
              { id: 'fileName', header: 'File', cell: (item: UploadRecord) => item.fileName },
              { id: 'uploadedAt', header: 'Uploaded', cell: (item: UploadRecord) => formatTimestamp(item.uploadedAt) },
              { id: 'itemCount', header: 'Items', cell: (item: UploadRecord) => item.itemCount },
              {
                id: 'actions',
                header: 'Actions',
                cell: (item: UploadRecord) => (
                  <Button
                    variant="inline-link"
                    onClick={() => handleDelete(item.uploadId)}
                    loading={deleting === item.uploadId}
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
            items={uploads}
            loading={loadingUploads}
            loadingText="Loading upload history"
          />
        )}

        {notification && <Alert type={notification.type}>{notification.message}</Alert>}
      </SpaceBetween>
    </Container>
  );
}
