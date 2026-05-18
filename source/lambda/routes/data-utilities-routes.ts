import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3BucketClient } from '../services/s3-client';
import { EnvironmentKey, getEnv } from '../constants/environment';
import { StatusCode } from '../constants/status-codes';
import { corsHeaders } from '../types/api';
import { ContentType, FileFormat } from '../constants/file-formats';
import { mergeJson, ChildMergeConfig } from '../data-fetch/merge/merge-json';
import { logger } from '../util/logger';
import crypto from 'crypto';

import type { Region } from '@capability-insights/shared/types/capability/region';
import type { Product } from '@capability-insights/shared/types/capability/product';
import type { ApiService, ApiOperation } from '@capability-insights/shared/types/capability/api';
import type { CfnResource, CfnResourceType } from '@capability-insights/shared/types/capability/cfn';

/**
 * Allowed data file names for upload and merge operations.
 */
export const ALLOWED_DATA_FILES = ['regions', 'products', 'apis', 'cfn_resources'] as const;
export type DataFile = (typeof ALLOWED_DATA_FILES)[number];

/**
 * Merge preview result returned by the preview endpoint.
 */
export interface MergePreview {
  mergeId: string;
  fileName: string;
  additions: number;
  updates: number;
  unchanged: number;
  totalAfterMerge: number;
}

/**
 * Identity functions for each data file type, used for merge operations.
 */
interface DataFileConfig {
  getId: (item: never) => string;
  childConfigs?: ChildMergeConfig[];
}

const DATA_FILE_CONFIGS: Record<DataFile, DataFileConfig> = {
  regions: {
    getId: (r: never) => (r as unknown as Region).Region,
  },
  products: {
    getId: (p: never) => (p as unknown as Product).productId,
    childConfigs: [{ key: 'childProducts', getId: (c: never) => (c as unknown as Product).productId }],
  },
  apis: {
    getId: (a: never) => (a as unknown as ApiService).sdkServiceName,
    childConfigs: [{ key: 'apis', getId: (op: never) => (op as unknown as ApiOperation).apiName }],
  },
  cfn_resources: {
    getId: (r: never) => (r as unknown as CfnResource).serviceName,
    childConfigs: [{ key: 'resourceTypes', getId: (rt: never) => (rt as unknown as CfnResourceType).resourceTypeName }],
  },
};

const s3Client = new S3Client({});

function buildResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

function isAllowedFileName(name: string): name is DataFile {
  return ALLOWED_DATA_FILES.includes(name as DataFile);
}

function validateFileNameAndContent(body: { fileName?: string; content?: string }): APIGatewayProxyResult | null {
  if (!body.fileName || !isAllowedFileName(body.fileName)) {
    return buildResponse(StatusCode.BAD_REQUEST, {
      error: 'Invalid file name. Allowed: regions, products, apis, cfn_resources',
    });
  }

  if (!body.content) {
    return buildResponse(StatusCode.BAD_REQUEST, {
      error: 'Content must be a valid JSON array',
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.content);
  } catch {
    return buildResponse(StatusCode.BAD_REQUEST, {
      error: 'Content must be a valid JSON array',
    });
  }

  if (!Array.isArray(parsed)) {
    return buildResponse(StatusCode.BAD_REQUEST, {
      error: 'Content must be a valid JSON array',
    });
  }

  return null;
}

/**
 * GET /data/info
 * Lists data files with last-modified timestamps and sizes from S3.
 */
export async function getDataInfoRoute(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const bucketName = getEnv(EnvironmentKey.DATA_BUCKET_NAME);

    const files = await Promise.all(
      ALLOWED_DATA_FILES.map(async fileName => {
        const key = `data/json/${fileName}.json`;
        try {
          const response = await s3Client.send(
            new HeadObjectCommand({ Bucket: bucketName, Key: key }),
          );
          return {
            name: fileName,
            lastModified: response.LastModified?.toISOString() ?? null,
            sizeBytes: response.ContentLength ?? null,
          };
        } catch {
          return {
            name: fileName,
            lastModified: null,
            sizeBytes: null,
          };
        }
      }),
    );

    return buildResponse(StatusCode.OK, { files });
  } catch (error: unknown) {
    logger.error('Failed to get data info', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Data storage unavailable' });
  }
}

/**
 * POST /data/upload
 * Validates file name and content, writes JSON array to S3.
 */
export async function postDataUploadRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { fileName?: string; content?: string };

  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'Content must be a valid JSON array' });
  }

  const validationError = validateFileNameAndContent(body);
  if (validationError) return validationError;

  const fileName = body.fileName as DataFile;
  const content = body.content as string;

  try {
    const bucketName = getEnv(EnvironmentKey.DATA_BUCKET_NAME);
    const s3 = new S3BucketClient(bucketName);
    const key = `data/json/${fileName}.json`;

    await s3.putObject(key, content, ContentType[FileFormat.JSON]);

    // Get the last modified timestamp after writing
    const headResponse = await s3Client.send(
      new HeadObjectCommand({ Bucket: bucketName, Key: key }),
    );

    return buildResponse(StatusCode.OK, {
      success: true,
      lastModified: headResponse.LastModified?.toISOString() ?? new Date().toISOString(),
    });
  } catch (error: unknown) {
    logger.error('Failed to upload data file', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Data storage unavailable' });
  }
}

/**
 * POST /data/merge/preview
 * Validates file name and content, stages uploaded data in S3,
 * computes merge preview (additions, updates, unchanged, totalAfterMerge).
 */
export async function postMergePreviewRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { fileName?: string; content?: string };

  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'Content must be a valid JSON array' });
  }

  const validationError = validateFileNameAndContent(body);
  if (validationError) return validationError;

  const fileName = body.fileName as DataFile;
  const content = body.content as string;

  try {
    const bucketName = getEnv(EnvironmentKey.DATA_BUCKET_NAME);
    const s3 = new S3BucketClient(bucketName);

    // Generate a unique merge ID
    const mergeId = crypto.randomUUID();

    // Stage uploaded data in S3
    const stagingKey = `data/merge-staging/${mergeId}/${fileName}.json`;
    await s3.putObject(stagingKey, content, ContentType[FileFormat.JSON]);

    // Read existing data from S3
    let existingData: unknown[] = [];
    try {
      const existingRaw = await s3.getObject(`data/json/${fileName}.json`);
      existingData = JSON.parse(existingRaw) as unknown[];
    } catch {
      // File doesn't exist yet — treat as empty
      existingData = [];
    }

    // Parse uploaded data
    const uploadedData = JSON.parse(content) as unknown[];

    // Compute merge preview using identity functions
    const config = DATA_FILE_CONFIGS[fileName];
    const existingMap = new Map<string, unknown>();
    for (const item of existingData) {
      const id = config.getId(item as never);
      existingMap.set(id, item);
    }

    let additions = 0;
    let updates = 0;
    const uploadedIds = new Set<string>();

    for (const item of uploadedData) {
      const id = config.getId(item as never);
      uploadedIds.add(id);
      if (existingMap.has(id)) {
        updates++;
      } else {
        additions++;
      }
    }

    const unchanged = existingData.filter(item => {
      const id = config.getId(item as never);
      return !uploadedIds.has(id);
    }).length;

    const totalAfterMerge = unchanged + updates + additions;

    const preview: MergePreview = {
      mergeId,
      fileName,
      additions,
      updates,
      unchanged,
      totalAfterMerge,
    };

    return buildResponse(StatusCode.OK, preview);
  } catch (error: unknown) {
    logger.error('Failed to compute merge preview', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Data storage unavailable' });
  }
}

/**
 * POST /data/merge/commit
 * Reads staged data, performs merge using existing mergeJson logic,
 * writes result to S3, cleans up staging.
 */
export async function postMergeCommitRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { fileName?: string; mergeId?: string };

  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'Invalid request body' });
  }

  if (!body.fileName || !isAllowedFileName(body.fileName)) {
    return buildResponse(StatusCode.BAD_REQUEST, {
      error: 'Invalid file name. Allowed: regions, products, apis, cfn_resources',
    });
  }

  if (!body.mergeId) {
    return buildResponse(StatusCode.NOT_FOUND, { error: 'Merge session not found or expired' });
  }

  const fileName = body.fileName as DataFile;
  const mergeId = body.mergeId;

  try {
    const bucketName = getEnv(EnvironmentKey.DATA_BUCKET_NAME);
    const s3 = new S3BucketClient(bucketName);

    // Read staged data
    const stagingKey = `data/merge-staging/${mergeId}/${fileName}.json`;
    let stagedData: string;
    try {
      stagedData = await s3.getObject(stagingKey);
    } catch {
      return buildResponse(StatusCode.NOT_FOUND, { error: 'Merge session not found or expired' });
    }

    // Read existing data from S3
    let existingData = '[]';
    try {
      existingData = await s3.getObject(`data/json/${fileName}.json`);
    } catch {
      // File doesn't exist yet — treat as empty array
    }

    // Perform merge using existing mergeJson logic
    const config = DATA_FILE_CONFIGS[fileName];
    const merged = mergeJson(
      [existingData, stagedData],
      config.getId as (item: unknown) => string,
      config.childConfigs,
    );

    // Write merged result to S3
    await s3.putObject(`data/json/${fileName}.json`, merged, ContentType[FileFormat.JSON]);

    // Clean up staging file
    try {
      await s3Client.send(
        new DeleteObjectCommand({ Bucket: bucketName, Key: stagingKey }),
      );
    } catch (cleanupError) {
      logger.warn('Failed to clean up staging file', { stagingKey, error: String(cleanupError) });
    }

    // Count items in merged result
    const mergedItems = JSON.parse(merged) as unknown[];

    return buildResponse(StatusCode.OK, {
      success: true,
      itemCount: mergedItems.length,
    });
  } catch (error: unknown) {
    logger.error('Failed to commit merge', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Data storage unavailable' });
  }
}
