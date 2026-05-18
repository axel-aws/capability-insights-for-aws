import { useEffect, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Table from '@cloudscape-design/components/table';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Link from '@cloudscape-design/components/link';
import { DataFormat, capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { DataFileInfo } from '~/clients/capability-insights-client';
import { formatTimestamp } from '~/utils/time-utils';

/**
 * Builds a minimal ZIP file from an array of { name, data } entries.
 * Uses the standard ZIP local-file-header + central-directory format (store only, no compression).
 * This avoids needing an external library like JSZip.
 */
function buildZipBlob(files: { name: string; data: ArrayBuffer }[]): Blob {
  const encoder = new TextEncoder();
  const parts: ArrayBuffer[] = [];
  const centralParts: ArrayBuffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const fileBytes = new Uint8Array(file.data);
    const crc = crc32(fileBytes);

    // Local file header (30 bytes + name)
    const local = new ArrayBuffer(30 + nameBytes.length);
    const localView = new DataView(local);
    localView.setUint32(0, 0x04034b50, true); // signature
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0, true); // flags
    localView.setUint16(8, 0, true); // compression (store)
    localView.setUint16(10, 0, true); // mod time
    localView.setUint16(12, 0, true); // mod date
    localView.setUint32(14, crc, true); // crc32
    localView.setUint32(18, fileBytes.length, true); // compressed size
    localView.setUint32(22, fileBytes.length, true); // uncompressed size
    localView.setUint16(26, nameBytes.length, true); // name length
    localView.setUint16(28, 0, true); // extra length
    new Uint8Array(local).set(nameBytes, 30);

    parts.push(local);
    parts.push(file.data);

    // Central directory header (46 bytes + name)
    const central = new ArrayBuffer(46 + nameBytes.length);
    const centralView = new DataView(central);
    centralView.setUint32(0, 0x02014b50, true); // signature
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, 0, true); // flags
    centralView.setUint16(10, 0, true); // compression
    centralView.setUint16(12, 0, true); // mod time
    centralView.setUint16(14, 0, true); // mod date
    centralView.setUint32(16, crc, true); // crc32
    centralView.setUint32(20, fileBytes.length, true); // compressed size
    centralView.setUint32(24, fileBytes.length, true); // uncompressed size
    centralView.setUint16(28, nameBytes.length, true); // name length
    centralView.setUint16(30, 0, true); // extra length
    centralView.setUint16(32, 0, true); // comment length
    centralView.setUint16(34, 0, true); // disk number start
    centralView.setUint16(36, 0, true); // internal attrs
    centralView.setUint32(38, 0, true); // external attrs
    centralView.setUint32(42, offset, true); // local header offset
    new Uint8Array(central).set(nameBytes, 46);

    centralParts.push(central);
    offset += 30 + nameBytes.length + fileBytes.length;
  }

  const centralDirSize = centralParts.reduce((sum, h) => sum + h.byteLength, 0);

  // End of central directory (22 bytes)
  const endRecord = new ArrayBuffer(22);
  const endView = new DataView(endRecord);
  endView.setUint32(0, 0x06054b50, true); // signature
  endView.setUint16(4, 0, true); // disk number
  endView.setUint16(6, 0, true); // central dir disk
  endView.setUint16(8, files.length, true); // entries on disk
  endView.setUint16(10, files.length, true); // total entries
  endView.setUint32(12, centralDirSize, true); // central dir size
  endView.setUint32(16, offset, true); // central dir offset
  endView.setUint16(20, 0, true); // comment length

  return new Blob([...parts, ...centralParts, endRecord], { type: 'application/zip' });
}

/** Simple CRC-32 implementation for ZIP file generation */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function ExportSection() {
  const [files, setFiles] = useState<DataFileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
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
    fetchFiles();
  }, []);

  const getDownloadUrl = (name: string): string => {
    return `/data/${DataFormat.JSON}/${name}.${DataFormat.JSON}`;
  };

  const availableFiles = files.filter((f) => f.lastModified !== null);

  const handleDownloadAll = async () => {
    if (availableFiles.length === 0) return;

    setDownloadingAll(true);
    setNotification(null);

    try {
      const fetchedFiles: { name: string; data: ArrayBuffer }[] = [];

      for (const file of availableFiles) {
        const url = getDownloadUrl(file.name);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch ${file.name}.json`);
        }
        const arrayBuffer = await response.arrayBuffer();
        fetchedFiles.push({
          name: `${file.name}.json`,
          data: arrayBuffer,
        });
      }

      const zipBlob = buildZipBlob(fetchedFiles);
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'capability-data-export.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setNotification({ type: 'success', message: 'ZIP download started.' });
    } catch (e) {
      setNotification({
        type: 'error',
        message: e instanceof Error ? e.message : 'Failed to download files.',
      });
    } finally {
      setDownloadingAll(false);
    }
  };

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button
              variant="primary"
              onClick={handleDownloadAll}
              loading={downloadingAll}
              disabled={availableFiles.length === 0 || loadingFiles}
              iconName="download"
            >
              Download all as ZIP
            </Button>
          }
        >
          Export
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Alert type="info">
          Download your current data files for backup or sharing with other deployments.
        </Alert>
        <Table
          columnDefinitions={[
            {
              id: 'name',
              header: 'File',
              cell: (item: DataFileInfo) => `${item.name}.json`,
            },
            {
              id: 'status',
              header: 'Status',
              cell: (item: DataFileInfo) =>
                item.lastModified ? (
                  <StatusIndicator type="success">{formatTimestamp(item.lastModified)}</StatusIndicator>
                ) : (
                  <StatusIndicator type="stopped">Not present</StatusIndicator>
                ),
            },
            {
              id: 'download',
              header: 'Download',
              cell: (item: DataFileInfo) =>
                item.lastModified ? (
                  <Link href={getDownloadUrl(item.name)} external variant="primary">
                    Download
                  </Link>
                ) : (
                  <Box color="text-status-inactive">—</Box>
                ),
            },
          ]}
          items={files}
          loading={loadingFiles}
          loadingText="Loading file information"
          empty={<Box textAlign="center">No data files found.</Box>}
        />

        {downloadingAll && (
          <StatusIndicator type="loading">Assembling ZIP file...</StatusIndicator>
        )}

        {notification && <Alert type={notification.type}>{notification.message}</Alert>}
      </SpaceBetween>
    </Container>
  );
}
