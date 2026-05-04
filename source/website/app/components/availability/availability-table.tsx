import { useCallback, useMemo, useRef, useState } from 'react';
import { useCollection } from '@cloudscape-design/collection-hooks';
import Table from '@cloudscape-design/components/table';
import PropertyFilter from '@cloudscape-design/components/property-filter';
import type { PropertyFilterProps } from '@cloudscape-design/components/property-filter';
import type { CollectionPreferencesProps } from '@cloudscape-design/components/collection-preferences';
import Pagination from '@cloudscape-design/components/pagination';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import Flashbar from '@cloudscape-design/components/flashbar';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { RegionalAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { StackResourcesResponse } from '@capability-insights/shared/types/capability/stack';
import type { ExportUrls } from '~/clients/capability-insights-client';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';
import {
  createColumns,
  createFilteringProperties,
  createFilteringFunction,
  TablePreferences,
} from './availability-table-properties';

interface AvailabilityTableProps<T extends RegionalAvailability> {
  title: string;
  nameHeader: string;
  nameCell: (row: T) => React.ReactNode;
  regions: Region[];
  regionalAvailability: T[];
  downloadUrls: ExportUrls;
  loading?: boolean;
  /** Whether to include the Stack filtering property (CFN tab only). */
  includeStackProperty?: boolean;
}

export default function AvailabilityTable<T extends RegionalAvailability>({
  title,
  nameHeader,
  nameCell,
  regions,
  regionalAvailability,
  downloadUrls,
  loading = false,
  includeStackProperty = false,
}: AvailabilityTableProps<T>) {
  const [preferences, setPreferences] = useState<CollectionPreferencesProps.Preferences>({
    stickyColumns: { first: 1, last: 0 },
  });

  // --- Stack integration state ---
  const stackResourceCache = useRef<Map<string, StackResourcesResponse>>(new Map());
  // Track loading names in a ref (not state) so the guard check works synchronously
  // without triggering re-renders during the filtering function's render-phase execution.
  const stackLoadingNamesRef = useRef<Set<string>>(new Set());
  const [stackLoading, setStackLoading] = useState(false);
  const [stackError, setStackError] = useState<string | null>(null);
  const [stackFilteringOptions, setStackFilteringOptions] = useState<PropertyFilterProps.FilteringOption[]>([]);
  // Counter to force re-render when cache is updated (since useRef doesn't trigger re-renders)
  const [renderTick, setRenderTick] = useState(0);

  const onStackDataNeeded = useCallback((stackName: string) => {
    // Skip if already cached or currently loading.
    // This callback is invoked from inside the filtering function which runs during
    // the render phase — we must NOT call setState here. Instead, defer the fetch
    // with queueMicrotask so the state update happens after the render completes.
    if (stackResourceCache.current.has(stackName)) return;
    if (stackLoadingNamesRef.current.has(stackName)) return;
    stackLoadingNamesRef.current.add(stackName);

    queueMicrotask(() => {
      setStackLoading(true);
      capabilityInsightsClient
        .getStackResourceTypes(stackName)
        .then(result => {
          stackResourceCache.current.set(stackName, result);
          stackLoadingNamesRef.current.delete(stackName);
          setStackLoading(stackLoadingNamesRef.current.size > 0);
          // Trigger re-render so the filtering function picks up the new cache entry
          setRenderTick(t => t + 1);
        })
        .catch(err => {
          // Store empty response so the token matches no rows
          stackResourceCache.current.set(stackName, { resourceTypePairs: [], propertyMatches: [] });
          stackLoadingNamesRef.current.delete(stackName);
          setStackLoading(stackLoadingNamesRef.current.size > 0);
          setStackError(err instanceof Error ? err.message : 'Failed to load stack resources');
          setRenderTick(t => t + 1);
        });
    });
  }, []);

  const handleLoadItems = useCallback(({ detail }: { detail: PropertyFilterProps.LoadItemsDetail }) => {
    // Only fetch stack names when the user is typing in the Stack property value field
    if (detail.filteringProperty?.key !== 'stack') return;
    if (!detail.firstPage && !detail.samePage) return;

    capabilityInsightsClient
      .listStacks()
      .then(stacks => {
        setStackFilteringOptions(stacks.map(name => ({ propertyKey: 'stack', value: name })));
      })
      .catch(() => {
        // Silently fail — the user can still type a stack name manually
        setStackFilteringOptions([]);
      });
  }, []);

  const columnDefinitions = createColumns({
    nameColumnHeader: nameHeader,
    regions,
    nameCell: nameCell as (row: RegionalAvailability) => React.ReactNode,
  });
  const filteringProperties = createFilteringProperties(regions, { includeStackProperty });
  const filteringFunction = useMemo(
    () =>
      createFilteringFunction(
        regionalAvailability,
        includeStackProperty ? stackResourceCache.current : undefined,
        includeStackProperty ? onStackDataNeeded : undefined,
      ),
    [regionalAvailability, includeStackProperty, onStackDataNeeded, renderTick],
  );

  const hasNesting = regionalAvailability.some(i => i.parentId !== null);
  const parentItems = useMemo(
    () => regionalAvailability.filter(i => i.parentId === null && regionalAvailability.some(c => c.parentId === i.id)),
    [regionalAvailability],
  );

  const {
    items: collectionItems,
    actions,
    collectionProps,
    propertyFilterProps,
    filteredItemsCount,
    paginationProps,
  } = useCollection(regionalAvailability, {
    sorting: {},
    pagination: { pageSize: 20 },
    propertyFiltering: {
      filteringProperties,
      filteringFunction,
      noMatch: ' ',
    },
    ...(hasNesting && {
      expandableRows: {
        getId: item => item.id,
        getParentId: item => item.parentId,
      },
    }),
  });

  const allExpanded = hasNesting && (collectionProps.expandableRows?.expandedItems.length ?? 0) > 0;

  const regionOptionValues = Object.values(AvailabilityStatus);
  const regionFilteringOptions = regions.flatMap(r =>
    regionOptionValues.map(status => ({ propertyKey: `region:${r.Region}`, value: status })),
  );
  const filteringOptions = [
    ...propertyFilterProps.filteringOptions,
    ...regionFilteringOptions,
    ...(includeStackProperty ? stackFilteringOptions : []),
  ];

  return (
    <SpaceBetween size="m">
      {stackError && (
        <Flashbar
          items={[
            {
              type: 'error',
              content: stackError,
              dismissible: true,
              onDismiss: () => setStackError(null),
              id: 'stack-filter-error',
            },
          ]}
        />
      )}
      <Table
        {...collectionProps}
        columnDefinitions={columnDefinitions}
        items={collectionItems}
        loading={loading || (includeStackProperty && stackLoading)}
        loadingText="Loading data"
        stickyColumns={preferences.stickyColumns}
        columnDisplay={preferences.contentDisplay}
        variant="embedded"
        resizableColumns
        enableKeyboardNavigation
        header={
          <Header
            counter={`(${filteredItemsCount})`}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                {hasNesting && (
                  <Button
                    iconName={allExpanded ? 'treeview-collapse' : 'treeview-expand'}
                    onClick={() => actions.setExpandedItems(allExpanded ? [] : parentItems)}
                  >
                    {allExpanded ? 'Collapse all' : 'Expand all'}
                  </Button>
                )}
                <ButtonDropdown
                  items={[
                    { id: 'json', text: 'Download as JSON' },
                    { id: 'csv', text: 'Download as CSV' },
                  ]}
                  onItemClick={({ detail }) => {
                    const url = detail.id === 'json' ? downloadUrls.json : downloadUrls.csv;
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = '';
                    a.click();
                  }}
                  ariaLabel={`Export ${title}`}
                >
                  Export
                </ButtonDropdown>
              </SpaceBetween>
            }
          >
            {title}
          </Header>
        }
        filter={
          <PropertyFilter
            {...propertyFilterProps}
            filteringOptions={filteringOptions}
            filteringPlaceholder={`Filter ${title.toLowerCase()}`}
            countText={`${filteredItemsCount} matches`}
            expandToViewport
            enableTokenGroups
            virtualScroll
            customGroupsText={[
              {
                properties: 'Properties',
                values: 'Property values',
                group: 'properties',
              },
              { properties: 'Regions', values: 'Region values', group: 'regions' },
            ]}
            {...(includeStackProperty ? { onLoadItems: handleLoadItems } : {})}
          />
        }
        pagination={<Pagination {...paginationProps} />}
        preferences={
          <TablePreferences columns={columnDefinitions} preferences={preferences} setPreferences={setPreferences} />
        }
        expandableRows={collectionProps.expandableRows}
      />
    </SpaceBetween>
  );
}
