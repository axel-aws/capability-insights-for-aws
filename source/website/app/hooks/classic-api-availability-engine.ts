import type { ApiAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { RegionCode, Region } from '@capability-insights/shared/types/capability/region';
import type { ClassicApiMappingData } from '@capability-insights/shared/types/terraform-classic-api-mapping';

/**
 * Maps: sdkService → operationName → Set<availableRegions>
 * Used for O(1) lookups of operation availability by service, operation, and region.
 */
export type OperationAvailabilityIndex = Map<string, Map<string, Set<string>>>;

/** Availability status for a Terraform resource in a region. */
export type ClassicAvailabilityStatus = 'Available' | 'Not Available' | 'Unknown';

/**
 * Build an index from API operations data for O(1) lookups.
 * Maps: sdkService → operationName → Set<availableRegions>
 *
 * Only operations with AvailabilityStatus.AVAILABLE are indexed as available.
 */
export function buildOperationAvailabilityIndex(apiRows: ApiAvailability[]): OperationAvailabilityIndex {
  const index: OperationAvailabilityIndex = new Map();

  // Build a map of row IDs to rows for parent lookups
  const byId = new Map(apiRows.map(r => [r.id, r]));

  for (const row of apiRows) {
    // Only index operation-level rows
    if (row.regionalAvailabilityType !== RegionalAvailabilityType.OPERATION) continue;

    // Determine the SDK service name from the row's sdkServiceName field or parent
    let serviceName = row.sdkServiceName;
    if (!serviceName && row.parentId) {
      const parent = byId.get(row.parentId);
      if (parent) {
        serviceName = parent.sdkServiceName ?? parent.name;
      }
    }
    if (!serviceName) continue;

    const normalizedService = serviceName.toLowerCase();
    const operationName = row.name;

    if (!index.has(normalizedService)) {
      index.set(normalizedService, new Map());
    }
    const serviceMap = index.get(normalizedService)!;

    if (!serviceMap.has(operationName)) {
      serviceMap.set(operationName, new Set());
    }
    const regionSet = serviceMap.get(operationName)!;

    // Add regions where this operation is available
    if (row.regionalAvailability) {
      for (const [region, status] of Object.entries(row.regionalAvailability)) {
        if (status === AvailabilityStatus.AVAILABLE) {
          regionSet.add(region);
        }
      }
    }
  }

  return index;
}

/**
 * Compute availability for a Terraform resource in a region.
 * Returns "Available" only if ALL required API operations are available.
 * Returns "Not Available" if any required operation is unavailable.
 * Returns "Unknown" if the resource has no required APIs mapped.
 */
export function computeResourceAvailability(
  requiredApis: string[],
  sdkService: string,
  region: string,
  operationAvailabilityIndex: OperationAvailabilityIndex,
): ClassicAvailabilityStatus {
  if (requiredApis.length === 0) {
    return 'Unknown';
  }

  const normalizedService = sdkService.toLowerCase();
  const serviceMap = operationAvailabilityIndex.get(normalizedService);

  for (const operation of requiredApis) {
    if (!serviceMap) {
      return 'Not Available';
    }
    const regionSet = serviceMap.get(operation);
    if (!regionSet || !regionSet.has(region)) {
      return 'Not Available';
    }
  }

  return 'Available';
}

/**
 * Get the list of missing (unavailable) API operations for a resource in a region.
 * Returns operations formatted as `{service}:{operation}`.
 */
export function getMissingOperations(
  requiredApis: string[],
  sdkService: string,
  region: string,
  operationAvailabilityIndex: OperationAvailabilityIndex,
): string[] {
  const missing: string[] = [];
  const normalizedService = sdkService.toLowerCase();
  const serviceMap = operationAvailabilityIndex.get(normalizedService);

  for (const operation of requiredApis) {
    const regionSet = serviceMap?.get(operation);
    if (!regionSet || !regionSet.has(region)) {
      missing.push(`${sdkService}:${operation}`);
    }
  }

  return missing;
}

/**
 * Build the three-level tree hierarchy:
 * - Level 0 (parentId: null): Terraform Resource — computed AND availability
 * - Level 1 (parentId: resource): SDK Service — informational grouping
 * - Level 2 (parentId: service): API Operation — actual availability from existing data
 *
 * Operations are attributed to services by looking them up in the authoritative
 * API operations data (OperationAvailabilityIndex), not by trusting the single
 * sdkService field from the mapping. This correctly handles resources that call
 * APIs across multiple services (e.g., aws_alb calling both ELBv2 and EC2 APIs).
 */
export function buildAvailabilityTree(
  mapping: ClassicApiMappingData,
  apiRows: ApiAvailability[],
  regions: Region[],
): ApiAvailability[] {
  const index = buildOperationAvailabilityIndex(apiRows);
  const regionCodes = regions.map(r => r.Region);
  const rows: ApiAvailability[] = [];

  // Build a reverse index: operationName → Set<serviceName> from the authoritative data.
  // This tells us which service each operation actually belongs to.
  // Also track the original-case service name for display purposes.
  const operationToServices = new Map<string, Set<string>>();
  const serviceOriginalCase = new Map<string, string>(); // lowercased → original
  for (const [serviceName, serviceMap] of index) {
    for (const operationName of serviceMap.keys()) {
      if (!operationToServices.has(operationName)) {
        operationToServices.set(operationName, new Set());
      }
      operationToServices.get(operationName)!.add(serviceName);
    }
  }

  // Build original-case lookup from the apiRows (SDK_SERVICE rows or OPERATION rows have the original name)
  for (const row of apiRows) {
    if (row.sdkServiceName) {
      const lower = row.sdkServiceName.toLowerCase();
      if (!serviceOriginalCase.has(lower)) {
        serviceOriginalCase.set(lower, row.sdkServiceName);
      }
    }
  }

  for (const resource of mapping.resources) {
    const resourceId = `terraform-resource-${resource.terraformType}`;

    // If the resource has a pre-computed multi-service breakdown, use it directly.
    // Otherwise, attribute each operation to its correct service using the authoritative index.
    let serviceEntries: Array<{ sdkService: string; requiredApis: string[] }>;

    if (resource.services && resource.services.length > 0) {
      serviceEntries = resource.services;
    } else {
      // Attribute each operation to its actual service by looking it up in the index.
      const serviceToOps = new Map<string, string[]>();
      const primaryService = resource.sdkService.toLowerCase();

      for (const operation of resource.requiredApis) {
        const owningServices = operationToServices.get(operation);
        let attributedService: string;

        if (owningServices && owningServices.size === 1) {
          // Unambiguous: only one service has this operation
          attributedService = [...owningServices][0];
        } else if (owningServices && owningServices.has(primaryService)) {
          // Ambiguous but the primary service claims it — use primary
          attributedService = primaryService;
        } else if (owningServices && owningServices.size > 0) {
          // Ambiguous and primary doesn't claim it — pick the first match
          attributedService = [...owningServices][0];
        } else {
          // Not found in the index at all — fall back to the declared primary service
          attributedService = primaryService;
        }

        const ops = serviceToOps.get(attributedService) ?? [];
        ops.push(operation);
        serviceToOps.set(attributedService, ops);
      }

      serviceEntries = [...serviceToOps.entries()].map(([sdkService, requiredApis]) => ({
        sdkService: serviceOriginalCase.get(sdkService) ?? sdkService,
        requiredApis,
      }));

      // If no operations were attributed (empty requiredApis), create a single entry
      // with the declared service so the resource still appears in the tree.
      if (serviceEntries.length === 0) {
        serviceEntries = [{ sdkService: serviceOriginalCase.get(primaryService) ?? resource.sdkService, requiredApis: [] }];
      }
    }

    // Collect all required APIs across all services for resource-level availability
    const allRequiredApis: Array<{ sdkService: string; api: string }> = [];
    for (const entry of serviceEntries) {
      for (const api of entry.requiredApis) {
        allRequiredApis.push({ sdkService: entry.sdkService, api });
      }
    }

    // Level 0: Terraform Resource row with computed AND availability across ALL services
    const resourceAvailability: Record<RegionCode, AvailabilityStatus> = {};
    for (const region of regionCodes) {
      if (allRequiredApis.length === 0) {
        // "Unknown" → no entry (undefined)
        continue;
      }
      let allAvailable = true;
      for (const { sdkService, api } of allRequiredApis) {
        const serviceMap = index.get(sdkService.toLowerCase());
        const regionSet = serviceMap?.get(api);
        if (!regionSet || !regionSet.has(region)) {
          allAvailable = false;
          break;
        }
      }
      resourceAvailability[region] = allAvailable
        ? AvailabilityStatus.AVAILABLE
        : AvailabilityStatus.NOT_AVAILABLE;
    }

    rows.push({
      id: resourceId,
      parentId: null,
      name: resource.terraformType,
      regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
      regionalAvailability: resourceAvailability,
      sdkServiceName: resource.sdkService,
    });

    // Level 1 & 2: SDK Service rows and their API Operation children
    for (const entry of serviceEntries) {
      const serviceId = `terraform-service-${resource.terraformType}-${entry.sdkService}`;

      // Level 1: SDK Service row (informational grouping, no availability of its own)
      rows.push({
        id: serviceId,
        parentId: resourceId,
        name: entry.sdkService,
        regionalAvailabilityType: RegionalAvailabilityType.SDK_SERVICE,
      });

      // Level 2: API Operation rows with actual availability from API data
      for (const operation of entry.requiredApis) {
        const operationId = `terraform-op-${resource.terraformType}-${entry.sdkService}-${operation}`;

        const operationAvailability: Record<RegionCode, AvailabilityStatus> = {};
        const serviceMap = index.get(entry.sdkService.toLowerCase());
        const regionSet = serviceMap?.get(operation);

        for (const region of regionCodes) {
          if (regionSet?.has(region)) {
            operationAvailability[region] = AvailabilityStatus.AVAILABLE;
          } else {
            operationAvailability[region] = AvailabilityStatus.NOT_AVAILABLE;
          }
        }

        rows.push({
          id: operationId,
          parentId: serviceId,
          name: operation,
          regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
          regionalAvailability: operationAvailability,
          sdkServiceName: entry.sdkService,
        });
      }
    }
  }

  return rows;
}
