import type { ApiService } from '@capability-insights/shared/types/capability/api';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { AvailabilityStatus } from '../../../shared/types/availability/availability-status';
import { toIamAction } from './iam-action-mapping';

export interface AllowListInput {
  catalogData: ApiService[];
  configuration: PolicyConfiguration;
}

export interface AllowListResult {
  actions: string[]; // Sorted list of IAM actions (e.g., "s3:GetObject")
  actionCount: number;
  excludedCount: number; // Actions excluded by availability filter
  exceptionCount: number; // Actions added via exceptions
}

/**
 * Pure function: computes the allow-list from catalog data and configuration.
 * No side effects, deterministic output for identical inputs.
 *
 * - Intersection mode: include action only if Available in ALL selected regions
 * - Union mode: include action if Available in ANY selected region
 * - Exceptions are always included regardless of availability
 * - Missing availability data for a region is treated as "Not Available"
 * - Output is sorted alphabetically and deduplicated
 */
export function computeAllowList(input: AllowListInput): AllowListResult {
  const { catalogData, configuration } = input;
  const { regions, mode, exceptions } = configuration;

  const allowSet = new Set<string>();
  let excludedCount = 0;

  for (const service of catalogData) {
    for (const operation of service.apis) {
      const iamAction = toIamAction(service.sdkServiceName, operation.apiAction, operation.homepage);

      let included: boolean;

      if (mode === 'intersection') {
        included = regions.every(
          (region) => operation.regionalAvailability[region] === AvailabilityStatus.AVAILABLE
        );
      } else {
        included = regions.some(
          (region) => operation.regionalAvailability[region] === AvailabilityStatus.AVAILABLE
        );
      }

      if (included) {
        allowSet.add(iamAction);
      } else {
        excludedCount++;
      }
    }
  }

  // Add exceptions regardless of availability
  let exceptionCount = 0;
  for (const exception of exceptions) {
    if (!allowSet.has(exception.action)) {
      exceptionCount++;
    }
    allowSet.add(exception.action);
  }

  const actions = Array.from(allowSet).sort();

  return {
    actions,
    actionCount: actions.length,
    excludedCount,
    exceptionCount,
  };
}
