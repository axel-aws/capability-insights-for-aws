import { S3BucketClient } from './s3-client';
import { mergeJson, ChildMergeConfig } from '../data-fetch/merge/merge-json';
import { ContentType, FileFormat } from '../constants/file-formats';
import { logger } from '../util/logger';

export type DataFile = 'regions' | 'products' | 'apis' | 'cfn_resources';
export const ALLOWED_DATA_FILES: readonly DataFile[] = ['regions', 'products', 'apis', 'cfn_resources'];

interface DataFileConfig {
  getId: (item: unknown) => string;
  childConfigs?: ChildMergeConfig[];
}

const DATA_FILE_CONFIGS: Record<DataFile, DataFileConfig> = {
  regions: { getId: (r: any) => r.Region },
  products: { getId: (p: any) => p.productId, childConfigs: [{ key: 'childProducts', getId: (c: any) => c.productId }] },
  apis: { getId: (a: any) => a.sdkServiceName, childConfigs: [{ key: 'apis', getId: (op: any) => op.apiName }] },
  cfn_resources: { getId: (r: any) => r.serviceName, childConfigs: [{ key: 'resourceTypes', getId: (rt: any) => rt.resourceTypeName }] },
};

export interface MergeResult {
  additions: number;
  updates: number;
  unchanged: number;
  total: number;
}

/**
 * Rebuilds data/json/{fileName}.json by merging canonical data with all uploads.
 * Uploads always win over canonical data.
 */
export async function rebuildMergedData(s3: S3BucketClient, fileName: DataFile): Promise<MergeResult> {
  let canonicalRaw = '[]';
  try {
    canonicalRaw = await s3.getObject(`data/canonical/${fileName}.json`);
  } catch {
    // No canonical data yet
  }

  const uploadKeys = await s3.listObjects(`data/uploads/${fileName}/`);
  const uploadContents: string[] = [];
  for (const key of uploadKeys) {
    try {
      const content = await s3.getObject(key);
      uploadContents.push(content);
    } catch {
      logger.warn('Failed to read upload', { key });
    }
  }

  const config = DATA_FILE_CONFIGS[fileName];
  const allSources = [canonicalRaw, ...uploadContents];
  const merged = mergeJson(allSources, config.getId, config.childConfigs);

  const canonicalItems = JSON.parse(canonicalRaw) as unknown[];
  const mergedItems = JSON.parse(merged) as unknown[];
  const canonicalIds = new Set(canonicalItems.map(i => config.getId(i)));

  let additions = 0, updates = 0;
  for (const item of mergedItems) {
    if (!canonicalIds.has(config.getId(item))) additions++;
    else updates++;
  }
  const unchanged = mergedItems.length - additions - updates;

  await s3.putObject(`data/json/${fileName}.json`, merged, ContentType[FileFormat.JSON]);

  return { additions, updates, unchanged: Math.max(0, unchanged), total: mergedItems.length };
}
