import { useEffect, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Select from '@cloudscape-design/components/select';
import Alert from '@cloudscape-design/components/alert';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Table from '@cloudscape-design/components/table';
import Button from '@cloudscape-design/components/button';
import type { SelectProps } from '@cloudscape-design/components/select';
import { DataFile, capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { UploadRecord } from '~/clients/capability-insights-client';
import { formatTimestamp } from '~/utils/time-utils';

const DATA_FILE_OPTIONS: SelectProps.Option[] = [
  { label: 'All files', value: '' },
  { label: 'regions', value: DataFile.REGIONS },
  { label: 'products', value: DataFile.PRODUCTS },
  { label: 'apis', value: DataFile.APIS },
  { label: 'cfn_resources', value: DataFile.CFN_RESOURCES },
];

export function DatasetMergeSection() {
  const [selectedFile, setSelectedFile] = useState<SelectProps.Option | null>(DATA_FILE_OPTIONS[0]);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchUploads = async () => {
    setLoading(true);
    try {
      const filter = selectedFile?.value ? (selectedFile.value as DataFile) : undefined;
      const result = await capabilityInsightsClient.listUploads(filter);
      setUploads(result.uploads);
    } catch {
      setNotification({ type: 'error', message: 'Failed to load upload history.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUploads();
  }, [selectedFile]);

  const handleDelete = async (uploadId: string) => {
    setDeleting(uploadId);
    setNotification(null);
    try {
      await capabilityInsightsClient.deleteUpload(uploadId);
      setNotification({ type: 'success', message: 'Upload deleted and data rebuilt.' });
      await fetchUploads();
    } catch (e) {
      setNotification({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed.' });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Container header={<Header variant="h2">Dataset merge history</Header>}>
      <SpaceBetween size="l">
        <Alert type="info">
          Data is automatically merged when uploads are added or removed. Canonical data (from scheduled sync) is
          combined with all uploads to produce the final dataset. Removing an upload triggers a rebuild.
        </Alert>

        <SpaceBetween size="xs">
          <Box variant="awsui-key-label">Filter by file</Box>
          <Select
            selectedOption={selectedFile}
            onChange={({ detail }) => setSelectedFile(detail.selectedOption)}
            options={DATA_FILE_OPTIONS}
            placeholder="All files"
          />
        </SpaceBetween>

        <Table
          columnDefinitions={[
            { id: 'fileName', header: 'File', cell: (item: UploadRecord) => item.fileName },
            { id: 'uploadedAt', header: 'Uploaded', cell: (item: UploadRecord) => formatTimestamp(item.uploadedAt) },
            { id: 'itemCount', header: 'Items', cell: (item: UploadRecord) => item.itemCount },
            { id: 'description', header: 'Description', cell: (item: UploadRecord) => item.description || '—' },
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
          loading={loading}
          loadingText="Loading uploads"
          empty={<Box textAlign="center">No uploads found.</Box>}
        />

        {notification && <Alert type={notification.type}>{notification.message}</Alert>}
      </SpaceBetween>
    </Container>
  );
}
