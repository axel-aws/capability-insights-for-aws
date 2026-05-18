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
