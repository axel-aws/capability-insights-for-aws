/**
 * Maps SDK service names to their corresponding IAM service prefixes
 * where the two differ. This is a fallback for when the homepage URL
 * is not available.
 */
export const IAM_SERVICE_PREFIX_OVERRIDES: Record<string, string> = {
  elasticloadbalancingv2: 'elasticloadbalancing',
  monitoring: 'cloudwatch',
  logs: 'logs',
  events: 'events',
};

/**
 * Extracts the IAM service prefix from the AWS CLI documentation homepage URL.
 * The URL format is: https://awscli.amazonaws.com/v2/documentation/api/latest/reference/{prefix}/...
 */
function extractPrefixFromHomepage(homepage: string): string | null {
  const match = homepage.match(/\/reference\/([^/]+)\//);
  return match ? match[1] : null;
}

/**
 * Maps an SDK service name and API action to the IAM action format "prefix:action".
 * Extracts the prefix from the homepage URL (most reliable source), falls back to
 * the override table, then to the raw sdkServiceName lowercased.
 */
export function toIamAction(sdkServiceName: string, apiAction: string, homepage?: string): string {
  let prefix: string;

  if (homepage) {
    const extracted = extractPrefixFromHomepage(homepage);
    if (extracted) {
      prefix = extracted;
      return `${prefix}:${apiAction}`;
    }
  }

  // Fallback: check overrides, then use lowercased service name
  const key = sdkServiceName.toLowerCase();
  prefix = IAM_SERVICE_PREFIX_OVERRIDES[key] ?? key;
  return `${prefix}:${apiAction}`;
}
