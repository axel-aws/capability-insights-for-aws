import type { TableProps } from '@cloudscape-design/components/table';
import type { PropertyFilterProps } from '@cloudscape-design/components/property-filter';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import type {
  PropertyFilterQuery,
  PropertyFilterToken,
  PropertyFilterTokenGroup,
} from '@cloudscape-design/collection-hooks';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { RegionalAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import type { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { StackResourcesResponse, PropertyMatch } from '@capability-insights/shared/types/capability/stack';
import type { CapabilitySet } from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import AvailabilityStatusIndicator from '~/components/availability/availability-status-indicator';

const enumOperators: PropertyFilterProps.FilteringProperty['operators'] = [
  { operator: '=', tokenType: 'enum' },
  { operator: '!=', tokenType: 'enum' },
];

export function createColumns({
  nameColumnHeader,
  regions,
  nameCell,
  availabilityCell,
}: {
  nameColumnHeader: string;
  regions: Region[];
  nameCell?: (row: RegionalAvailability) => React.ReactNode;
  availabilityCell?: (row: RegionalAvailability, regionCode: string) => React.ReactNode;
}): TableProps.ColumnDefinition<RegionalAvailability>[] {
  return [
    {
      id: 'name',
      header: nameColumnHeader,
      cell: row => (nameCell ? nameCell(row) : row.name),
      sortingField: 'name',
      isRowHeader: true,
      width: 500,
    },
    ...regions.map(
      (r): TableProps.ColumnDefinition<RegionalAvailability> => ({
        id: r.Region,
        header: (
          <span>
            {r.RegionLongName.replace(/^.*\((.+)\)$/, '$1')}
            <br />
            <small>{r.Region}</small>
          </span>
        ),
        width: 160,
        cell: row => {
          if (!row.regionalAvailability) return null;
          if (availabilityCell) {
            return availabilityCell(row, r.Region);
          }
          return (
            <AvailabilityStatusIndicator
              status={(row.regionalAvailability[r.Region] as AvailabilityStatus) ?? null}
              launchDate={row.regionDates?.[r.Region]}
            />
          );
        },
      }),
    ),
  ];
}

export function createFilteringProperties(
  regions: Region[],
  options?: { includeStackProperty?: boolean; includePlanProperty?: boolean },
): PropertyFilterProps.FilteringProperty[] {
  const properties: PropertyFilterProps.FilteringProperty[] = [
    {
      key: 'name',
      propertyLabel: 'Name',
      groupValuesLabel: 'Name values',
      operators: ['=', '!=', ':', '!:'],
      group: 'properties',
    },
    {
      key: 'regionalAvailabilityType',
      propertyLabel: 'Type',
      groupValuesLabel: 'Type values',
      operators: enumOperators,
      group: 'properties',
    },
  ];

  if (options?.includeStackProperty) {
    properties.push({
      key: 'stack',
      propertyLabel: 'Stack',
      groupValuesLabel: 'Stack values',
      operators: ['=', '!='],
      group: 'properties',
    });
  }

  if (options?.includePlanProperty) {
    properties.push({
      key: 'plan',
      propertyLabel: 'Plan',
      groupValuesLabel: 'Plan values',
      operators: ['=', '!='],
      group: 'properties',
    });
  }

  return properties;
}

/** Detect PropertyFilterTokenGroup by checking for the 'operation' key. */
function isTokenGroup(t: PropertyFilterToken | PropertyFilterTokenGroup): t is PropertyFilterTokenGroup {
  return 'operation' in t;
}

/**
 * Determines if a RegionalAvailability item matches a stack's resources.
 * Replicates the logic from filterByStackResources but for a single item.
 *
 * - SERVICE: matches if any child resource type row is in the resource type set
 * - RESOURCE_TYPE: matches if "parentServiceName::ownName" is in the resource type set
 * - PROPERTY: matches if the parent resource type matches
 * - CONFIGURATION: matches if resource type matches + property value narrowing when available
 */
function itemMatchesStack(
  item: RegionalAvailability,
  data: StackResourcesResponse,
  byId: Map<string, RegionalAvailability>,
): boolean {
  const resourceTypeSet = new Set(data.resourceTypePairs.map(p => `${p.serviceName}::${p.resourceTypeName}`));
  const propertyMatchMap = new Map<string, PropertyMatch[]>();
  for (const m of data.propertyMatches) {
    const key = `${m.serviceName}::${m.resourceTypeName}`;
    const arr = propertyMatchMap.get(key) ?? [];
    arr.push(m);
    propertyMatchMap.set(key, arr);
  }

  switch (item.regionalAvailabilityType) {
    case RegionalAvailabilityType.SERVICE: {
      // Service matches if any child resource type is in the stack's resource type set
      for (const [, candidate] of byId) {
        if (
          candidate.parentId === item.id &&
          candidate.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE
        ) {
          const key = `${item.name}::${candidate.name}`;
          if (resourceTypeSet.has(key)) return true;
        }
      }
      return false;
    }
    case RegionalAvailabilityType.RESOURCE_TYPE: {
      const parent = item.parentId ? byId.get(item.parentId) : undefined;
      // Use cfnName if available (when row has been translated to Terraform convention)
      const resourceName = (item as { cfnName?: string }).cfnName ?? item.name;
      const key = `${parent?.name ?? ''}::${resourceName}`;
      return resourceTypeSet.has(key);
    }
    case RegionalAvailabilityType.PROPERTY: {
      // Property row matches if its parent resource type matches
      const rtRow = item.parentId ? byId.get(item.parentId) : undefined;
      if (!rtRow) return false;
      const serviceRow = rtRow.parentId ? byId.get(rtRow.parentId) : undefined;
      const resourceName = (rtRow as { cfnName?: string }).cfnName ?? rtRow.name;
      const key = `${serviceRow?.name ?? ''}::${resourceName}`;
      return resourceTypeSet.has(key);
    }
    case RegionalAvailabilityType.CONFIGURATION: {
      // Configuration row: check resource type match + property value narrowing
      const propRow = item.parentId ? byId.get(item.parentId) : undefined;
      const rtRow = propRow?.parentId ? byId.get(propRow.parentId) : undefined;
      if (!rtRow) return false;
      const serviceRow = rtRow.parentId ? byId.get(rtRow.parentId) : undefined;
      const resourceName = (rtRow as { cfnName?: string }).cfnName ?? rtRow.name;
      const key = `${serviceRow?.name ?? ''}::${resourceName}`;
      if (!resourceTypeSet.has(key)) return false;
      const matches = propertyMatchMap.get(key);
      if (matches && matches.length > 0) {
        return matches.some(m => m.value === item.name);
      }
      return true; // No property matches → include all configs
    }
    default:
      return false;
  }
}

/**
 * Determines if a RegionalAvailability item in the Terraform AWS tree matches
 * a plan's capability set by checking against `terraformResourceTypes`.
 *
 * The Terraform AWS tree has a three-level hierarchy:
 * - RESOURCE_TYPE (top-level): terraform resource name (e.g., "aws_alb")
 * - SDK_SERVICE (child of resource): SDK service grouping
 * - OPERATION (child of service): individual API operation
 *
 * Matching logic:
 * - RESOURCE_TYPE: matches if item.name is in capabilitySet.terraformResourceTypes
 * - SDK_SERVICE: matches if its parent resource matches
 * - OPERATION: matches if its grandparent resource matches
 */
export function itemMatchesPlanTerraform(
  item: RegionalAvailability,
  capabilitySet: CapabilitySet,
  byId: Map<string, RegionalAvailability>,
): boolean {
  const terraformTypeSet = new Set(capabilitySet.terraformResourceTypes);

  switch (item.regionalAvailabilityType) {
    case RegionalAvailabilityType.RESOURCE_TYPE: {
      // Top-level resource: match directly against terraformResourceTypes
      return terraformTypeSet.has(item.name);
    }
    case RegionalAvailabilityType.SDK_SERVICE: {
      // SDK Service: matches if parent resource matches
      const parent = item.parentId ? byId.get(item.parentId) : undefined;
      if (!parent) return false;
      return terraformTypeSet.has(parent.name);
    }
    case RegionalAvailabilityType.OPERATION: {
      // Operation: matches if grandparent resource matches
      const serviceRow = item.parentId ? byId.get(item.parentId) : undefined;
      if (!serviceRow) return false;
      const resourceRow = serviceRow.parentId ? byId.get(serviceRow.parentId) : undefined;
      if (!resourceRow) return false;
      return terraformTypeSet.has(resourceRow.name);
    }
    default:
      return false;
  }
}

/**
 * Determines if a RegionalAvailability item matches a plan's capability set.
 *
 * Uses the same matching approach as itemMatchesStack:
 * - Builds a set of ServiceName::ResourceTypeName pairs from cfnResourceTypes
 * - SERVICE: matches if any child resource type row is in the pair set
 * - RESOURCE_TYPE: matches if "parentServiceName::ownName" is in the pair set
 * - PROPERTY: matches if the parent resource type matches
 * - CONFIGURATION: matches if the parent resource type matches
 * - SDK_SERVICE (API tab): matches if any child operation is in apiOperations
 * - OPERATION (API tab): matches if item.name is in apiOperations
 */
export function itemMatchesPlan(
  item: RegionalAvailability,
  capabilitySet: CapabilitySet,
  byId: Map<string, RegionalAvailability>,
): boolean {
  // Build a set of ServiceName::ResourceTypeName pairs from cfnResourceTypes
  // e.g., "AWS::EC2::Instance" → "EC2::Instance"
  const resourceTypeSet = new Set(
    capabilitySet.cfnResourceTypes.map(t => {
      const parts = t.split('::');
      if (parts.length >= 3 && parts[0] === 'AWS') {
        return `${parts[1]}::${parts.slice(2).join('::')}`;
      }
      return t;
    })
  );

  // Build property match map (same structure as itemMatchesStack)
  const propertyMatchMap = new Map<string, Array<{ propertyName: string; value: string }>>();
  if (capabilitySet.propertyMatches) {
    for (const m of capabilitySet.propertyMatches) {
      const key = `${m.serviceName}::${m.resourceTypeName}`;
      const arr = propertyMatchMap.get(key) ?? [];
      arr.push(m);
      propertyMatchMap.set(key, arr);
    }
  }

  switch (item.regionalAvailabilityType) {
    case RegionalAvailabilityType.SERVICE: {
      // Service matches if any child resource type is in the resource type set
      for (const [, candidate] of byId) {
        if (
          candidate.parentId === item.id &&
          candidate.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE
        ) {
          const resourceName = (candidate as { cfnName?: string }).cfnName ?? candidate.name;
          const key = `${item.name}::${resourceName}`;
          if (resourceTypeSet.has(key)) return true;
        }
      }
      return false;
    }
    case RegionalAvailabilityType.FEATURE: {
      // Feature matches if parent service matches
      const parent = item.parentId ? byId.get(item.parentId) : undefined;
      if (!parent) return false;
      return itemMatchesPlan(parent, capabilitySet, byId);
    }
    case RegionalAvailabilityType.SDK_SERVICE: {
      // API tab: SDK Service matches if any child operation is in apiOperations
      for (const [, candidate] of byId) {
        if (
          candidate.parentId === item.id &&
          candidate.regionalAvailabilityType === RegionalAvailabilityType.OPERATION
        ) {
          if (capabilitySet.apiOperations.includes(candidate.name)) return true;
        }
      }
      return false;
    }
    case RegionalAvailabilityType.OPERATION: {
      // API tab: match operation name against capabilitySet.apiOperations
      return capabilitySet.apiOperations.includes(item.name);
    }
    case RegionalAvailabilityType.RESOURCE_TYPE: {
      // CFN tab: match using ServiceName::ResourceTypeName pair
      const parent = item.parentId ? byId.get(item.parentId) : undefined;
      const resourceName = (item as { cfnName?: string }).cfnName ?? item.name;
      const key = `${parent?.name ?? ''}::${resourceName}`;
      return resourceTypeSet.has(key);
    }
    case RegionalAvailabilityType.PROPERTY: {
      // CFN tab: Property matches if parent resource type matches AND
      // the property name has values in the template
      const rtRow = item.parentId ? byId.get(item.parentId) : undefined;
      if (!rtRow) return false;
      const serviceRow = rtRow.parentId ? byId.get(rtRow.parentId) : undefined;
      const resourceName = (rtRow as { cfnName?: string }).cfnName ?? rtRow.name;
      const key = `${serviceRow?.name ?? ''}::${resourceName}`;
      if (!resourceTypeSet.has(key)) return false;
      // Only show this property if the template specifies values for it
      const matches = propertyMatchMap.get(key);
      if (matches && matches.length > 0) {
        return matches.some(m => m.propertyName === item.name);
      }
      return false;
    }
    case RegionalAvailabilityType.CONFIGURATION: {
      // CFN tab: Configuration matches if resource type matches + property value narrowing
      const propRow = item.parentId ? byId.get(item.parentId) : undefined;
      const rtRow = propRow?.parentId ? byId.get(propRow.parentId) : undefined;
      if (!rtRow) return false;
      const serviceRow = rtRow.parentId ? byId.get(rtRow.parentId) : undefined;
      const resourceName = (rtRow as { cfnName?: string }).cfnName ?? rtRow.name;
      const key = `${serviceRow?.name ?? ''}::${resourceName}`;
      if (!resourceTypeSet.has(key)) return false;
      const matches = propertyMatchMap.get(key);
      if (matches && matches.length > 0) {
        return matches.some(m => m.propertyName === propRow?.name && m.value === item.name);
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * Creates a filtering function that handles:
 * - Recursive AND/OR evaluation of token groups (Requirement 8)
 * - Region availability lookups (keys prefixed with "region:")
 * - Parent-chain walking for known property keys (name, regionalAvailabilityType)
 * - Stack token evaluation via cached API calls (Requirement 9)
 * - Plan token evaluation via cached capability set data
 * - Free-text token matching against name and regionalAvailabilityType
 * - Parent-to-child inheritance (matched parent → children included)
 */
export function createFilteringFunction(
  items: RegionalAvailability[],
  stackResourceCache?: Map<string, StackResourcesResponse>,
  onStackDataNeeded?: (stackName: string) => void,
  planCapabilityCache?: Map<string, CapabilitySet>,
  onPlanDataNeeded?: (planName: string) => void,
) {
  const byId = new Map(items.map(i => [i.id, i]));

  // --- Value resolution ---
  const resolveValue = (item: RegionalAvailability, key: string): string | undefined => {
    if (key.startsWith('region:')) {
      return item.regionalAvailability?.[key.slice(7)];
    }
    // Walk parent chain for known keys
    let current: RegionalAvailability | undefined = item;
    while (current) {
      if (key === 'name' && current.name !== undefined) return current.name;
      if (key === 'regionalAvailabilityType' && current.regionalAvailabilityType !== undefined)
        return current.regionalAvailabilityType;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return undefined;
  };

  // --- Single token value matching ---
  const tokenMatches = (value: string | undefined, token: PropertyFilterToken): boolean => {
    const tokenValues: string[] = Array.isArray(token.value) ? token.value : [token.value];
    const stringValue = value ?? '';
    switch (token.operator) {
      case '=':
        return tokenValues.includes(stringValue);
      case '!=':
        return !tokenValues.includes(stringValue);
      case ':':
        return tokenValues.some(tv => stringValue.toLowerCase().includes(tv.toLowerCase()));
      case '!:':
        return !tokenValues.some(tv => stringValue.toLowerCase().includes(tv.toLowerCase()));
      default:
        return false;
    }
  };

  // --- Stack token evaluation ---
  const evaluateStackToken = (item: RegionalAvailability, token: PropertyFilterToken): boolean => {
    const stackName = token.value as string;
    const data = stackResourceCache?.get(stackName);
    if (!data) {
      // Signal that we need this stack's data; match nothing until loaded
      onStackDataNeeded?.(stackName);
      return false;
    }
    const matches = itemMatchesStack(item, data, byId);
    return token.operator === '=' ? matches : !matches;
  };

  // --- Plan token evaluation ---
  const evaluatePlanToken = (item: RegionalAvailability, token: PropertyFilterToken): boolean => {
    const planName = token.value as string;
    const capabilitySet = planCapabilityCache?.get(planName);
    if (!capabilitySet) {
      // Signal that we need this plan's data; fail-open (don't exclude) until loaded
      onPlanDataNeeded?.(planName);
      return true;
    }
    const matches = itemMatchesPlan(item, capabilitySet, byId);
    return token.operator === '=' ? matches : !matches;
  };

  // --- Free-text token matching ---
  const freeTextMatches = (item: RegionalAvailability, token: PropertyFilterToken): boolean => {
    const isNegation = token.operator.startsWith('!');
    const keys = ['name', 'regionalAvailabilityType'];
    return keys[isNegation ? 'every' : 'some'](key => {
      const value = resolveValue(item, key);
      return tokenMatches(value, token);
    });
  };

  // --- Evaluate a single token ---
  const evaluateToken = (item: RegionalAvailability, token: PropertyFilterToken): boolean => {
    if (token.propertyKey === 'stack') {
      return evaluateStackToken(item, token);
    }
    if (token.propertyKey === 'plan') {
      return evaluatePlanToken(item, token);
    }
    if (!token.propertyKey) {
      return freeTextMatches(item, token);
    }
    const value = resolveValue(item, token.propertyKey);
    return tokenMatches(value, token);
  };

  // --- Recursive evaluate (mirrors Cloudscape defaultFilteringFunction) ---
  const evaluate = (
    item: RegionalAvailability,
    tokenOrGroup: PropertyFilterToken | PropertyFilterTokenGroup,
  ): boolean => {
    if (isTokenGroup(tokenOrGroup)) {
      const { operation, tokens } = tokenOrGroup;
      if (operation === 'and') {
        return tokens.every(child => evaluate(item, child));
      }
      // 'or': return true if at least one child is true; empty 'or' returns false
      return tokens.length > 0 && tokens.some(child => evaluate(item, child));
    }
    return evaluateToken(item, tokenOrGroup);
  };

  // --- Parent-chain inheritance ---
  // When a query contains stack or plan tokens, parent-chain inheritance is disabled entirely.
  // Each row must pass itemMatchesStack/itemMatchesPlan on its own merits — the stack/plan
  // filtering already handles hierarchy (SERVICE matches if it has a matching child RT,
  // PROPERTY matches if its parent RT matches, CONFIGURATION narrows by property values).
  // Allowing parent-chain inheritance would override the precise narrowing (e.g., a matched
  // resource type row would pull in ALL its config children, defeating property narrowing).
  //
  // For non-stack/plan queries, parent-chain inheritance works as before: if a parent matches
  // the query, its children are included.
  let lastQuery: PropertyFilterQuery | null = null;
  const matchedIds = new Set<string>();
  let hasHierarchicalTokens = false;

  /** Check if a query contains any stack or plan tokens (at any nesting depth). */
  const queryHasHierarchicalTokens = (tokenOrGroup: PropertyFilterToken | PropertyFilterTokenGroup): boolean => {
    if (isTokenGroup(tokenOrGroup)) {
      return tokenOrGroup.tokens.some(child => queryHasHierarchicalTokens(child));
    }
    return tokenOrGroup.propertyKey === 'stack' || tokenOrGroup.propertyKey === 'plan';
  };

  return (item: RegionalAvailability, query: PropertyFilterQuery): boolean => {
    if (query !== lastQuery) {
      matchedIds.clear();
      lastQuery = query;

      const rootGroup: PropertyFilterTokenGroup = {
        operation: query.operation,
        tokens: query.tokenGroups ?? query.tokens,
      };
      hasHierarchicalTokens = queryHasHierarchicalTokens(rootGroup);
    }

    // Build the root token group from the query
    const rootGroup: PropertyFilterTokenGroup = {
      operation: query.operation,
      tokens: query.tokenGroups ?? query.tokens,
    };

    // Direct match via recursive evaluation
    if (evaluate(item, rootGroup)) {
      matchedIds.add(item.id);
      return true;
    }

    // Parent-chain inheritance: include child if an ancestor genuinely matches.
    // DISABLED when the query contains stack or plan tokens — stack/plan filtering handles
    // its own hierarchy via itemMatchesStack/itemMatchesPlan, and inheritance would override
    // the precise property-value narrowing.
    if (!hasHierarchicalTokens) {
      let current = item.parentId ? byId.get(item.parentId) : undefined;
      while (current) {
        if (matchedIds.has(current.id)) return true;
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
    }

    return false;
  };
}

export function TablePreferences({
  columns,
  preferences,
  setPreferences,
}: {
  columns: TableProps.ColumnDefinition<RegionalAvailability>[];
  preferences: CollectionPreferencesProps.Preferences;
  setPreferences: (next: CollectionPreferencesProps.Preferences) => void;
}) {
  return (
    <CollectionPreferences
      title="Preferences"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      onConfirm={({ detail }) => setPreferences(detail)}
      preferences={preferences}
      contentDisplayPreference={{
        title: 'Column preferences',
        description: 'Select which columns to display',
        options: columns.map(c => ({
          id: c.id!,
          label: typeof c.header === 'string' ? c.header : c.id!,
          alwaysVisible: c.id === 'name',
        })),
      }}
      stickyColumnsPreference={{
        firstColumns: {
          title: 'First column(s)',
          description: 'Keep the first column(s) visible while horizontally scrolling table content.',
          options: [
            { label: 'None', value: 0 },
            { label: 'First column', value: 1 },
          ],
        },
      }}
    />
  );
}
