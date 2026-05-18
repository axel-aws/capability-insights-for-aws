export interface OverlayMetadata {
  generatedAt: string; // ISO 8601 timestamp
  awsccProviderCommitSha: string;
  classicAwsProviderCommitSha: string;
  awsccResourceCount: number;
  classicAwsResourceCount: number;
}

export interface AwsccMapping {
  terraformType: string; // e.g., "awscc_s3_bucket"
  cfnType: string; // e.g., "AWS::S3::Bucket"
}

export interface ClassicAwsMapping {
  terraformType: string; // e.g., "aws_s3_bucket"
  cfnType: string | null; // null for unmapped resources
}

export interface TerraformOverlayData {
  metadata: OverlayMetadata;
  awscc: AwsccMapping[];
  classicAws: ClassicAwsMapping[];
}

export type NamingConvention = 'cloudformation' | 'terraform-aws' | 'terraform-awscc';

/** Built from TerraformOverlayData for O(1) lookups */
export interface OverlayIndex {
  /** CFN type → AWSCC terraform type */
  cfnToAwscc: Map<string, string>;
  /** CFN type → Classic AWS terraform type */
  cfnToClassicAws: Map<string, string>;
  /** AWSCC terraform type → CFN type */
  awsccToCfn: Map<string, string>;
  /** Classic AWS terraform type → CFN type */
  classicAwsToCfn: Map<string, string | null>;
  /** All unmapped classic AWS resources */
  unmappedClassicAws: ClassicAwsMapping[];
  /** All AWSCC resources (for display when no CFN match exists) */
  allAwscc: AwsccMapping[];
}
