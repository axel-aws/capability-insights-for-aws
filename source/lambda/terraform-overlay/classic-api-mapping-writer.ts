import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { ClassicApiMappingData } from '../../shared/types/terraform-classic-api-mapping';

export interface WriteClassicApiMappingParams {
  data: ClassicApiMappingData;
  bucketName: string;
  s3Client?: S3Client;
}

const CLASSIC_API_MAPPING_S3_KEY = 'data/json/terraform_classic_api_mapping.json';

/**
 * Serializes a ClassicApiMappingData object to a JSON string.
 *
 * Uses 2-space indentation for readability.
 */
export function serializeClassicApiMapping(data: ClassicApiMappingData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Parses a JSON string back into a typed ClassicApiMappingData object.
 *
 * Throws if the JSON is malformed or missing required fields.
 */
export function deserializeClassicApiMapping(json: string): ClassicApiMappingData {
  const parsed = JSON.parse(json) as ClassicApiMappingData;

  // Validate required top-level structure
  if (!parsed.metadata || !Array.isArray(parsed.resources)) {
    throw new Error('Invalid ClassicApiMappingData: missing required fields (metadata, resources)');
  }

  return parsed;
}

/**
 * Writes the ClassicApiMappingData JSON to S3.
 *
 * Writes to key: `data/json/terraform_classic_api_mapping.json`
 * Content-Type: application/json
 *
 * The S3 client is injectable for testing — pass an S3Client instance
 * via params.s3Client, or a default client will be created.
 */
export async function writeClassicApiMappingToS3(params: WriteClassicApiMappingParams): Promise<void> {
  const { data, bucketName, s3Client } = params;
  const client = s3Client ?? new S3Client({});
  const body = serializeClassicApiMapping(data);

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: CLASSIC_API_MAPPING_S3_KEY,
      Body: body,
      ContentType: 'application/json',
    }),
  );
}
