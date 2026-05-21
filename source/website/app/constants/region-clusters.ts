import type { Region } from '@capability-insights/shared/types/capability/region';

const GEO_PREFIX_LABELS: Record<string, string> = {
  'us-east-': 'United States',
  'us-west-': 'United States',
  'af-': 'Africa',
  'ap-': 'Asia Pacific',
  'ca-': 'Canada',
  'eu-': 'Europe',
  'il-': 'Israel',
  'mx-': 'Mexico',
  'me-': 'Middle East',
  'sa-': 'South America',
};

const PARTITION_LABELS: Record<string, string> = {
  'aws': '',
  'aws-us-gov': 'AWS GovCloud',
  'aws-iso': 'US ISO',
  'aws-iso-b': 'US ISOB',
  'aws-eusc': 'AWS European Sovereign Cloud',
};

const CLUSTER_ORDER = [
  'US ISO',
  'US ISOB',
  'United States',
  'AWS GovCloud',
  'Africa',
  'Asia Pacific',
  'Canada',
  'Europe',
  'AWS European Sovereign Cloud',
  'Israel',
  'Mexico',
  'Middle East',
  'South America',
  'Other',
];

export function getRegionCluster(region: Region): string {
  const partitionLabel = PARTITION_LABELS[region.Partition];
  if (partitionLabel) return partitionLabel;

  for (const [prefix, label] of Object.entries(GEO_PREFIX_LABELS)) {
    if (region.Region.startsWith(prefix)) return label;
  }

  return 'Other';
}

export function sortRegionsByCluster(regions: Region[]): Region[] {
  return [...regions].sort((a, b) => {
    const aCluster = getRegionCluster(a);
    const bCluster = getRegionCluster(b);
    const aOrder = CLUSTER_ORDER.indexOf(aCluster);
    const bOrder = CLUSTER_ORDER.indexOf(bCluster);
    const aIdx = aOrder === -1 ? CLUSTER_ORDER.length : aOrder;
    const bIdx = bOrder === -1 ? CLUSTER_ORDER.length : bOrder;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.Region.localeCompare(b.Region);
  });
}
