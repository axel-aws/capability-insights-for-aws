import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { S3BucketClient } from './services/s3-client';
import { SyncSettingsStore } from './services/sync-settings-store';
import { GitHubTokenStore } from './services/github-token-store';
import { EnvironmentKey, getEnv } from './constants/environment';
import { ContentType, FileFormat } from './constants/file-formats';
import { logger } from './util/logger';
import { mergeCsv } from './data-fetch/merge/merge-csv';
import { mergeJson } from './data-fetch/merge/merge-json';

import type { Region } from '@capability-insights/shared/types/capability/region';
import type { Product } from '@capability-insights/shared/types/capability/product';
import type { ApiService, ApiOperation } from '@capability-insights/shared/types/capability/api';
import type {
  CfnResource,
  CfnResourceType,
  CfnResourceProperty,
  CfnResourceConfiguration,
} from '@capability-insights/shared/types/capability/cfn';
import type { OverlayLambdaResponse } from './terraform-overlay/handler';
import type { SyncMetadata } from '@capability-insights/shared/types/sync-metadata';

/** Event shape for the data-fetch Lambda. */
export interface DataFetchEvent {
  /** When set to 'manual', the Lambda always proceeds regardless of the dataSyncEnabled toggle. */
  source?: 'manual' | string;
}

/**
 * Fetches capability data from an S3 access point, merges data across all
 * source folders, and writes the combined results to the website S3 bucket.
 *
 * Folders are specified via the SOURCE_FOLDERS environment variable. Each
 * folder is validated by checking for a v1/manifest.json. For each valid
 * folder, the JSON and CSV files under v1/{format}/ are collected and
 * merged per file type, then uploaded to data/{format}/ in the website bucket.
 *
 * When `dataSyncEnabled` is false in SyncSettingsStore and the invocation is
 * a scheduled event (not manual), the S3 access point fetch loop is skipped
 * and sync metadata is written with `dataSyncSkipped: true`.
 */
export const handler = async (event?: DataFetchEvent): Promise<{
  statusCode: number;
  body: string;
}> => {
  const isManualInvocation = event?.source === 'manual';

  // Check dataSyncEnabled toggle for scheduled (non-manual) invocations
  if (!isManualInvocation) {
    try {
      const settingsStore = new SyncSettingsStore(getEnv(EnvironmentKey.POLICY_TABLE_NAME));
      const settings = await settingsStore.getSettings();

      if (!settings.dataSyncEnabled) {
        logger.info('Data sync is disabled and invocation is scheduled, skipping S3 access point fetch');
        const dest = new S3BucketClient(getEnv(EnvironmentKey.DATA_BUCKET_NAME));
        const metadata: SyncMetadata = {
          dataSyncSkipped: true,
          lastSyncTime: new Date().toISOString(),
        };
        await dest.putObject('data/sync-metadata.json', JSON.stringify(metadata), ContentType[FileFormat.JSON]);
        return { statusCode: 200, body: JSON.stringify({ message: 'Data sync skipped (disabled)' }) };
      }
    } catch (e) {
      // Fail-safe: if we cannot read settings, proceed with the sync
      logger.error('Failed to read dataSyncEnabled setting, proceeding with sync (fail-safe)', {
        error: String(e),
      });
    }
  }

  const source = new S3BucketClient(getEnv(EnvironmentKey.SOURCE_ACCESS_POINT_ARN));
  const dest = new S3BucketClient(getEnv(EnvironmentKey.DATA_BUCKET_NAME));

  const folders = getEnv(EnvironmentKey.SOURCE_FOLDERS).split(',');
  logger.info('Source folders', { folders });

  // Validate each folder by checking for a v1 manifest
  const validFolders: string[] = [];
  const errors: string[] = [];
  for (const folder of folders) {
    try {
      await source.getObject(`${folder}/v1/manifest.json`);
      validFolders.push(`${folder}/`);
    } catch (e) {
      errors.push(`No manifest found for folder: ${folder}`);
      logger.info('No manifest found, skipping folder', {
        folder,
        error: String(e),
      });
    }
  }

  // Fetch, merge, and upload each file type per format
  for (const format of FORMATS) {
    for (const name of FILE_NAMES) {
      const merge = getMergeFn(format, name);
      const chunks: string[] = [];
      for (const folder of validFolders) {
        try {
          const raw = await source.getObject(`${folder}v1/${format}/${name}.${format}`);
          chunks.push(raw);
        } catch (e) {
          errors.push(`Failed to fetch ${format}/${name} from ${folder}: ${String(e)}`);
          logger.error('Failed to fetch file', {
            folder,
            format,
            name,
            error: String(e),
          });
        }
      }
      if (chunks.length > 0) {
        const merged = merge(chunks);
        await dest.putObject(`data/${format}/${name}.${format}`, merged, ContentType[format]);
        logger.info('Wrote merged file', {
          path: `data/${format}/${name}.${format}`,
        });
      }
    }
  }

  // Read sync settings from DynamoDB to determine whether to invoke Terraform overlay
  let overlayMetadata: SyncMetadata['terraformOverlay'] | undefined;
  let classicApiMappingMetadata: SyncMetadata['terraformClassicApiMapping'] | undefined;
  let terraformOverlaySkipped = false;
  const overlayFunctionName = process.env[EnvironmentKey.TERRAFORM_OVERLAY_FUNCTION_NAME];

  if (overlayFunctionName) {
    let shouldInvokeOverlay = false;
    let githubToken: string | undefined;

    try {
      const settingsStore = new SyncSettingsStore(getEnv(EnvironmentKey.POLICY_TABLE_NAME));
      const settings = await settingsStore.getSettings();

      if (settings.terraformOverlayEnabled) {
        try {
          const secretName = getEnv(EnvironmentKey.GITHUB_TOKEN_SECRET_NAME);
          const tokenStore = new GitHubTokenStore(secretName);
          const token = await tokenStore.getToken();

          if (token) {
            shouldInvokeOverlay = true;
            githubToken = token;
            logger.info('Terraform overlay enabled with token present, will invoke overlay');
          } else {
            terraformOverlaySkipped = true;
            logger.info('Terraform overlay enabled but no token stored in Secrets Manager, skipping overlay');
          }
        } catch (e) {
          terraformOverlaySkipped = true;
          logger.error('Failed to retrieve GitHub token from Secrets Manager', { error: String(e) });
        }
      } else {
        terraformOverlaySkipped = true;
        logger.info('Terraform overlay disabled, skipping overlay invocation');
      }
    } catch (e) {
      // Fail-safe: if DynamoDB read fails, skip overlay invocation
      terraformOverlaySkipped = true;
      logger.error('Failed to read sync settings from DynamoDB, skipping overlay invocation (fail-safe)', {
        error: String(e),
      });
    }

    if (shouldInvokeOverlay) {
      try {
        const lambdaClient = new LambdaClient({});
        const dataBucketName = getEnv(EnvironmentKey.DATA_BUCKET_NAME);

        logger.info('Invoking Terraform overlay Lambda', { functionName: overlayFunctionName });

        const invokeResponse = await lambdaClient.send(
          new InvokeCommand({
            FunctionName: overlayFunctionName,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify({ dataBucketName, githubToken }),
          }),
        );

        const payloadString = invokeResponse.Payload ? new TextDecoder().decode(invokeResponse.Payload) : '{}';
        const overlayResult: OverlayLambdaResponse = JSON.parse(payloadString);

        if (invokeResponse.FunctionError) {
          const errorMsg = `Terraform overlay Lambda returned error: ${payloadString}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        } else if (overlayResult.statusCode !== 200) {
          const errorMsg = `Terraform overlay Lambda failed with status ${overlayResult.statusCode}: ${(overlayResult.errors ?? []).join(', ')}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        } else {
          overlayMetadata = {
            generatedAt: new Date().toISOString(),
            awsccResourceCount: overlayResult.awsccCount,
            classicAwsResourceCount: overlayResult.classicAwsCount,
          };
          logger.info('Terraform overlay completed successfully', {
            awsccCount: overlayResult.awsccCount,
            classicAwsCount: overlayResult.classicAwsCount,
            classicApiMappingCount: overlayResult.classicApiMappingCount,
          });

          // Populate classic API mapping metadata if resources were generated
          if (overlayResult.classicApiMappingCount > 0) {
            classicApiMappingMetadata = {
              generatedAt: new Date().toISOString(),
              resourceCount: overlayResult.classicApiMappingCount,
              serviceCount: overlayResult.classicAwsCount,
            };
          }

          // Include any non-fatal errors from the overlay (e.g., partial classic API mapping failures)
          if (overlayResult.errors && overlayResult.errors.length > 0) {
            for (const overlayError of overlayResult.errors) {
              errors.push(`Terraform overlay warning: ${overlayError}`);
            }
          }
        }
      } catch (e) {
        const errorMsg = `Terraform overlay invocation failed: ${String(e)}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }
  }

  // Write sync metadata — only set lastSyncTime on full success
  const metadata: SyncMetadata = errors.length > 0 ? { errors } : { lastSyncTime: new Date().toISOString() };

  if (overlayMetadata) {
    metadata.terraformOverlay = overlayMetadata;
  }

  if (classicApiMappingMetadata) {
    metadata.terraformClassicApiMapping = classicApiMappingMetadata;
  }

  if (terraformOverlaySkipped) {
    metadata.terraformOverlaySkipped = true;
  }

  await dest.putObject('data/sync-metadata.json', JSON.stringify(metadata), ContentType[FileFormat.JSON]);

  return { statusCode: 200, body: JSON.stringify({ message: 'ok' }) };
};

/**
 * Relevant file formats to support in data sync.
 */
const FORMATS = [FileFormat.JSON, FileFormat.CSV] as const;

/**
 * Merge strategies for each JSON data file. Each entry defines how to
 * deduplicate top-level items (by ID) and, optionally, their nested
 * child arrays (by child ID) when combining chunks.
 */
type MergeFn = (chunks: string[]) => string;

const JSON_MERGES: Record<string, MergeFn> = {
  regions: chunks => mergeJson<Region>(chunks, r => r.Region),
  products: chunks =>
    mergeJson<Product>(chunks, p => p.productId, [{ key: 'childProducts', getId: (c: Product) => c.productId }]),
  apis: chunks =>
    mergeJson<ApiService>(chunks, a => a.sdkServiceName, [{ key: 'apis', getId: (op: ApiOperation) => op.apiName }]),
  cfn_resources: chunks =>
    mergeJson<CfnResource>(chunks, r => r.serviceName, [
      { key: 'resourceTypes', getId: (rt: CfnResourceType) => rt.resourceTypeName },
      { key: 'resourceProperties', getId: (rp: CfnResourceProperty) => rp.resourcePropertyName },
      { key: 'resourceConfigurations', getId: (rc: CfnResourceConfiguration) => rc.resourceConfigurationName },
    ]),
};

const FILE_NAMES = Object.keys(JSON_MERGES);

const getMergeFn = (format: string, fileName: string): MergeFn => {
  if (format === FileFormat.CSV) return mergeCsv;
  return JSON_MERGES[fileName];
};
