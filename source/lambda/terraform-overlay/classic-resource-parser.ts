/**
 * Classic AWS resource Go file parser.
 *
 * Parses individual resource Go source files from the Terraform AWS provider
 * to extract AWS SDK client method calls. These method calls represent the
 * API operations that a Terraform resource requires to function.
 *
 * Example Go source patterns matched:
 *
 *   conn.CreateBucket(input)
 *   client.PutObject(ctx, params)
 *   svc.RunInstances(input)
 *   conn.CreateBucketWithContext(ctx, input)
 *
 * The parser strips the `WithContext` suffix (SDK v1 pattern), deduplicates
 * operation names, and filters out common non-API methods like `String()`,
 * `GoString()`, and setter patterns.
 */

/**
 * Regex patterns to match SDK client method calls.
 *
 * Matches patterns like:
 *   conn.MethodName(
 *   client.MethodName(
 *   svc.MethodName(
 *
 * Captures the method name (group 1).
 */
const SDK_CLIENT_METHOD_REGEX = /(?:conn|client|svc)\.(\w+)\(/g;

/**
 * Non-API method names that should be filtered out.
 * These are common Go SDK utility methods, not actual AWS API calls.
 */
const NON_API_METHODS = new Set([
  'String',
  'GoString',
  'Validate',
  'SetContext',
  'WithContext',
]);

/**
 * Determines whether a method name represents a non-API utility method.
 *
 * Filters out:
 * - Known non-API methods (String, GoString, Validate, etc.)
 * - Methods that are too short to be real API operations (< 3 chars)
 *
 * Note: We do NOT filter Set* prefixes because our regex only matches calls on
 * SDK client variables (conn, client, svc). Any Set* method on these objects is
 * a legitimate AWS API operation (e.g., SetQueueAttributes, SetBucketPolicy,
 * SetIdentityPoolRoles), not a struct setter like input.SetBucketName().
 */
function isNonApiMethod(methodName: string): boolean {
  if (NON_API_METHODS.has(methodName)) {
    return true;
  }

  // Filter methods that are too short to be real API operations
  if (methodName.length < 3) {
    return true;
  }

  return false;
}

/**
 * Strips the `WithContext` suffix from SDK v1 method names.
 *
 * In AWS SDK for Go v1, many API methods have a `WithContext` variant
 * that accepts a context parameter. For example:
 *   CreateBucketWithContext → CreateBucket
 *   PutObjectWithContext → PutObject
 *
 * If the method name does not end with `WithContext`, it is returned unchanged.
 */
function stripWithContextSuffix(methodName: string): string {
  const suffix = 'WithContext';
  if (methodName.endsWith(suffix)) {
    return methodName.slice(0, -suffix.length);
  }
  return methodName;
}

/**
 * Parse a resource Go file to extract AWS SDK client method calls.
 *
 * Looks for patterns like:
 *   conn.CreateBucket(...)
 *   client.PutObject(...)
 *   svc.RunInstances(...)
 *   conn.CreateBucketWithContext(ctx, input)
 *
 * Returns a sorted array of unique API operation names found.
 * Non-API methods (String, GoString, etc.) are filtered out.
 * The `WithContext` suffix is stripped from SDK v1 method names.
 *
 * Returns an empty array if the content is empty or has no matching patterns.
 */
export function parseResourceGoFile(content: string): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const operations = new Set<string>();

  let match: RegExpExecArray | null;
  SDK_CLIENT_METHOD_REGEX.lastIndex = 0;
  while ((match = SDK_CLIENT_METHOD_REGEX.exec(content)) !== null) {
    const rawMethod = match[1];

    // Strip WithContext suffix first
    const methodName = stripWithContextSuffix(rawMethod);

    // Filter out non-API methods
    if (isNonApiMethod(methodName)) {
      continue;
    }

    operations.add(methodName);
  }

  return Array.from(operations).sort();
}

/**
 * Extract the AWS SDK service name from a Go file's import statements.
 *
 * Looks for import paths matching:
 *   "github.com/aws/aws-sdk-go-v2/service/{serviceName}"
 *   "github.com/aws/aws-sdk-go/service/{serviceName}"
 *   "github.com/aws/aws-sdk-go-v2/service/{serviceName}/types"
 *
 * Returns the service name segment (e.g., "codedeploy", "s3", "ecs")
 * or null if no SDK import is found.
 *
 * When multiple SDK services are imported, returns the one that matches
 * the service package directory (if known), otherwise the most frequently
 * imported one (longest service name as heuristic for specificity).
 */
const SDK_IMPORT_REGEX = /github\.com\/aws\/aws-sdk-go(?:-v2)?\/service\/([a-z0-9]+)/g;

export function extractSdkServiceName(content: string): string | null {
  if (!content) return null;

  const services = extractAllSdkServiceNames(content);
  if (services.length === 0) return null;
  if (services.length === 1) return services[0];

  // When multiple services are imported, prefer the longest name
  // (more specific service, e.g., "elasticloadbalancingv2" over "ec2")
  // This heuristic works because the primary service for a resource file
  // is typically the most specific one (the one the resource actually manages).
  return services.reduce((a, b) => (a.length >= b.length ? a : b));
}

/**
 * Extract ALL AWS SDK service names from a Go file's import statements.
 *
 * Returns a deduplicated array of all service names found in SDK import paths.
 * Useful for identifying all services a resource file interacts with.
 */
export function extractAllSdkServiceNames(content: string): string[] {
  if (!content) return [];

  const services = new Set<string>();
  const regex = /github\.com\/aws\/aws-sdk-go(?:-v2)?\/service\/([a-z0-9]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    services.add(match[1]);
  }

  return Array.from(services);
}
