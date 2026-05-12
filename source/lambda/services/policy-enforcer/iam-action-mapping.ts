/**
 * Maps SDK service names to their corresponding IAM service prefixes
 * where the two differ. Most services use the same name for both,
 * but some have known mismatches that must be handled explicitly.
 */
export const IAM_SERVICE_PREFIX_OVERRIDES: Record<string, string> = {
  elasticloadbalancingv2: 'elasticloadbalancing',
  monitoring: 'cloudwatch',
  logs: 'logs',
  events: 'events',
  // Additional known mismatches added as discovered
};

/**
 * Maps an SDK service name and API action to the IAM action format "prefix:action".
 * Uses the override table for known mismatches, otherwise passes through the
 * sdkServiceName as the IAM prefix.
 */
export function toIamAction(sdkServiceName: string, apiAction: string): string {
  const prefix = IAM_SERVICE_PREFIX_OVERRIDES[sdkServiceName] ?? sdkServiceName;
  return `${prefix}:${apiAction}`;
}
