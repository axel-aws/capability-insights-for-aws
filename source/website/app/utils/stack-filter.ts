import type { CfnAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import type { ResourceTypePair, PropertyMatch } from '@capability-insights/shared/types/capability/stack';

export interface StackFilterInput {
  rows: CfnAvailability[];
  resourceTypePairs: ResourceTypePair[];
  propertyMatches: PropertyMatch[];
}

/**
 * Filters CfnAvailability rows to only those matching the stack's resource types.
 * Preserves hierarchical structure (parent service rows are included).
 * Narrows configuration rows when property values are available.
 * Falls back to showing all children when no property values exist for a resource type.
 */
export function filterByStackResources(input: StackFilterInput): CfnAvailability[] {
  const { rows, resourceTypePairs, propertyMatches } = input;

  // Build a Set of "serviceName::resourceTypeName" from resourceTypePairs
  const resourceTypeSet = new Set<string>(
    resourceTypePairs.map((pair) => `${pair.serviceName}::${pair.resourceTypeName}`),
  );

  // Build a Map of "serviceName::resourceTypeName" → PropertyMatch[] from propertyMatches
  const propertyMatchMap = new Map<string, PropertyMatch[]>();
  for (const match of propertyMatches) {
    const key = `${match.serviceName}::${match.resourceTypeName}`;
    const existing = propertyMatchMap.get(key);
    if (existing) {
      existing.push(match);
    } else {
      propertyMatchMap.set(key, [match]);
    }
  }

  // Build a lookup map of id → row for parent lookups
  const rowById = new Map<string, CfnAvailability>();
  for (const row of rows) {
    rowById.set(row.id, row);
  }

  // Collect the set of service names that have at least one matching resource type child
  const includedServiceIds = new Set<string>();
  for (const row of rows) {
    if (row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE && row.parentId !== null) {
      const parentRow = rowById.get(row.parentId);
      const serviceName = parentRow?.name ?? '';
      const key = `${serviceName}::${row.name}`;
      if (resourceTypeSet.has(key)) {
        includedServiceIds.add(row.parentId);
      }
    }
  }

  // Helper: find the resource type key ("serviceName::resourceTypeName") for a given row
  // by walking up the hierarchy
  function getResourceTypeKey(row: CfnAvailability): string | null {
    if (row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE) {
      const parentRow = row.parentId ? rowById.get(row.parentId) : undefined;
      const serviceName = parentRow?.name ?? '';
      return `${serviceName}::${row.name}`;
    }

    if (row.regionalAvailabilityType === RegionalAvailabilityType.PROPERTY && row.parentId) {
      const resourceTypeRow = rowById.get(row.parentId);
      if (resourceTypeRow) {
        return getResourceTypeKey(resourceTypeRow);
      }
    }

    if (row.regionalAvailabilityType === RegionalAvailabilityType.CONFIGURATION && row.parentId) {
      const propertyRow = rowById.get(row.parentId);
      if (propertyRow?.parentId) {
        const resourceTypeRow = rowById.get(propertyRow.parentId);
        if (resourceTypeRow) {
          return getResourceTypeKey(resourceTypeRow);
        }
      }
    }

    return null;
  }

  const result: CfnAvailability[] = [];

  for (const row of rows) {
    switch (row.regionalAvailabilityType) {
      case RegionalAvailabilityType.SERVICE: {
        // Include service rows only if they have at least one matching child resource type
        if (includedServiceIds.has(row.id)) {
          result.push(row);
        }
        break;
      }

      case RegionalAvailabilityType.RESOURCE_TYPE: {
        // Include resource type rows if "serviceName::name" is in the set
        const rtKey = getResourceTypeKey(row);
        if (rtKey && resourceTypeSet.has(rtKey)) {
          result.push(row);
        }
        break;
      }

      case RegionalAvailabilityType.PROPERTY: {
        // Include property rows if the parent resource type is in the set
        const rtKey = getResourceTypeKey(row);
        if (rtKey && resourceTypeSet.has(rtKey)) {
          result.push(row);
        }
        break;
      }

      case RegionalAvailabilityType.CONFIGURATION: {
        // Include configuration rows based on property match availability
        const rtKey = getResourceTypeKey(row);
        if (rtKey && resourceTypeSet.has(rtKey)) {
          const matches = propertyMatchMap.get(rtKey);
          if (matches && matches.length > 0) {
            // Property matches exist for this resource type: include only matching configuration values
            const matchValues = new Set(matches.map((m) => m.value));
            if (matchValues.has(row.name)) {
              result.push(row);
            }
          } else {
            // No property matches for this resource type: include all configuration rows
            result.push(row);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  return result;
}
