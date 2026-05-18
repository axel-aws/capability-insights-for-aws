import { useState, useEffect, useMemo } from 'react';
import type { ApiAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { ClassicApiMappingData } from '@capability-insights/shared/types/terraform-classic-api-mapping';
import { buildAvailabilityTree } from './classic-api-availability-engine';
import { s3Client } from '~/clients/s3-client';

export interface UseClassicApiAvailabilityResult {
  rows: ApiAvailability[];
  loading: boolean;
  error: string | null;
  resourceCount: number;
  serviceCount: number;
}

/**
 * Filter the tree by matching against resource names, service names, and operation names.
 * Case-insensitive partial substring matching.
 * When a match is found, includes the matching row and all its ancestors.
 *
 * This is a pure function exported separately for testability.
 */
export function filterTreeBySearch(rows: ApiAvailability[], searchQuery: string): ApiAvailability[] {
  if (!searchQuery) {
    return rows;
  }

  const lowerQuery = searchQuery.toLowerCase();

  // Build a map from row ID to row for parent lookups
  const byId = new Map(rows.map(r => [r.id, r]));

  // Find all rows that match the search query
  const matchingIds = new Set<string>();
  for (const row of rows) {
    if (row.name.toLowerCase().includes(lowerQuery)) {
      matchingIds.add(row.id);
    }
  }

  // Collect all ancestor IDs for matching rows
  const includedIds = new Set<string>(matchingIds);
  for (const id of matchingIds) {
    let current = byId.get(id);
    while (current?.parentId) {
      includedIds.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }

  // Return rows that are either matching or ancestors of matching rows
  return rows.filter(row => includedIds.has(row.id));
}

/**
 * React hook that fetches the Terraform classic API mapping data and computes
 * the availability tree by cross-referencing with existing API operations data.
 *
 * On mount, fetches `terraform_classic_api_mapping.json` from S3.
 * When both mapping data and apiRows are available, builds the three-level tree.
 */
export function useClassicApiAvailability(
  apiRows: ApiAvailability[],
  regions: Region[],
): UseClassicApiAvailabilityResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mappingData, setMappingData] = useState<ClassicApiMappingData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchMapping() {
      try {
        setLoading(true);
        setError(null);
        const data = await s3Client.fetchJson<ClassicApiMappingData>(
          '/data/json/terraform_classic_api_mapping.json',
        );
        if (!cancelled) {
          setMappingData(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load Terraform classic API mapping data');
          setLoading(false);
        }
      }
    }

    fetchMapping();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo<ApiAvailability[]>(() => {
    if (!mappingData || apiRows.length === 0 || regions.length === 0) {
      return [];
    }
    return buildAvailabilityTree(mappingData, apiRows, regions);
  }, [mappingData, apiRows, regions]);

  const resourceCount = mappingData?.metadata.resourceCount ?? 0;
  const serviceCount = mappingData?.metadata.serviceCount ?? 0;

  return {
    rows,
    loading,
    error,
    resourceCount,
    serviceCount,
  };
}
