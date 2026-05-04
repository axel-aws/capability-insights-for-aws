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
import type { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import AvailabilityStatusIndicator from '~/components/availability/availability-status-indicator';

const enumOperators: PropertyFilterProps.FilteringProperty['operators'] = [
  { operator: '=', tokenType: 'enum' },
  { operator: '!=', tokenType: 'enum' },
];

export function createColumns({
  nameColumnHeader,
  regions,
  nameCell,
}: {
  nameColumnHeader: string;
  regions: Region[];
  nameCell?: (row: RegionalAvailability) => React.ReactNode;
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

export function createFilteringProperties(regions: Region[]): PropertyFilterProps.FilteringProperty[] {
  return [
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
    ...regions.map(r => ({
      key: `region:${r.Region}`,
      propertyLabel: `${r.RegionLongName} (${r.Region})`,
      groupValuesLabel: `${r.RegionLongName} values`,
      operators: enumOperators,
      group: 'regions',
    })),
  ];
}

/** Detect PropertyFilterTokenGroup by checking for the 'operation' key. */
function isTokenGroup(t: PropertyFilterToken | PropertyFilterTokenGroup): t is PropertyFilterTokenGroup {
  return 'operation' in t;
}

/**
 * Creates a filtering function that handles:
 * - Recursive AND/OR evaluation of token groups
 * - Region availability lookups (keys prefixed with "region:")
 * - Parent-chain walking for known property keys (name, regionalAvailabilityType)
 * - Free-text token matching against name and regionalAvailabilityType
 * - Parent-to-child inheritance (matched parent → children included)
 */
export function createFilteringFunction(items: RegionalAvailability[]) {
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
  let lastQuery: PropertyFilterQuery | null = null;
  const matchedIds = new Set<string>();

  return (item: RegionalAvailability, query: PropertyFilterQuery): boolean => {
    if (query !== lastQuery) {
      matchedIds.clear();
      lastQuery = query;
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

    // Parent-chain inheritance: include child if an ancestor genuinely matches
    let current = item.parentId ? byId.get(item.parentId) : undefined;
    while (current) {
      if (matchedIds.has(current.id)) return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
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
