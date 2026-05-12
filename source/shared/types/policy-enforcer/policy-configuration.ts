/** Status of a policy configuration lifecycle. */
export type PolicyStatus = 'active' | 'pending' | 'error';

/** Outcome of the last policy refresh execution. */
export type RefreshOutcome = 'success' | 'retained' | 'error';

/** A key-value tag for organizing policy configurations. */
export interface PolicyTag {
  key: string;
  value: string;
}

/** A manually added exception entry that is always included in the allow-list. */
export interface ExceptionEntry {
  action: string;
  reason?: string;
  addedAt: string;
}

/** Full policy configuration stored in DynamoDB and returned by the API. */
export interface PolicyConfiguration {
  policyId: string;
  policyName: string;
  description?: string;
  tags: PolicyTag[];
  regions: string[];
  mode: 'intersection' | 'union';
  policyType: 'IAM' | 'SCP';
  exceptions: ExceptionEntry[];
  refreshIntervalHours: number;
  status: PolicyStatus;
  policyArn?: string;
  additionalPolicyArns?: string[];
  lastRefreshTime?: string;
  lastRefreshOutcome?: RefreshOutcome;
  lastActionCount?: number;
  stackId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Request body for POST /policies. */
export interface CreatePolicyRequest {
  policyName: string;
  description?: string;
  tags?: PolicyTag[];
  regions: string[];
  mode: 'intersection' | 'union';
  policyType: 'IAM' | 'SCP';
  exceptions?: ExceptionEntry[];
  refreshIntervalHours?: number;
}

/** Query parameters for GET /policies. */
export interface ListPoliciesQuery {
  tagKey?: string;
  tagValue?: string;
  status?: PolicyStatus;
  search?: string;
}

/** Response from GET /policies/:policyId/preview. */
export interface PreviewResponse {
  actions: string[];
  actionCount: number;
  excludedCount: number;
  exceptionCount: number;
  estimatedPolicySize: number;
  splitRequired: boolean;
}
