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
 */
export function buildAvailabilityTree(
  mapping: ClassicApiMappingData,
  apiRows: ApiAvailability[],
  regions: Region[],
): ApiAvailability[] {
  const index = buildOperationAvailabilityIndex(apiRows);
  const regionCodes = regions.map(r => r.Region);
  const rows: ApiAvailability[] = [];

  for (const resource of mapping.resources) {
    const resourceId = `terraform-resource-${resource.terraformType}`;
    const serviceId = `terraform-service-${resource.terraformType}-${resource.sdkService}`;

    // Level 0: Terraform Resource row with computed AND availability
    const resourceAvailability: Record<RegionCode, AvailabilityStatus> = {};
    for (const region of regionCodes) {
      const status = computeResourceAvailability(resource.requiredApis, resource.sdkService, region, index);
      if (status === 'Available') {
        resourceAvailability[region] = AvailabilityStatus.AVAILABLE;
      } else if (status === 'Not Available') {
        resourceAvailability[region] = AvailabilityStatus.NOT_AVAILABLE;
      }
      // "Unknown" → no entry (undefined), which is the existing pattern for unknown availability
    }

    rows.push({
      id: resourceId,
      parentId: null,
      name: resource.terraformType,
      regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
      regionalAvailability: resourceAvailability,
      sdkServiceName: resource.sdkService,
    });

    // Level 1: SDK Service row (informational grouping, no availability of its own)
    rows.push({
      id: serviceId,
      parentId: resourceId,
      name: resource.sdkService,
      regionalAvailabilityType: RegionalAvailabilityType.SDK_SERVICE,
    });

    // Level 2: API Operation rows with actual availability from API data
    for (const operation of resource.requiredApis) {
      const operationId = `terraform-op-${resource.terraformType}-${resource.sdkService}-${operation}`;

      const operationAvailability: Record<RegionCode, AvailabilityStatus> = {};
      const serviceMap = index.get(resource.sdkService.toLowerCase());
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
        sdkServiceName: resource.sdkService,
      });
    }
  }

  return rows;
}
