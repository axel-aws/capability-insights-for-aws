export interface ClassicApiMappingMetadata {
  generatedAt: string; // ISO 8601 timestamp
  providerCommitSha: string;
  resourceCount: number;
  serviceCount: number;
}

export interface ClassicApiResourceMapping {
  terraformType: string; // e.g., "aws_s3_bucket"
  sdkService: string; // e.g., "S3" — matches API operations data service name
  requiredApis: string[]; // e.g., ["CreateBucket", "PutBucketPolicy"]
  registryPath: string; // e.g., "s3_bucket" (for Registry URL)
}

export interface ClassicApiMappingData {
  metadata: ClassicApiMappingMetadata;
  resources: ClassicApiResourceMapping[];
}
