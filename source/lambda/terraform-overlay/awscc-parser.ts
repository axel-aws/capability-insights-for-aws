import type { AwsccMapping } from '../../shared/types/terraform-overlay';

/** Pattern for valid CFN type names: AWS::Service::Resource */
const CFN_TYPE_PATTERN = /^AWS::[A-Za-z0-9]+::[A-Za-z0-9]+$/;

/**
 * Parses the content of an AWSCC schema JSON file and extracts the mapping
 * between the AWSCC Terraform type and its corresponding CloudFormation type.
 *
 * The `typeName` field inside the JSON is the authoritative CFN type
 * (e.g., "AWS::S3::Bucket"). This is more reliable than deriving the type
 * from the filename.
 *
 * Returns null if the content cannot be parsed, has no typeName field,
 * or the typeName doesn't match the expected AWS::Service::Resource pattern.
 */
export function parseAwsccSchemaContent(jsonContent: string): AwsccMapping | null {
  try {
    const parsed = JSON.parse(jsonContent);

    if (!parsed || typeof parsed.typeName !== 'string') {
      return null;
    }

    const cfnType: string = parsed.typeName;

    if (!CFN_TYPE_PATTERN.test(cfnType)) {
      return null;
    }

    const terraformType = cfnTypeToAwscc(cfnType);

    return { terraformType, cfnType };
  } catch {
    return null;
  }
}

/**
 * Parses an AWSCC schema filename into a mapping entry linking the
 * AWSCC Terraform type to its corresponding CloudFormation type.
 *
 * Transformation:
 *   Input: "AWS_S3_Bucket.json"
 *   Strip ".json" → "AWS_S3_Bucket"
 *   CFN type: replace "_" with "::" → "AWS::S3::Bucket"
 *   AWSCC type: remove "AWS_", lowercase, prefix "awscc_" → "awscc_s3_bucket"
 *
 * Returns null for filenames that don't match the expected pattern.
 */
export function parseAwsccSchemaFilename(filename: string): AwsccMapping | null {
  if (!filename.endsWith('.json')) {
    return null;
  }

  const baseName = filename.slice(0, -5); // Strip ".json"

  if (!baseName.startsWith('AWS_')) {
    return null;
  }

  // Must have at least three parts: AWS, Service, Resource
  const parts = baseName.split('_');
  if (parts.length < 3) {
    return null;
  }

  // CFN type: replace "_" with "::" → "AWS::S3::Bucket"
  const cfnType = parts.join('::');

  // AWSCC type: remove leading "AWS_", lowercase, prefix "awscc_"
  const withoutAwsPrefix = baseName.slice(4); // Remove "AWS_"
  const terraformType = 'awscc_' + withoutAwsPrefix.toLowerCase();

  return { terraformType, cfnType };
}

/**
 * Converts a CloudFormation type to its AWSCC Terraform equivalent.
 *
 * Transformation:
 *   Input: "AWS::S3::Bucket"
 *   Replace "::" with "_" → "AWS_S3_Bucket"
 *   Remove leading "AWS_" → "S3_Bucket"
 *   Lowercase → "s3_bucket"
 *   Prefix with "awscc_" → "awscc_s3_bucket"
 */
export function cfnTypeToAwscc(cfnType: string): string {
  const underscored = cfnType.replace(/::/g, '_'); // "AWS_S3_Bucket"
  const withoutAwsPrefix = underscored.slice(4); // "S3_Bucket"
  return 'awscc_' + withoutAwsPrefix.toLowerCase(); // "awscc_s3_bucket"
}

/**
 * Converts an AWSCC Terraform type to its CloudFormation equivalent (best-effort).
 *
 * Transformation:
 *   Input: "awscc_s3_bucket"
 *   Remove "awscc_" prefix → "s3_bucket"
 *   Split by "_", capitalize first letter of each segment → ["S3", "Bucket"]
 *   Join with "::" → "S3::Bucket"
 *   Prepend "AWS::" → "AWS::S3::Bucket"
 *
 * Note: This is a best-effort reverse since lowercasing loses original casing
 * (e.g., "EC2" becomes "Ec2"). For exact round-trips, use the overlay index maps.
 */
export function awsccToCfnType(awsccType: string): string {
  const withoutPrefix = awsccType.slice(6); // Remove "awscc_"
  const segments = withoutPrefix.split('_');
  const capitalized = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return 'AWS::' + capitalized.join('::');
}
