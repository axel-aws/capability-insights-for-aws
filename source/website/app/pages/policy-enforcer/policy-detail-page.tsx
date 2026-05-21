import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Tabs from '@cloudscape-design/components/tabs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Badge from '@cloudscape-design/components/badge';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Spinner from '@cloudscape-design/components/spinner';
import Alert from '@cloudscape-design/components/alert';

import { APP_NAME } from '~/constants/app';
import { policyEnforcerClient } from '~/clients/policy-enforcer-client';
import type { PolicyConfiguration, PolicyStatus } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { formatTimestamp } from '~/utils/time-utils';
import type { RouteHandle } from '~/types/route';
import type { PolicyPart } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import PolicyPartsTable from './components/policy-parts-table';
import AttachmentInstructions from './components/attachment-instructions';
import StatusDashboard from './components/status-dashboard';
import DeleteConfirmationModal from './components/delete-confirmation-modal';

export const PAGE_POLICY_DETAIL = 'Policy Detail';

export const handle: RouteHandle = { pageName: PAGE_POLICY_DETAIL };

export function meta() {
  return [
    { title: `${PAGE_POLICY_DETAIL} - ${APP_NAME}` },
    { name: 'description', content: 'View policy configuration details' },
  ];
}

function StatusBadge({ status }: { status: PolicyStatus }) {
  switch (status) {
    case 'active':
      return <StatusIndicator type="success">Active</StatusIndicator>;
    case 'pending':
      return <StatusIndicator type="pending">Pending</StatusIndicator>;
    case 'error':
      return <StatusIndicator type="error">Error</StatusIndicator>;
  }
}

export default function PolicyDetailPage() {
  const { policyId } = useParams<{ policyId: string }>();
  const navigate = useNavigate();
  const [policy, setPolicy] = useState<PolicyConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [parts, setParts] = useState<PolicyPart[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteWarning, setDeleteWarning] = useState<string[] | null>(null);

  useEffect(() => {
    if (!policyId) return;
    loadPolicy(policyId);
  }, [policyId]);

  async function loadPolicy(id: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await policyEnforcerClient.getPolicy(id);
      setPolicy(result);
      // Also load parts for the attachment tab
      try {
        const partsResponse = await policyEnforcerClient.getPolicyParts(id);
        setParts(partsResponse.parts);
      } catch {
        // Parts may not be available yet (no refresh performed)
        setParts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policy');
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    if (!policyId) return;
    setRefreshing(true);
    try {
      await policyEnforcerClient.refreshPolicy(policyId);
      await loadPolicy(policyId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh policy');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!policyId) return;
    setDeleting(true);
    setDeleteError(null);
    setDeleteWarning(null);
    try {
      const result = await policyEnforcerClient.deletePolicy(policyId);
      if (result.failedArns && result.failedArns.length > 0) {
        // Partial failure: show warning but still navigate back
        setDeleteWarning(result.failedArns.map((f) => `${f.arn}: ${f.error}`));
        setShowDeleteModal(false);
        // Navigate after a brief delay so user can see the warning
        setTimeout(() => navigate('/policy-enforcer'), 3000);
      } else {
        // Full success: navigate back immediately
        navigate('/policy-enforcer');
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete policy');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <ContentLayout header={<Header variant="h1">Loading...</Header>}>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
        </Box>
      </ContentLayout>
    );
  }

  if (error || !policy) {
    return (
      <ContentLayout header={<Header variant="h1">Policy Detail</Header>}>
        <Alert type="error" header="Error loading policy">
          {error ?? 'Policy not found'}
        </Alert>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={policy.description}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => navigate(`/policy-enforcer/${policyId}/edit`)}>
                Edit
              </Button>
              <Button
                iconName="refresh"
                loading={refreshing}
                onClick={handleRefresh}
              >
                Refresh
              </Button>
              <Button onClick={() => navigate('/policy-enforcer')}>
                Back to List
              </Button>
            </SpaceBetween>
          }
        >
          {policy.policyName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {policy.status === 'pending' && (
          <Alert
            type="info"
            header="Policy generation required"
            action={
              <Button variant="primary" loading={refreshing} onClick={handleRefresh}>
                Generate policy now
              </Button>
            }
          >
            Your policy configuration is saved. Click &quot;Generate policy now&quot; to compute the IAM allow-list based on your selected regions and settings. This process typically takes a few seconds.
          </Alert>
        )}
        <Container header={<Header variant="h2">Overview</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">Status</Box>
              <StatusBadge status={policy.status} />
            </div>
            <div>
              <Box variant="awsui-key-label">Policy Type</Box>
              <div>{policy.policyType}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Mode</Box>
              <div>{policy.mode === 'intersection' ? 'Intersection' : 'Union'}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Regions</Box>
              <div>
                <Badge>{policy.regions.length}</Badge>{' '}
                {policy.regions.length <= 5
                  ? policy.regions.join(', ')
                  : `${policy.regions.slice(0, 5).join(', ')}...`}
              </div>
            </div>
            <div>
              <Box variant="awsui-key-label">Refresh Interval</Box>
              <div>{policy.refreshIntervalHours} hours</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Last Refresh</Box>
              <div>
                {policy.lastRefreshTime
                  ? formatTimestamp(policy.lastRefreshTime)
                  : 'Never'}
              </div>
            </div>
          </ColumnLayout>
        </Container>

        <Tabs
          tabs={[
            {
              label: 'Parts',
              id: 'parts',
              content: (
                <Box padding="l">
                  <PolicyPartsTable policyId={policyId!} />
                </Box>
              ),
            },
            {
              label: 'Attachment',
              id: 'attachment',
              content: (
                <Box padding="l">
                  <AttachmentInstructions
                    parts={parts}
                    policyType={policy.policyType}
                    policyName={policy.policyName}
                  />
                </Box>
              ),
            },
            {
              label: 'Status',
              id: 'status',
              content: (
                <Box padding="l">
                  <StatusDashboard
                    policies={[policy]}
                    onRefreshComplete={() => loadPolicy(policyId!)}
                  />
                </Box>
              ),
            },
            {
              label: 'Actions',
              id: 'actions',
              content: (
                <Box padding="l">
                  <SpaceBetween size="l">
                    {deleteWarning && (
                      <Alert type="warning" header="Partial delete failure">
                        The policy configuration was removed, but the following IAM policies
                        could not be deleted:
                        <ul>
                          {deleteWarning.map((msg) => (
                            <li key={msg}>{msg}</li>
                          ))}
                        </ul>
                        Navigating back to the policy list...
                      </Alert>
                    )}
                    {deleteError && (
                      <Alert type="error" header="Delete failed">
                        {deleteError}
                      </Alert>
                    )}
                    <Container header={<Header variant="h3">Danger zone</Header>}>
                      <SpaceBetween size="s">
                        <Box>
                          Permanently delete this policy configuration and all associated IAM
                          managed policies. This action cannot be undone.
                        </Box>
                        <Button
                          variant="primary"
                          onClick={() => setShowDeleteModal(true)}
                          loading={deleting}
                        >
                          Delete policy
                        </Button>
                      </SpaceBetween>
                    </Container>
                  </SpaceBetween>
                </Box>
              ),
            },
          ]}
        />

        {showDeleteModal && policy && (
          <DeleteConfirmationModal
            policy={policy}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setShowDeleteModal(false)}
            loading={deleting}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
