export interface ClassicApiMappingMetadata {
  generatedAt: string; // ISO 8601 timestamp
  providerCommitSha: string;
  resourceCount: number;
  serviceCount: number;
}

/** A single SDK service and its required API operations for a terraform resource. */
export interface ClassicApiServiceEntry {
  sdkService: string; // e.g., "elasticloadbalancingv2"
  requiredApis: string[]; // e.g., ["CreateLoadBalancer", "DescribeLoadBalancers"]
}

export interface ClassicApiResourceMapping {
  terraformType: string; // e.g., "aws_s3_bucket"
  sdkService: string; // e.g., "S3" — primary service (backward compat)
  requiredApis: string[]; // e.g., ["CreateBucket", "PutBucketPolicy"] — primary service APIs (backward compat)
  registryPath: string; // e.g., "s3_bucket" (for Registry URL)
  /** All SDK services and their APIs. When present, provides the full multi-service breakdown. */
  services?: ClassicApiServiceEntry[];
}

export interface ClassicApiMappingData {
  metadata: ClassicApiMappingMetadata;
  resources: ClassicApiResourceMapping[];
}
