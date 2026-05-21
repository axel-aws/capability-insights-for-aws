import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PutCommand, QueryCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3BucketClient } from '../services/s3-client';
import { docClient } from '../services/dynamo-client';
import { rebuildMergedData, ALLOWED_DATA_FILES } from '../services/data-merge-service';
import type { DataFile } from '../services/data-merge-service';
import { EnvironmentKey, getEnv, getOptionalEnv } from '../constants/environment';
import { StatusCode } from '../constants/status-codes';
import { buildResponse } from '../util/route-helpers';
import { logger } from '../util/logger';
import crypto from 'crypto';

const s3Client = new S3Client({});

function getDataBucketName(): string {
  return getOptionalEnv(EnvironmentKey.DATA_BUCKET_NAME) || getEnv(EnvironmentKey.WEBSITE_BUCKET_NAME);
}

function isAllowedFileName(name: string): name is DataFile {
  return ALLOWED_DATA_FILES.includes(name as DataFile);
}

/**
 * GET /data/info
 */
export async function getDataInfoRoute(_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const bucketName = getDataBucketName();
    const files = await Promise.all(
      ALLOWED_DATA_FILES.map(async fileName => {
        const key = `data/json/${fileName}.json`;
        try {
          const response = await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
          return { name: fileName, lastModified: response.LastModified?.toISOString() ?? null, sizeBytes: response.ContentLength ?? null };
        } catch {
          return { name: fileName, lastModified: null, sizeBytes: null };
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
 * POST /data/uploads/presigned
 * Returns a presigned URL for uploading a file directly to S3.
 */
export async function postPresignedUrlRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { fileName?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'Invalid request body' });
  }

  if (!body.fileName || !isAllowedFileName(body.fileName)) {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'Invalid file name. Allowed: regions, products, apis, cfn_resources' });
  }

  try {
    const bucketName = getDataBucketName();
    const uploadId = crypto.randomUUID();
    const s3Key = `data/uploads/${body.fileName}/${uploadId}.json`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      ContentType: 'application/json',
    });
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    return buildResponse(StatusCode.OK, { uploadId, presignedUrl, s3Key });
  } catch (error: unknown) {
    logger.error('Failed to generate presigned URL', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Failed to generate upload URL' });
  }
}

/**
 * POST /data/uploads/complete
 * Validates the upload exists in S3, stores metadata in DynamoDB, triggers rebuild.
 */
export async function postUploadCompleteRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { uploadId?: string; fileName?: string; s3Key?: string; description?: string };
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'Invalid request body' });
  }

  if (!body.uploadId || !body.fileName || !body.s3Key) {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'uploadId, fileName, and s3Key are required' });
  }

  if (!isAllowedFileName(body.fileName)) {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'Invalid file name' });
  }

  try {
    const bucketName = getDataBucketName();

    // Verify the file exists in S3
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: body.s3Key }));
    } catch {
      return buildResponse(StatusCode.NOT_FOUND, { error: 'Upload not found in S3. The presigned URL may have expired.' });
    }

    // Validate content is a JSON array
    const s3 = new S3BucketClient(bucketName);
    const content = await s3.getObject(body.s3Key);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: body.s3Key }));
      return buildResponse(StatusCode.BAD_REQUEST, { error: 'Uploaded content is not valid JSON' });
    }
    if (!Array.isArray(parsed)) {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: body.s3Key }));
      return buildResponse(StatusCode.BAD_REQUEST, { error: 'Uploaded content must be a JSON array' });
    }

    // Store metadata in DynamoDB
    const tableName = getEnv(EnvironmentKey.DATA_UPLOADS_TABLE_NAME);
    const uploadedAt = new Date().toISOString();
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        uploadId: body.uploadId,
        fileName: body.fileName,
        s3Key: body.s3Key,
        uploadedAt,
        itemCount: parsed.length,
        description: body.description || '',
      },
    }));

    // Trigger rebuild
    const result = await rebuildMergedData(s3, body.fileName);

    return buildResponse(StatusCode.OK, { success: true, uploadId: body.uploadId, uploadedAt, mergeResult: result });
  } catch (error: unknown) {
    logger.error('Failed to complete upload', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Failed to complete upload' });
  }
}

/**
 * GET /data/uploads
 * Lists uploads, optionally filtered by ?fileName=
 */
export async function getUploadsRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const tableName = getEnv(EnvironmentKey.DATA_UPLOADS_TABLE_NAME);
    const fileNameFilter = event.queryStringParameters?.fileName;

    if (fileNameFilter && isAllowedFileName(fileNameFilter)) {
      const result = await docClient.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'FileNameIndex',
        KeyConditionExpression: 'fileName = :fn',
        ExpressionAttributeValues: { ':fn': fileNameFilter },
        ScanIndexForward: false,
      }));
      return buildResponse(StatusCode.OK, { uploads: result.Items ?? [] });
    }

    // Scan all uploads (small table expected)
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const result = await docClient.send(new ScanCommand({ TableName: tableName }));
    const sorted = (result.Items ?? []).sort((a, b) => (b.uploadedAt as string).localeCompare(a.uploadedAt as string));
    return buildResponse(StatusCode.OK, { uploads: sorted });
  } catch (error: unknown) {
    logger.error('Failed to list uploads', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Failed to list uploads' });
  }
}

/**
 * DELETE /data/uploads/:uploadId
 * Deletes an upload from S3 and DynamoDB, triggers rebuild.
 */
export async function deleteUploadRoute(
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> {
  const { uploadId } = params;
  if (!uploadId) {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'uploadId is required' });
  }

  try {
    const tableName = getEnv(EnvironmentKey.DATA_UPLOADS_TABLE_NAME);

    // Get the upload record
    const getResult = await docClient.send(new GetCommand({ TableName: tableName, Key: { uploadId } }));
    if (!getResult.Item) {
      return buildResponse(StatusCode.NOT_FOUND, { error: 'Upload not found' });
    }

    const { s3Key, fileName } = getResult.Item as { s3Key: string; fileName: DataFile };
    const bucketName = getDataBucketName();

    // Delete from S3
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: s3Key }));
    } catch {
      logger.warn('Failed to delete S3 object', { s3Key });
    }

    // Delete from DynamoDB
    await docClient.send(new DeleteCommand({ TableName: tableName, Key: { uploadId } }));

    // Trigger rebuild
    const s3 = new S3BucketClient(bucketName);
    const result = await rebuildMergedData(s3, fileName);

    return buildResponse(StatusCode.OK, { success: true, mergeResult: result });
  } catch (error: unknown) {
    logger.error('Failed to delete upload', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Failed to delete upload' });
  }
}
