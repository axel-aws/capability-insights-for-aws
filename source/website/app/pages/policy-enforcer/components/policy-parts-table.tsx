import { useEffect, useState } from 'react';
import Table from '@cloudscape-design/components/table';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import Alert from '@cloudscape-design/components/alert';
import Spinner from '@cloudscape-design/components/spinner';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';

import { policyEnforcerClient } from '~/clients/policy-enforcer-client';
import type {
  PolicyPart,
  PolicyPartsResponse,
  PolicyPartDetailResponse,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import PartDetailViewer from './part-detail-viewer';

export interface PolicyPartsTableProps {
  policyId: string;
}

/**
 * Displays a table of all policy parts for a given policy configuration.
 * Fetches parts on mount and supports row selection to show part detail.
 */
export default function PolicyPartsTable({ policyId }: PolicyPartsTableProps) {
  const [partsResponse, setPartsResponse] = useState<PolicyPartsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<PolicyPart[]>([]);
  const [partDetail, setPartDetail] = useState<PolicyPartDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PolicyPart | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    loadParts();
  }, [policyId]);

  async function loadParts() {
    setLoading(true);
    setError(null);
    try {
      const result = await policyEnforcerClient.getPolicyParts(policyId);
      setPartsResponse(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policy parts');
    } finally {
      setLoading(false);
    }
  }

  async function handleSelectionChange(items: PolicyPart[]) {
    setSelectedItems(items);
    setPartDetail(null);
    setDetailError(null);

    if (items.length === 1) {
      setDetailLoading(true);
      try {
        const detail = await policyEnforcerClient.getPolicyPartDetail(
          policyId,
          items[0].partIndex,
        );
        setPartDetail(detail);
      } catch (err) {
        setDetailError(
          err instanceof Error ? err.message : 'Failed to load part detail',
        );
      } finally {
        setDetailLoading(false);
      }
    }
  }

  async function handleDeletePart() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await policyEnforcerClient.deletePolicyPart(policyId, deleteTarget.partIndex);
      setDeleteTarget(null);
      setSelectedItems([]);
      setPartDetail(null);
      // Reload parts table
      await loadParts();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete policy part');
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  }

  if (loading) {
    return (
      <Box textAlign="center" padding="l">
        <Spinner size="large" />
        <Box variant="p" color="text-status-inactive" padding={{ top: 's' }}>
          Loading policy parts...
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Alert type="error" header="Error loading policy parts">
        {error}
      </Alert>
    );
  }

  if (!partsResponse || partsResponse.parts.length === 0) {
    return (
      <Alert type="info" header="No policy parts available">
        Policy parts will be available after the first refresh is performed. Trigger a refresh
        to generate the IAM managed policies.
      </Alert>
    );
  }

  return (
    <SpaceBetween size="l">
      {deleteError && (
        <Alert type="error" header="Delete failed" dismissible onDismiss={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      )}

      <Table
        header={
          <Header
            counter={`(${partsResponse.totalParts})`}
            description={`Combined size: ${partsResponse.combinedSize.toLocaleString()} characters`}
            actions={
              <Button
                disabled={selectedItems.length !== 1}
                loading={deleteLoading}
                onClick={() => setDeleteTarget(selectedItems[0])}
              >
                Delete part
              </Button>
            }
          >
            Policy Parts
          </Header>
        }
        items={partsResponse.parts}
        selectionType="single"
        selectedItems={selectedItems}
        onSelectionChange={({ detail }) =>
          handleSelectionChange(detail.selectedItems)
        }
        columnDefinitions={[
          {
            id: 'partIndex',
            header: 'Part #',
            cell: (item) => item.partIndex,
            width: 80,
          },
          {
            id: 'arn',
            header: 'ARN',
            cell: (item) => (
              <Box variant="code" fontSize="body-s">
                {item.arn}
              </Box>
            ),
          },
          {
            id: 'partType',
            header: 'Type',
            cell: (item) => (
              <Badge color={item.partType === 'blanket-deny' ? 'blue' : 'green'}>
                {item.partType === 'blanket-deny' ? 'Blanket Deny' : 'Specific API Deny'}
              </Badge>
            ),
            width: 180,
          },
          {
            id: 'documentSize',
            header: 'Size',
            cell: (item) => `${item.documentSize.toLocaleString()} chars`,
            width: 120,
          },
          {
            id: 'statementItemCount',
            header: 'Statement Items',
            cell: (item) => (
              <Badge>{item.statementItemCount.toLocaleString()}</Badge>
            ),
            width: 140,
          },
        ]}
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="xs">
              <b>No policy parts</b>
              <Box variant="p" color="inherit">
                No policy parts have been generated yet.
              </Box>
            </SpaceBetween>
          </Box>
        }
      />

      <Box variant="p" color="text-status-inactive">
        Total parts: <strong>{partsResponse.totalParts}</strong> | Combined size:{' '}
        <strong>{partsResponse.combinedSize.toLocaleString()} characters</strong>
      </Box>

      {detailLoading && (
        <Box textAlign="center" padding="l">
          <Spinner size="normal" />
          <Box variant="p" color="text-status-inactive" padding={{ top: 'xs' }}>
            Loading part detail...
          </Box>
        </Box>
      )}

      {detailError && (
        <Alert type="error" header="Error loading part detail">
          {detailError}
        </Alert>
      )}

      {partDetail && <PartDetailViewer detail={partDetail} />}

      {deleteTarget && (
        <Modal
          visible={true}
          onDismiss={() => setDeleteTarget(null)}
          header="Delete policy part"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" onClick={() => setDeleteTarget(null)} disabled={deleteLoading}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleDeletePart}
                  loading={deleteLoading}
                >
                  Delete
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="m">
            <Alert type="warning" header="This will break full coverage">
              Removing a single policy part means the remaining parts will no longer provide
              complete regional governance coverage. Services or APIs covered by this part will
              no longer be denied.
            </Alert>
            <Box>
              <Box variant="awsui-key-label">Part to delete</Box>
              <Box variant="code" fontSize="body-s">
                {deleteTarget.arn}
              </Box>
            </Box>
            <Box>
              <Box variant="awsui-key-label">Type</Box>
              <Badge color={deleteTarget.partType === 'blanket-deny' ? 'blue' : 'green'}>
                {deleteTarget.partType === 'blanket-deny' ? 'Blanket Deny' : 'Specific API Deny'}
              </Badge>
            </Box>
          </SpaceBetween>
        </Modal>
      )}
    </SpaceBetween>
  );
}
