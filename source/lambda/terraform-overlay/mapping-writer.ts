import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type {
  TerraformOverlayData,
  AwsccMapping,
  ClassicAwsMapping,
  OverlayMetadata,
} from '../../shared/types/terraform-overlay';

export interface AssembleOverlayParams {
  awsccMappings: AwsccMapping[];
  classicAwsMappings: ClassicAwsMapping[];
  awsccCommitSha: string;
  classicAwsCommitSha: string;
}

export interface WriteOverlayParams {
  data: TerraformOverlayData;
  bucketName: string;
  s3Client?: S3Client;
}

const OVERLAY_S3_KEY = 'data/json/terraform_overlay.json';

/**
 * Pure function that assembles a TerraformOverlayData object from inputs.
 *
 * Combines AWSCC and classic AWS mappings with metadata including
 * generation timestamp, commit SHAs, and resource counts.
 */
export function assembleOverlayData(params: AssembleOverlayParams): TerraformOverlayData {
  const { awsccMappings, classicAwsMappings, awsccCommitSha, classicAwsCommitSha } = params;

  const metadata: OverlayMetadata = {
    generatedAt: new Date().toISOString(),
    awsccProviderCommitSha: awsccCommitSha,
    classicAwsProviderCommitSha: classicAwsCommitSha,
    awsccResourceCount: awsccMappings.length,
    classicAwsResourceCount: classicAwsMappings.length,
  };

  return {
    metadata,
    awscc: awsccMappings,
    classicAws: classicAwsMappings,
  };
}

/**
 * Serializes a TerraformOverlayData object to a JSON string.
 *
 * Uses 2-space indentation for readability.
 */
export function serializeOverlayData(data: TerraformOverlayData): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Parses a JSON string back into a typed TerraformOverlayData object.
 *
 * Throws if the JSON is malformed or missing required fields.
 */
export function deserializeOverlayData(json: string): TerraformOverlayData {
  const parsed = JSON.parse(json) as TerraformOverlayData;

  // Validate required top-level structure
  if (!parsed.metadata || !Array.isArray(parsed.awscc) || !Array.isArray(parsed.classicAws)) {
    throw new Error('Invalid TerraformOverlayData: missing required fields (metadata, awscc, classicAws)');
  }

  return parsed;
}

/**
 * Writes the assembled TerraformOverlayData JSON to S3.
 *
 * Writes to key: `data/json/terraform_overlay.json`
 * Content-Type: application/json
 *
 * The S3 client is injectable for testing — pass an S3Client instance
 * via params.s3Client, or a default client will be created.
 */
export async function writeOverlayToS3(params: WriteOverlayParams): Promise<void> {
  const { data, bucketName, s3Client } = params;
  const client = s3Client ?? new S3Client({});
  const body = serializeOverlayData(data);

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: OVERLAY_S3_KEY,
      Body: body,
      ContentType: 'application/json',
    }),
  );
}
