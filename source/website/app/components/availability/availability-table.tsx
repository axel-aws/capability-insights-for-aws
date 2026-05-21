import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '@cloudscape-design/collection-hooks';
import type { PropertyFilterQuery } from '@cloudscape-design/collection-hooks';
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
import type { CapabilitySet } from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import type { ExportUrls } from '~/clients/capability-insights-client';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';
import { infrastructurePlanningClient } from '~/clients/infrastructure-planning-client';
import {
  createColumns,
  createFilteringProperties,
  createFilteringFunction,
  itemMatchesPlanTerraform,
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
  /** Whether to include the Plan filtering property. */
  includePlanProperty?: boolean;
  /** Optional initial PropertyFilter query to pre-populate the filter on mount. */
  initialQuery?: PropertyFilterQuery;
  /** Optional custom cell renderer for availability (region) columns. */
  availabilityCell?: (row: T, regionCode: string) => React.ReactNode;
  /**
   * Optional custom filtering function that overrides the default property-filter-based filtering.
   * When provided, this function is used instead of `createFilteringFunction`.
   * It receives the item and the property filter query, and returns true if the item should be shown.
   */
  customFilteringFunction?: (item: T, query: PropertyFilterQuery) => boolean;
  /** Optional additional actions to render in the table header alongside the default actions. */
  headerActions?: React.ReactNode;
  /** Callback when the PropertyFilter query changes. Used to persist region filters across tabs. */
  onFilterChange?: (query: PropertyFilterQuery) => void;
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
  includePlanProperty = false,
  initialQuery,
  availabilityCell,
  customFilteringFunction,
  headerActions,
  onFilterChange,
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

  // --- Plan integration state ---
  const planCapabilityCache = useRef<Map<string, CapabilitySet>>(new Map());
  const planLoadingNamesRef = useRef<Set<string>>(new Set());
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planFilteringOptions, setPlanFilteringOptions] = useState<PropertyFilterProps.FilteringOption[]>([]);

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

  const onPlanDataNeeded = useCallback((planName: string) => {
    // Skip if already cached or currently loading.
    // Same deferred pattern as onStackDataNeeded to avoid setState during render.
    if (planCapabilityCache.current.has(planName)) return;
    if (planLoadingNamesRef.current.has(planName)) return;
    planLoadingNamesRef.current.add(planName);

    queueMicrotask(() => {
      setPlanLoading(true);
      // Look up the plan by name to get its planId, then fetch the capability set
      infrastructurePlanningClient
        .listPlans({ search: planName })
        .then(plans => {
          const plan = plans.find(p => p.planName === planName);
          if (!plan) {
            throw new Error(`Plan "${planName}" not found`);
          }
          return infrastructurePlanningClient.getCapabilitySet(plan.planId);
        })
        .then(capabilitySet => {
          planCapabilityCache.current.set(planName, capabilitySet);
          planLoadingNamesRef.current.delete(planName);
          setPlanLoading(planLoadingNamesRef.current.size > 0);
          // Trigger re-render so the filtering function picks up the new cache entry
          setRenderTick(t => t + 1);
        })
        .catch(err => {
          // Store empty capability set so the filter fails-open (matches everything)
          planCapabilityCache.current.set(planName, {
            cfnResourceTypes: [],
            terraformResourceTypes: [],
            apiOperations: [],
            serviceNames: [],
            terraformToCfnMapping: {},
          });
          planLoadingNamesRef.current.delete(planName);
          setPlanLoading(planLoadingNamesRef.current.size > 0);
          setPlanError(err instanceof Error ? err.message : 'Failed to load plan capability set');
          setRenderTick(t => t + 1);
        });
    });
  }, []);

  const handleLoadItems = useCallback(({ detail }: { detail: PropertyFilterProps.LoadItemsDetail }) => {
    // Fetch stack names when the user is typing in the Stack property value field
    if (detail.filteringProperty?.key === 'stack') {
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
    }

    // Fetch plan names when the user is typing in the Plan property value field
    if (detail.filteringProperty?.key === 'plan') {
      if (!detail.firstPage && !detail.samePage) return;
      infrastructurePlanningClient
        .listPlanNames()
        .then(names => {
          setPlanFilteringOptions(names.map(name => ({ propertyKey: 'plan', value: name })));
        })
        .catch(() => {
          // Silently fail — the user can still type a plan name manually
          setPlanFilteringOptions([]);
        });
    }
  }, []);

  const columnDefinitions = createColumns({
    nameColumnHeader: nameHeader,
    regions,
    nameCell: nameCell as (row: RegionalAvailability) => React.ReactNode,
    availabilityCell: availabilityCell as ((row: RegionalAvailability, regionCode: string) => React.ReactNode) | undefined,
  });
  const filteringProperties = createFilteringProperties(regions, { includeStackProperty, includePlanProperty });
  const filteringFunction = useMemo(
    () => {
      if (customFilteringFunction && includePlanProperty) {
        // Wrap the custom filtering function to also handle plan tokens.
        // The custom function handles free-text and other property tokens;
        // we intercept plan tokens and evaluate them using itemMatchesPlanTerraform.
        const baseFn = customFilteringFunction as (item: RegionalAvailability, query: PropertyFilterQuery) => boolean;
        const byId = new Map(regionalAvailability.map(i => [i.id, i]));

        return (item: RegionalAvailability, query: PropertyFilterQuery): boolean => {
          const tokens = query.tokenGroups ?? query.tokens;
          if (!tokens || tokens.length === 0) return baseFn(item, query);

          // Separate plan tokens from other tokens
          type TokenType = (typeof tokens)[number];
          const planTokens: Array<{ operator: string; value: string }> = [];
          const otherTokens: TokenType[] = [];

          for (const token of tokens) {
            if ('operation' in token) {
              otherTokens.push(token);
            } else if (token.propertyKey === 'plan') {
              planTokens.push({ operator: token.operator, value: token.value as string });
            } else {
              otherTokens.push(token);
            }
          }

          // If no plan tokens, delegate entirely to the custom function
          if (planTokens.length === 0) return baseFn(item, query);

          // Evaluate plan tokens
          const planPass = planTokens[query.operation === 'or' ? 'some' : 'every'](planToken => {
            const planName = planToken.value;
            const capabilitySet = planCapabilityCache.current.get(planName);
            if (!capabilitySet) {
              // Signal that we need this plan's data; fail-open until loaded
              onPlanDataNeeded(planName);
              return true;
            }
            const matches = itemMatchesPlanTerraform(item, capabilitySet, byId);
            return planToken.operator === '=' ? matches : !matches;
          });

          // If there are no other tokens, just return plan result
          if (otherTokens.length === 0) return planPass;

          // Evaluate other tokens via the custom function (with plan tokens removed).
          // The baseFn reads `query.tokenGroups ?? query.tokens`, so we set tokenGroups
          // with the remaining tokens (which may include PropertyFilterTokenGroup objects).
          const otherQuery: PropertyFilterQuery = {
            operation: query.operation,
            tokens: [] as unknown as PropertyFilterQuery['tokens'],
            tokenGroups: otherTokens as unknown as PropertyFilterQuery['tokenGroups'],
          };
          const otherPass = baseFn(item, otherQuery);

          // Combine results based on query operation
          if (query.operation === 'and') return planPass && otherPass;
          return planPass || otherPass;
        };
      }

      if (customFilteringFunction) {
        return customFilteringFunction as (item: RegionalAvailability, query: PropertyFilterQuery) => boolean;
      }

      return createFilteringFunction(
        regionalAvailability,
        includeStackProperty ? stackResourceCache.current : undefined,
        includeStackProperty ? onStackDataNeeded : undefined,
        includePlanProperty ? planCapabilityCache.current : undefined,
        includePlanProperty ? onPlanDataNeeded : undefined,
      );
    },
    [regionalAvailability, includeStackProperty, includePlanProperty, onStackDataNeeded, onPlanDataNeeded, renderTick, customFilteringFunction],
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
      ...(initialQuery ? { defaultQuery: initialQuery } : {}),
    },
    ...(hasNesting && {
      expandableRows: {
        getId: item => item.id,
        getParentId: item => item.parentId,
      },
    }),
  });

  const allExpanded = hasNesting && (collectionProps.expandableRows?.expandedItems.length ?? 0) > 0;

  // Notify parent of filter changes for cross-tab persistence
  const filterQuery = propertyFilterProps.query;
  useEffect(() => {
    if (onFilterChange) onFilterChange(filterQuery);
  }, [filterQuery, onFilterChange]);

  // Auto-expand when filter narrows to 5 or fewer parent services
  useEffect(() => {
    if (!hasNesting || !actions.setExpandedItems) return;
    const hasActiveFilter = (filterQuery.tokens?.length ?? 0) > 0;
    if (!hasActiveFilter) return;
    // Count filtered parent items visible in the current results
    const filteredParents = parentItems.filter(p =>
      collectionItems.some(i => i.id === p.id) || collectionItems.some(i => i.parentId === p.id)
    );
    if (filteredParents.length > 0 && filteredParents.length <= 5) {
      actions.setExpandedItems(filteredParents);
    }
  }, [filteredItemsCount]);

  const regionOptionValues = Object.values(AvailabilityStatus);
  const regionFilteringOptions = regions.flatMap(r =>
    regionOptionValues.map(status => ({ propertyKey: `region:${r.Region}`, value: status })),
  );
  const filteringOptions = [
    ...propertyFilterProps.filteringOptions,
    ...regionFilteringOptions,
    ...(includeStackProperty ? stackFilteringOptions : []),
    ...(includePlanProperty ? planFilteringOptions : []),
  ];

  return (
    <SpaceBetween size="m">
      {(stackError || planError) && (
        <Flashbar
          items={[
            ...(stackError
              ? [
                  {
                    type: 'error' as const,
                    content: stackError,
                    dismissible: true,
                    onDismiss: () => setStackError(null),
                    id: 'stack-filter-error',
                  },
                ]
              : []),
            ...(planError
              ? [
                  {
                    type: 'error' as const,
                    content: planError,
                    dismissible: true,
                    onDismiss: () => setPlanError(null),
                    id: 'plan-filter-error',
                  },
                ]
              : []),
          ]}
        />
      )}
      <Table
        {...collectionProps}
        columnDefinitions={columnDefinitions}
        items={collectionItems}
        loading={loading || (includeStackProperty && stackLoading) || (includePlanProperty && planLoading)}
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
                {headerActions}
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
            {...(includeStackProperty || includePlanProperty ? { onLoadItems: handleLoadItems } : {})}
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
