import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useCollection } from '@cloudscape-design/collection-hooks';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Table from '@cloudscape-design/components/table';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import TextFilter from '@cloudscape-design/components/text-filter';
import Pagination from '@cloudscape-design/components/pagination';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Badge from '@cloudscape-design/components/badge';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';

import { APP_NAME } from '~/constants/app';
import { policyEnforcerClient } from '~/clients/policy-enforcer-client';
import type { PolicyConfiguration, PolicyStatus } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { formatTimestamp } from '~/utils/time-utils';
import type { RouteHandle } from '~/types/route';

export const PAGE_POLICY_ENFORCER = 'Policy Enforcer';

export const handle: RouteHandle = { pageName: PAGE_POLICY_ENFORCER };

export function meta() {
  return [
    { title: `${PAGE_POLICY_ENFORCER} - ${APP_NAME}` },
    { name: 'description', content: 'Manage policy configurations for regional governance' },
  ];
}

const STATUS_OPTIONS: SelectProps.Option[] = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'error', label: 'Error' },
];

function StatusCell({ status }: { status: PolicyStatus }) {
  switch (status) {
    case 'active':
      return <StatusIndicator type="success">Active</StatusIndicator>;
    case 'pending':
      return <StatusIndicator type="pending">Pending</StatusIndicator>;
    case 'error':
      return <StatusIndicator type="error">Error</StatusIndicator>;
  }
}

function RefreshOutcomeCell({ policy }: { policy: PolicyConfiguration }) {
  if (!policy.lastRefreshTime) {
    return <Box color="text-status-inactive">No refresh yet</Box>;
  }

  const timestamp = formatTimestamp(policy.lastRefreshTime);

  switch (policy.lastRefreshOutcome) {
    case 'success':
      return (
        <StatusIndicator type="success">
          {timestamp}
        </StatusIndicator>
      );
    case 'retained':
      return (
        <StatusIndicator type="warning">
          {timestamp} (retained)
        </StatusIndicator>
      );
    case 'error':
      return (
        <StatusIndicator type="error">
          {timestamp} (failed)
        </StatusIndicator>
      );
    default:
      return <span>{timestamp}</span>;
  }
}

function TagsCell({ policy }: { policy: PolicyConfiguration }) {
  if (!policy.tags || policy.tags.length === 0) {
    return <span>—</span>;
  }
  return (
    <SpaceBetween direction="horizontal" size="xs">
      {policy.tags.map((tag, i) => (
        <Badge key={i}>{tag.key}: {tag.value}</Badge>
      ))}
    </SpaceBetween>
  );
}

export default function PolicyEnforcerPage() {
  const navigate = useNavigate();
  const [policies, setPolicies] = useState<PolicyConfiguration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<SelectProps.Option>(STATUS_OPTIONS[0]);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const result = await policyEnforcerClient.listPolicies(
        statusFilter.value ? { status: statusFilter.value as PolicyStatus } : undefined,
      );
      setPolicies(result);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter.value]);

  useEffect(() => {
    loadPolicies();
  }, [loadPolicies]);

  const handleRefresh = async (policyId: string) => {
    setRefreshingIds(prev => new Set(prev).add(policyId));
    try {
      await policyEnforcerClient.refreshPolicy(policyId);
      await loadPolicies();
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(policyId);
        return next;
      });
    }
  };

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } =
    useCollection(policies, {
      filtering: {
        empty: (
          <Box textAlign="center" color="inherit">
            <b>No policies</b>
            <Box padding={{ bottom: 's' }} variant="p" color="inherit">
              No policy configurations found.
            </Box>
          </Box>
        ),
        noMatch: (
          <Box textAlign="center" color="inherit">
            <b>No matches</b>
            <Box padding={{ bottom: 's' }} variant="p" color="inherit">
              No policies match the current filter criteria.
            </Box>
          </Box>
        ),
        filteringFunction: (item, filteringText) => {
          const searchText = filteringText.toLowerCase();
          const nameMatch = item.policyName.toLowerCase().includes(searchText);
          const descMatch = (item.description ?? '').toLowerCase().includes(searchText);
          const tagMatch = item.tags.some(
            tag =>
              tag.key.toLowerCase().includes(searchText) ||
              tag.value.toLowerCase().includes(searchText),
          );
          return nameMatch || descMatch || tagMatch;
        },
      },
      pagination: { pageSize: 20 },
      sorting: {
        defaultState: { sortingColumn: { sortingField: 'policyName' }, isDescending: false },
      },
    });

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Create and manage policies that restrict AWS capabilities based on regional availability."
        >
          {PAGE_POLICY_ENFORCER}
        </Header>
      }
    >
      <Table
        {...collectionProps}
        variant="full-page"
        stickyHeader
        loading={loading}
        loadingText="Loading policies..."
        items={items}
        header={
          <Header
            counter={`(${filteredItemsCount ?? policies.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={loadPolicies} disabled={loading}>
                  Reload
                </Button>
                <Button variant="primary" onClick={() => navigate('/policy-enforcer/create')}>
                  Create Policy
                </Button>
              </SpaceBetween>
            }
          >
            Policy Configurations
          </Header>
        }
        filter={
          <SpaceBetween direction="horizontal" size="xs">
            <TextFilter
              {...filterProps}
              filteringPlaceholder="Search by name, description, or tags"
              countText={`${filteredItemsCount ?? 0} match${(filteredItemsCount ?? 0) === 1 ? '' : 'es'}`}
            />
            <Select
              selectedOption={statusFilter}
              onChange={({ detail }) => setStatusFilter(detail.selectedOption)}
              options={STATUS_OPTIONS}
              placeholder="Filter by status"
            />
          </SpaceBetween>
        }
        pagination={<Pagination {...paginationProps} />}
        columnDefinitions={[
          {
            id: 'name',
            header: 'Name',
            cell: item => (
              <Link
                href={`/policy-enforcer/${item.policyId}`}
                onFollow={(e) => {
                  e.preventDefault();
                  navigate(`/policy-enforcer/${item.policyId}`);
                }}
              >
                {item.policyName}
              </Link>
            ),
            sortingField: 'policyName',
            width: 200,
          },
          {
            id: 'regions',
            header: 'Regions',
            cell: item => <Badge>{item.regions.length}</Badge>,
            sortingComparator: (a, b) => a.regions.length - b.regions.length,
            width: 100,
          },
          {
            id: 'mode',
            header: 'Mode',
            cell: item => (item.mode === 'intersection' ? 'Intersection' : 'Union'),
            sortingField: 'mode',
            width: 120,
          },
          {
            id: 'policyType',
            header: 'Policy Type',
            cell: item => item.policyType,
            sortingField: 'policyType',
            width: 110,
          },
          {
            id: 'status',
            header: 'Status',
            cell: item => <StatusCell status={item.status} />,
            sortingField: 'status',
            width: 120,
          },
          {
            id: 'lastRefresh',
            header: 'Last Refresh',
            cell: item => <RefreshOutcomeCell policy={item} />,
            sortingField: 'lastRefreshTime',
            width: 200,
          },
          {
            id: 'tags',
            header: 'Tags',
            cell: item => <TagsCell policy={item} />,
            width: 250,
          },
          {
            id: 'actions',
            header: 'Actions',
            cell: item => (
              <Button
                iconName="refresh"
                variant="inline-icon"
                loading={refreshingIds.has(item.policyId)}
                onClick={() => handleRefresh(item.policyId)}
                ariaLabel={`Refresh policy ${item.policyName}`}
              />
            ),
            width: 80,
          },
        ]}
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <b>No policy configurations</b>
              <Box variant="p" color="inherit">
                You haven&apos;t created any policy configurations yet.
              </Box>
              <Button variant="primary" onClick={() => navigate('/policy-enforcer/create')}>
                Create Policy
              </Button>
            </SpaceBetween>
          </Box>
        }
      />
    </ContentLayout>
  );
}
