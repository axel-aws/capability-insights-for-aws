import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Badge from '@cloudscape-design/components/badge';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Spinner from '@cloudscape-design/components/spinner';
import Alert from '@cloudscape-design/components/alert';
import Modal from '@cloudscape-design/components/modal';
import Link from '@cloudscape-design/components/link';
import Tabs from '@cloudscape-design/components/tabs';

import { APP_NAME } from '~/constants/app';
import { infrastructurePlanningClient } from '~/clients/infrastructure-planning-client';
import type {
  PlanConfiguration,
  PlanStatus,
  PlanSourceType,
  CapabilitySet,
} from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import { formatTimestamp } from '~/utils/time-utils';
import type { RouteHandle } from '~/types/route';

export const PAGE_PLAN_DETAIL = 'Plan Detail';

export const handle: RouteHandle = { pageName: PAGE_PLAN_DETAIL };

export function meta() {
  return [
    { title: `${PAGE_PLAN_DETAIL} - ${APP_NAME}` },
    { name: 'description', content: 'View infrastructure plan details' },
  ];
}

function StatusBadge({ status }: { status: PlanStatus }) {
  switch (status) {
    case 'ready':
      return <StatusIndicator type="success">Ready</StatusIndicator>;
    case 'processing':
      return <StatusIndicator type="in-progress">Processing</StatusIndicator>;
    case 'error':
      return <StatusIndicator type="error">Error</StatusIndicator>;
  }
}

function SourceTypeBadge({ sourceType }: { sourceType: PlanSourceType }) {
  switch (sourceType) {
    case 'cloudformation':
      return <Badge color="blue">CloudFormation</Badge>;
    case 'terraform':
      return <Badge color="green">Terraform</Badge>;
    case 'github':
      return <Badge>GitHub</Badge>;
  }
}

export default function PlanDetailPage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [showCreatedFlash, setShowCreatedFlash] = useState(!!(location.state as { created?: boolean })?.created);
  const [plan, setPlan] = useState<PlanConfiguration | null>(null);
  const [capabilitySet, setCapabilitySet] = useState<CapabilitySet | null>(null);
  const [loading, setLoading] = useState(true);
  const [capabilityLoading, setCapabilityLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!planId) return;
    loadPlan(planId);
  }, [planId]);

  async function loadPlan(id: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await infrastructurePlanningClient.getPlan(id);
      setPlan(result);
      if (result.status === 'ready') {
        loadCapabilitySet(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plan');
    } finally {
      setLoading(false);
    }
  }

  async function loadCapabilitySet(id: string) {
    setCapabilityLoading(true);
    try {
      const result = await infrastructurePlanningClient.getCapabilitySet(id);
      setCapabilitySet(result);
    } catch {
      // Capability set may not be available yet
      setCapabilitySet(null);
    } finally {
      setCapabilityLoading(false);
    }
  }

  async function handleReprocess() {
    if (!planId || !plan) return;
    // For GitHub plans, just reprocess (uses stored repositoryUrl)
    if (plan.sourceType === 'github') {
      setReprocessing(true);
      try {
        const result = await infrastructurePlanningClient.reprocessPlan(planId);
        setPlan(result);
        if (result.status === 'ready') {
          loadCapabilitySet(planId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reprocess plan');
      } finally {
        setReprocessing(false);
      }
      return;
    }
    // For CFN/Terraform plans, trigger file picker
    fileInputRef.current?.click();
  }

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !planId) return;
    setReprocessing(true);
    setError(null);
    try {
      const content = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(content)));
      const result = await infrastructurePlanningClient.reprocessPlan(planId, base64);
      setPlan(result);
      if (result.status === 'ready') {
        loadCapabilitySet(planId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reprocess plan');
    } finally {
      setReprocessing(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete() {
    if (!planId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await infrastructurePlanningClient.deletePlan(planId);
      navigate('/infrastructure-planning');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete plan');
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

  if (error || !plan) {
    return (
      <ContentLayout header={<Header variant="h1">Plan Detail</Header>}>
        <Alert type="error" header="Error loading plan">
          {error ?? 'Plan not found'}
        </Alert>
      </ContentLayout>
    );
  }

  const resourceTypeItems = capabilitySet
    ? capabilitySet.cfnResourceTypes.map(type => ({ type, category: 'CloudFormation' as const }))
    : [];

  const terraformTypeItems = capabilitySet
    ? capabilitySet.terraformResourceTypes.map(type => ({
        type,
        category: 'Terraform' as const,
        cfnMapping: capabilitySet.terraformToCfnMapping[type] ?? '—',
      }))
    : [];

  const apiOperationItems = capabilitySet
    ? capabilitySet.apiOperations.map(op => ({ operation: op }))
    : [];

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {plan.status === 'ready' && (
                <Button
                  variant="primary"
                  iconName="angle-right-double"
                  onClick={() => {
                    const tab = capabilitySet?.cfnResourceTypes?.length ? 'cfn'
                      : capabilitySet?.apiOperations?.length ? 'apis'
                      : 'products';
                    navigate(`/?plan=${encodeURIComponent(plan.planName)}&tab=${tab}`);
                  }}
                >
                  View availability
                </Button>
              )}
              <Button
                iconName="refresh"
                loading={reprocessing}
                onClick={handleReprocess}
              >
                Re-process
              </Button>
              <Button onClick={() => setShowDeleteModal(true)}>
                Delete
              </Button>
              <Button onClick={() => navigate('/infrastructure-planning')}>
                Back to list
              </Button>
            </SpaceBetween>
          }
        >
          {plan.planName}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {showCreatedFlash && (
          <Alert type="success" dismissible onDismiss={() => setShowCreatedFlash(false)}>
            Plan created. Your extracted services are now available as a filter on the{' '}
            <Link href="/" variant="primary">Capabilities by Region</Link> page.
          </Alert>
        )}
        {plan.status === 'error' && plan.errorMessage && (
          <Alert type="error" header="Processing error">
            {plan.errorMessage}
          </Alert>
        )}

        <Container header={<Header variant="h2">Overview</Header>}>
          <ColumnLayout columns={3} variant="text-grid">
            <div>
              <Box variant="awsui-key-label">Status</Box>
              <StatusBadge status={plan.status} />
            </div>
            <div>
              <Box variant="awsui-key-label">Source Type</Box>
              <SourceTypeBadge sourceType={plan.sourceType} />
            </div>
            <div>
              <Box variant="awsui-key-label">Resource Types</Box>
              <div>{plan.resourceTypeCount}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">API Operations</Box>
              <div>{plan.apiOperationCount}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Created</Box>
              <div>{formatTimestamp(plan.createdAt)}</div>
            </div>
            <div>
              <Box variant="awsui-key-label">Last Updated</Box>
              <div>{formatTimestamp(plan.updatedAt)}</div>
            </div>
          </ColumnLayout>
        </Container>

        {plan.labels.length > 0 && (
          <Container header={<Header variant="h2">Metadata Labels</Header>}>
            <ColumnLayout columns={4} variant="text-grid">
              {plan.labels.map((label, i) => (
                <div key={i}>
                  <Box variant="awsui-key-label">{label.key}</Box>
                  <div>{label.value}</div>
                </div>
              ))}
            </ColumnLayout>
          </Container>
        )}

        {plan.status === 'ready' && (
          <Container header={<Header variant="h2">Extracted Capability Set</Header>}>
            {capabilityLoading ? (
              <Box textAlign="center" padding="l">
                <Spinner /> Loading capability set...
              </Box>
            ) : capabilitySet ? (
              <Tabs
                tabs={[
                  {
                    label: `Resource Types (${capabilitySet.cfnResourceTypes.length})`,
                    id: 'resource-types',
                    content: (
                      <Table
                        items={resourceTypeItems}
                        columnDefinitions={[
                          {
                            id: 'type',
                            header: 'CloudFormation Resource Type',
                            cell: item => item.type,
                            sortingField: 'type',
                          },
                        ]}
                        sortingDisabled={false}
                        variant="embedded"
                        empty={
                          <Box textAlign="center" color="inherit">
                            No CloudFormation resource types extracted.
                          </Box>
                        }
                      />
                    ),
                  },
                  ...(capabilitySet.terraformResourceTypes.length > 0
                    ? [
                        {
                          label: `Terraform Types (${capabilitySet.terraformResourceTypes.length})`,
                          id: 'terraform-types',
                          content: (
                            <Table
                              items={terraformTypeItems}
                              columnDefinitions={[
                                {
                                  id: 'type',
                                  header: 'Terraform Resource Type',
                                  cell: (item: { type: string; category: 'Terraform'; cfnMapping: string }) => item.type,
                                  sortingField: 'type',
                                },
                                {
                                  id: 'cfnMapping',
                                  header: 'CloudFormation Mapping',
                                  cell: (item: { type: string; category: 'Terraform'; cfnMapping: string }) => item.cfnMapping,
                                  sortingField: 'cfnMapping',
                                },
                              ]}
                              sortingDisabled={false}
                              variant="embedded"
                              empty={
                                <Box textAlign="center" color="inherit">
                                  No Terraform resource types extracted.
                                </Box>
                              }
                            />
                          ),
                        },
                      ]
                    : []),
                  {
                    label: `API Operations (${capabilitySet.apiOperations.length})`,
                    id: 'api-operations',
                    content: (
                      <Table
                        items={apiOperationItems}
                        columnDefinitions={[
                          {
                            id: 'operation',
                            header: 'API Operation',
                            cell: item => item.operation,
                            sortingField: 'operation',
                          },
                        ]}
                        sortingDisabled={false}
                        variant="embedded"
                        empty={
                          <Box textAlign="center" color="inherit">
                            No API operations extracted.
                          </Box>
                        }
                      />
                    ),
                  },
                  {
                    label: `Services (${capabilitySet.serviceNames.length})`,
                    id: 'services',
                    content: (
                      <Table
                        items={capabilitySet.serviceNames.map(name => ({ name }))}
                        columnDefinitions={[
                          {
                            id: 'name',
                            header: 'Service Name',
                            cell: item => item.name,
                            sortingField: 'name',
                          },
                        ]}
                        sortingDisabled={false}
                        variant="embedded"
                        empty={
                          <Box textAlign="center" color="inherit">
                            No service names derived.
                          </Box>
                        }
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <Box textAlign="center" color="inherit">
                Capability set data is not available.
              </Box>
            )}
          </Container>
        )}

        {showDeleteModal && (
          <Modal
            visible={true}
            onDismiss={() => setShowDeleteModal(false)}
            header="Delete infrastructure plan"
            footer={
              <Box float="right">
                <SpaceBetween direction="horizontal" size="xs">
                  <Button variant="link" onClick={() => setShowDeleteModal(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" loading={deleting} onClick={handleDelete}>
                    Delete
                  </Button>
                </SpaceBetween>
              </Box>
            }
          >
            <SpaceBetween size="m">
              {deleteError && (
                <Alert type="error" header="Delete failed">
                  {deleteError}
                </Alert>
              )}
              <Box>
                Permanently delete the infrastructure plan <strong>{plan.planName}</strong> and its
                extracted capability set data. This action cannot be undone.
              </Box>
            </SpaceBetween>
          </Modal>
        )}
      </SpaceBetween>

      {/* Hidden file input for re-process upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept={plan.sourceType === 'terraform' ? '.tf' : '.yaml,.yml,.json'}
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
    </ContentLayout>
  );
}
