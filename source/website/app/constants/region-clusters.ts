import type { Region } from '@capability-insights/shared/types/capability/region';

export interface RegionCluster {
  label: string;
  regionPrefixes: string[];
}

export const REGION_CLUSTERS: RegionCluster[] = [
  { label: 'US ISO', regionPrefixes: ['us-iso-'] },
  { label: 'US ISOB', regionPrefixes: ['us-isob-'] },
  { label: 'United States', regionPrefixes: ['us-east-', 'us-west-'] },
  { label: 'AWS GovCloud', regionPrefixes: ['us-gov-'] },
  { label: 'Africa', regionPrefixes: ['af-'] },
  { label: 'Asia Pacific', regionPrefixes: ['ap-'] },
  { label: 'Canada', regionPrefixes: ['ca-'] },
  { label: 'Europe', regionPrefixes: ['eu-'] },
  { label: 'AWS European Sovereign Cloud', regionPrefixes: ['eusc-'] },
  { label: 'Israel', regionPrefixes: ['il-'] },
  { label: 'Mexico', regionPrefixes: ['mx-'] },
  { label: 'Middle East', regionPrefixes: ['me-'] },
  { label: 'South America', regionPrefixes: ['sa-'] },
];

export function getRegionCluster(regionCode: string): string {
  for (const cluster of REGION_CLUSTERS) {
    if (cluster.regionPrefixes.some(p => regionCode.startsWith(p))) {
      return cluster.label;
    }
  }
  return 'Other';
}

export function sortRegionsByCluster(regions: Region[]): Region[] {
  return [...regions].sort((a, b) => {
    const aIdx = REGION_CLUSTERS.findIndex(c => c.regionPrefixes.some(p => a.Region.startsWith(p)));
    const bIdx = REGION_CLUSTERS.findIndex(c => c.regionPrefixes.some(p => b.Region.startsWith(p)));
    const aOrder = aIdx === -1 ? REGION_CLUSTERS.length : aIdx;
    const bOrder = bIdx === -1 ? REGION_CLUSTERS.length : bIdx;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.Region.localeCompare(b.Region);
  });
}
