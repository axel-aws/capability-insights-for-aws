import { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  NamingConvention,
  TerraformOverlayData,
  OverlayIndex,
  ClassicAwsMapping,
} from '@capability-insights/shared/types/terraform-overlay';
import type { CfnAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';

/**
 * Build an OverlayIndex from raw TerraformOverlayData for O(1) lookups.
 *
 * This is a pure function exported separately for testability.
 */
export function buildOverlayIndex(data: TerraformOverlayData): OverlayIndex {
  const cfnToAwscc = new Map<string, string>();
  const cfnToClassicAws = new Map<string, string>();
  const awsccToCfn = new Map<string, string>();
  const classicAwsToCfn = new Map<string, string | null>();
  const unmappedClassicAws: ClassicAwsMapping[] = [];

  for (const mapping of data.awscc) {
    cfnToAwscc.set(mapping.cfnType, mapping.terraformType);
    awsccToCfn.set(mapping.terraformType, mapping.cfnType);
  }

  for (const mapping of data.classicAws) {
    classicAwsToCfn.set(mapping.terraformType, mapping.cfnType);
    if (mapping.cfnType !== null) {
      cfnToClassicAws.set(mapping.cfnType, mapping.terraformType);
    } else {
      unmappedClassicAws.push(mapping);
    }
  }

  return {
    cfnToAwscc,
    cfnToClassicAws,
    awsccToCfn,
    classicAwsToCfn,
    unmappedClassicAws,
    allAwscc: data.awscc,
  };
}

/**
 * Translate CFN availability rows to the selected naming convention.
 *
 * Behavior by convention:
 * - CloudFormation: return rows as-is (exclude Terraform-only resources)
 * - Terraform AWSCC: translate CFN labels to AWSCC, exclude unmapped CFN resources, include AWSCC-only resources
 * - Terraform AWS: translate CFN labels to classic AWS, exclude unmapped CFN resources, include unmapped classic AWS resources
 *
 * This is a pure function exported separately for testability.
 */
export function translateRows(
  rows: CfnAvailability[],
  convention: NamingConvention,
  index: OverlayIndex
): CfnAvailability[] {
  if (convention === 'cloudformation') {
    return rows;
  }

  // Build a map from row ID to row for parent lookups
  const byId = new Map(rows.map(r => [r.id, r]));

  // Helper: construct the full CFN type (AWS::{Service}::{Resource}) from a resource type row
  function getFullCfnType(row: CfnAvailability): string | null {
    if (!row.parentId) return null;
    const parent = byId.get(row.parentId);
    if (!parent) return null;
    return `AWS::${parent.name}::${row.name}`;
  }

  // Separate rows into resource-type rows (translatable) and structural rows (services, properties, etc.)
  const resourceTypeRows = rows.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE);
  const parentRows = rows.filter(r => r.regionalAvailabilityType !== RegionalAvailabilityType.RESOURCE_TYPE && r.parentId === null);

  if (convention === 'terraform-awscc') {
    const translated: CfnAvailability[] = [];
    const includedParentIds = new Set<string>();

    // Translate mapped CFN resource type rows to AWSCC names
    for (const row of resourceTypeRows) {
      const fullCfnType = getFullCfnType(row);
      const awsccType = fullCfnType ? index.cfnToAwscc.get(fullCfnType) : undefined;
      if (awsccType) {
        translated.push({ ...row, name: awsccType, cfnName: row.name });
        if (row.parentId) includedParentIds.add(row.parentId);
      }
      // CFN resources without an AWSCC equivalent are excluded
    }

    // Include parent (service) rows that have at least one translated child
    for (const parent of parentRows) {
      if (includedParentIds.has(parent.id)) {
        translated.push(parent);
      }
    }

    return translated;
  }

  // convention === 'terraform-aws'
  const translated: CfnAvailability[] = [];
  const includedParentIds = new Set<string>();

  // Translate mapped CFN resource type rows to classic AWS names
  for (const row of resourceTypeRows) {
    const fullCfnType = getFullCfnType(row);
    const classicType = fullCfnType ? index.cfnToClassicAws.get(fullCfnType) : undefined;
    if (classicType) {
      translated.push({ ...row, name: classicType, cfnName: row.name });
      if (row.parentId) includedParentIds.add(row.parentId);
    }
    // CFN resources without a classic AWS equivalent are excluded
  }

  // Include parent (service) rows that have at least one translated child
  for (const parent of parentRows) {
    if (includedParentIds.has(parent.id)) {
      translated.push(parent);
    }
  }

  return translated;
}

/**
 * Search across all naming conventions (CFN, AWSCC, classic AWS) regardless of active convention.
 *
 * Returns rows where the query is a case-insensitive substring of any convention label,
 * with results displayed using the currently active convention's labels.
 *
 * This is a pure function exported separately for testability.
 */
export function searchAllConventions(
  rows: CfnAvailability[],
  query: string,
  index: OverlayIndex,
  convention: NamingConvention
): CfnAvailability[] {
  if (!query) {
    return translateRows(rows, convention, index);
  }

  const lowerQuery = query.toLowerCase();

  // Build a map from row ID to row for parent lookups
  const byId = new Map(rows.map(r => [r.id, r]));

  // Helper: construct the full CFN type from a resource type row
  function getFullCfnType(row: CfnAvailability): string | null {
    if (!row.parentId) return null;
    const parent = byId.get(row.parentId);
    if (!parent) return null;
    return `AWS::${parent.name}::${row.name}`;
  }

  // First, find all CFN names that match across any convention
  const matchingCfnNames = new Set<string>();

  for (const row of rows) {
    const cfnName = row.name;

    // Check CFN name (both short and full form)
    if (cfnName.toLowerCase().includes(lowerQuery)) {
      matchingCfnNames.add(cfnName);
      continue;
    }

    // Only check overlay mappings for resource type rows
    if (row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE) {
      const fullCfnType = getFullCfnType(row);

      // Check full CFN type
      if (fullCfnType && fullCfnType.toLowerCase().includes(lowerQuery)) {
        matchingCfnNames.add(cfnName);
        continue;
      }

      // Check AWSCC name
      const awsccName = fullCfnType ? index.cfnToAwscc.get(fullCfnType) : undefined;
      if (awsccName && awsccName.toLowerCase().includes(lowerQuery)) {
        matchingCfnNames.add(cfnName);
        continue;
      }

      // Check classic AWS name
      const classicName = fullCfnType ? index.cfnToClassicAws.get(fullCfnType) : undefined;
      if (classicName && classicName.toLowerCase().includes(lowerQuery)) {
        matchingCfnNames.add(cfnName);
      }
    }
  }

  // Filter rows to only matching ones, plus include parents of matching children
  const matchingRows: CfnAvailability[] = [];
  const matchingChildParentIds = new Set<string>();

  for (const row of rows) {
    if (matchingCfnNames.has(row.name)) {
      matchingRows.push(row);
      if (row.parentId) matchingChildParentIds.add(row.parentId);
    }
  }

  // Include parent rows whose children matched
  for (const row of rows) {
    if (matchingChildParentIds.has(row.id) && !matchingCfnNames.has(row.name)) {
      matchingRows.push(row);
    }
  }

  // Translate matching rows to the active convention
  return translateRows(matchingRows, convention, index);
}

/**
 * Get the count of visible resources for the current convention.
 *
 * This is a pure function exported separately for testability.
 */
export function getResourceCount(
  rows: CfnAvailability[],
  convention: NamingConvention,
  index: OverlayIndex
): number {
  const translated = translateRows(rows, convention, index);
  return translated.filter(r => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE).length;
}

export interface UseTerraformOverlayResult {
  convention: NamingConvention;
  setConvention: (c: NamingConvention) => void;
  loading: boolean;
  error: string | null;
  translateRows: (rows: CfnAvailability[]) => CfnAvailability[];
  searchAllConventions: (rows: CfnAvailability[], query: string) => CfnAvailability[];
  getResourceCount: () => number;
}

/**
 * React hook that manages Terraform overlay state and provides translation functions.
 *
 * On mount, fetches overlay data and builds an OverlayIndex for O(1) lookups.
 * Provides functions to translate rows, search across conventions, and get resource counts.
 */
export function useTerraformOverlay(cfnRows: CfnAvailability[]): UseTerraformOverlayResult {
  const [convention, setConvention] = useState<NamingConvention>('cloudformation');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overlayData, setOverlayData] = useState<TerraformOverlayData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOverlay() {
      try {
        setLoading(true);
        setError(null);
        const data = await capabilityInsightsClient.listTerraformOverlay();
        if (!cancelled) {
          if (data) {
            setOverlayData(data);
          } else {
            setError('Failed to load Terraform overlay data');
          }
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Terraform overlay data');
          setLoading(false);
        }
      }
    }

    fetchOverlay();
    return () => {
      cancelled = true;
    };
  }, []);

  const index = useMemo<OverlayIndex | null>(() => {
    if (!overlayData) return null;
    return buildOverlayIndex(overlayData);
  }, [overlayData]);

  const translateRowsFn = useCallback(
    (rows: CfnAvailability[]): CfnAvailability[] => {
      if (!index) return rows;
      return translateRows(rows, convention, index);
    },
    [convention, index]
  );

  const searchAllConventionsFn = useCallback(
    (rows: CfnAvailability[], query: string): CfnAvailability[] => {
      if (!index) return rows;
      return searchAllConventions(rows, query, index, convention);
    },
    [convention, index]
  );

  const getResourceCountFn = useCallback((): number => {
    if (!index) return cfnRows.length;
    return getResourceCount(cfnRows, convention, index);
  }, [cfnRows, convention, index]);

  return {
    convention,
    setConvention,
    loading,
    error,
    translateRows: translateRowsFn,
    searchAllConventions: searchAllConventionsFn,
    getResourceCount: getResourceCountFn,
  };
}
