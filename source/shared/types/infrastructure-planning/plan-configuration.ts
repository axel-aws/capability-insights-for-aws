/** Source type for an Infrastructure Plan. */
export type PlanSourceType = 'cloudformation' | 'terraform' | 'github';

/** Processing status of an Infrastructure Plan. */
export type PlanStatus = 'processing' | 'ready' | 'error';

/** A key-value metadata label for organizing plans. */
export interface PlanLabel {
  key: string;
  value: string;
}

/** Full plan configuration stored in DynamoDB. */
export interface PlanConfiguration {
  planId: string;
  planName: string;
  sourceType: PlanSourceType;
  labels: PlanLabel[];
  status: PlanStatus;
  errorMessage?: string;
  /** S3 key for the capability set JSON file. */
  capabilitySetKey: string;
  /** Summary counts for quick display without loading full capability set. */
  resourceTypeCount: number;
  apiOperationCount: number;
  createdAt: string;
  updatedAt: string;
  /** ISO 8601 timestamp of when the plan was last refreshed (re-analyzed). */
  lastRefreshedAt: string;
  /** GitHub repository URL for GitHub-sourced plans. Used for refresh without re-submitting the URL. */
  repositoryUrl?: string;
}

/** The extracted capability data stored in S3. */
export interface CapabilitySet {
  /** CloudFormation resource types (e.g., "AWS::S3::Bucket"). */
  cfnResourceTypes: string[];
  /** Original Terraform resource types if source was Terraform (e.g., "aws_s3_bucket"). */
  terraformResourceTypes: string[];
  /** API operations extracted from source files across supported languages (Go, Java, Python, TypeScript/JavaScript) (e.g., "s3:PutObject", "dynamodb:GetItem"). */
  apiOperations: string[];
  /** Service names derived from resource types (e.g., "Amazon S3"). */
  serviceNames: string[];
  /** Mapping of terraform type → CFN type for types that have a mapping. */
  terraformToCfnMapping: Record<string, string>;
  /** Indicates whether the analysis was terminated early due to timeout. */
  partialResult?: {
    isPartial: boolean;
    filesProcessed: number;
    totalFilesIdentified: number;
  };
}

/** Request body for POST /plans. */
export interface CreatePlanRequest {
  planName: string;
  sourceType: PlanSourceType;
  labels?: PlanLabel[];
  /** Base64-encoded template content (for cloudformation/terraform source types). */
  templateContent?: string;
  /** GitHub repository URL (for github source type). */
  repositoryUrl?: string;
}

/** Request body for PUT /plans/:planId (metadata update only). */
export interface UpdatePlanRequest {
  planName?: string;
  labels?: PlanLabel[];
}

/** Query parameters for GET /plans. */
export interface ListPlansQuery {
  search?: string;
  sourceType?: PlanSourceType;
  labelKey?: string;
  labelValue?: string;
}

/** Response from GET /plans/names (for filter autocomplete). */
export interface PlanNamesResponse {
  planNames: string[];
}
