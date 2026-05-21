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

import { APP_NAME, PAGE_INFRASTRUCTURE_PLANNING } from '~/constants/app';
import { infrastructurePlanningClient } from '~/clients/infrastructure-planning-client';
import type { PlanConfiguration, PlanSourceType, PlanStatus } from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import { formatTimestamp } from '~/utils/time-utils';
import { useHelpPanel } from '~/contexts/help-panel-context';
import InfrastructurePlanningHelpPanel from '~/components/help/InfrastructurePlanningHelpPanel';
import type { RouteHandle } from '~/types/route';

export const handle: RouteHandle = { pageName: PAGE_INFRASTRUCTURE_PLANNING };

export function meta() {
  return [
    { title: `${PAGE_INFRASTRUCTURE_PLANNING} - ${APP_NAME}` },
    { name: 'description', content: 'Manage infrastructure plans for regional availability filtering' },
  ];
}

const SOURCE_TYPE_OPTIONS: SelectProps.Option[] = [
  { value: '', label: 'All source types' },
  { value: 'cloudformation', label: 'CloudFormation' },
  { value: 'terraform', label: 'Terraform' },
  { value: 'github', label: 'GitHub' },
];

function SourceTypeCell({ sourceType }: { sourceType: PlanSourceType }) {
  switch (sourceType) {
    case 'cloudformation':
      return <Badge color="blue">CloudFormation</Badge>;
    case 'terraform':
      return <Badge color="green">Terraform</Badge>;
    case 'github':
      return <Badge>GitHub</Badge>;
  }
}

function StatusCell({ status }: { status: PlanStatus }) {
  switch (status) {
    case 'ready':
      return <StatusIndicator type="success">Ready</StatusIndicator>;
    case 'processing':
      return <StatusIndicator type="in-progress">Processing</StatusIndicator>;
    case 'error':
      return <StatusIndicator type="error">Error</StatusIndicator>;
  }
}

function LabelsCell({ plan }: { plan: PlanConfiguration }) {
  if (!plan.labels || plan.labels.length === 0) {
    return <span>—</span>;
  }
  return (
    <SpaceBetween direction="horizontal" size="xs">
      {plan.labels.map((label, i) => (
        <Badge key={i}>{label.key}: {label.value}</Badge>
      ))}
    </SpaceBetween>
  );
}

export default function InfrastructurePlanningPage() {
  const navigate = useNavigate();
  const { setToolsContent } = useHelpPanel();
  useEffect(() => { setToolsContent(<InfrastructurePlanningHelpPanel />); }, []);
  const [plans, setPlans] = useState<PlanConfiguration[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceTypeFilter, setSourceTypeFilter] = useState<SelectProps.Option>(SOURCE_TYPE_OPTIONS[0]);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const result = await infrastructurePlanningClient.listPlans(
        sourceTypeFilter.value ? { sourceType: sourceTypeFilter.value as PlanSourceType } : undefined,
      );
      setPlans(result);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [sourceTypeFilter.value]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const { items, filteredItemsCount, collectionProps, filterProps, paginationProps } =
    useCollection(plans, {
      filtering: {
        empty: (
          <Box textAlign="center" color="inherit">
            <b>No plans</b>
            <Box padding={{ bottom: 's' }} variant="p" color="inherit">
              No infrastructure plans found.
            </Box>
          </Box>
        ),
        noMatch: (
          <Box textAlign="center" color="inherit">
            <b>No matches</b>
            <Box padding={{ bottom: 's' }} variant="p" color="inherit">
              No plans match the current filter criteria.
            </Box>
          </Box>
        ),
        filteringFunction: (item, filteringText) => {
          const searchText = filteringText.toLowerCase();
          const nameMatch = item.planName.toLowerCase().includes(searchText);
          const sourceMatch = item.sourceType.toLowerCase().includes(searchText);
          const labelMatch = item.labels.some(
            label =>
              label.key.toLowerCase().includes(searchText) ||
              label.value.toLowerCase().includes(searchText),
          );
          return nameMatch || sourceMatch || labelMatch;
        },
      },
      pagination: { pageSize: 20 },
      sorting: {
        defaultState: { sortingColumn: { sortingField: 'planName' }, isDescending: false },
      },
    });

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Upload infrastructure templates to identify your AWS dependencies. Created plans are available as a filter on the Capabilities by Region page."
        >
          {PAGE_INFRASTRUCTURE_PLANNING}
        </Header>
      }
    >
      <Table
        {...collectionProps}
        variant="full-page"
        stickyHeader
        loading={loading}
        loadingText="Loading plans..."
        items={items}
        header={
          <Header
            counter={`(${filteredItemsCount ?? plans.length})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" onClick={loadPlans} disabled={loading}>
                  Reload
                </Button>
                <Button variant="primary" onClick={() => navigate('/infrastructure-planning/create')}>
                  Create plan
                </Button>
              </SpaceBetween>
            }
          >
            Infrastructure Plans
          </Header>
        }
        filter={
          <SpaceBetween direction="horizontal" size="xs">
            <TextFilter
              {...filterProps}
              filteringPlaceholder="Search by name, source type, or labels"
              countText={`${filteredItemsCount ?? 0} match${(filteredItemsCount ?? 0) === 1 ? '' : 'es'}`}
            />
            <Select
              selectedOption={sourceTypeFilter}
              onChange={({ detail }) => setSourceTypeFilter(detail.selectedOption)}
              options={SOURCE_TYPE_OPTIONS}
              placeholder="Filter by source type"
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
                href={`/infrastructure-planning/${item.planId}`}
                onFollow={(e) => {
                  e.preventDefault();
                  navigate(`/infrastructure-planning/${item.planId}`);
                }}
              >
                {item.planName}
              </Link>
            ),
            sortingField: 'planName',
            width: 220,
          },
          {
            id: 'sourceType',
            header: 'Source Type',
            cell: item => <SourceTypeCell sourceType={item.sourceType} />,
            sortingField: 'sourceType',
            width: 140,
          },
          {
            id: 'resourceCount',
            header: 'Resources',
            cell: item => item.resourceTypeCount,
            sortingField: 'resourceTypeCount',
            width: 110,
          },
          {
            id: 'apiOperationCount',
            header: 'API Operations',
            cell: item => item.apiOperationCount,
            sortingField: 'apiOperationCount',
            width: 130,
          },
          {
            id: 'status',
            header: 'Status',
            cell: item => <StatusCell status={item.status} />,
            sortingField: 'status',
            width: 120,
          },
          {
            id: 'createdAt',
            header: 'Created',
            cell: item => formatTimestamp(item.createdAt),
            sortingField: 'createdAt',
            width: 160,
          },
          {
            id: 'labels',
            header: 'Labels',
            cell: item => <LabelsCell plan={item} />,
            width: 250,
          },
        ]}
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="m">
              <b>No infrastructure plans</b>
              <Box variant="p" color="inherit">
                You haven&apos;t created any infrastructure plans yet.
              </Box>
              <Button variant="primary" onClick={() => navigate('/infrastructure-planning/create')}>
                Create plan
              </Button>
            </SpaceBetween>
          </Box>
        }
      />
    </ContentLayout>
  );
}
