/**
 * Java AWS SDK v2 file parser.
 *
 * Parses Java source files to extract AWS SDK for Java v2 client method calls.
 * These method calls represent the API operations that the code invokes.
 *
 * Example Java source patterns matched:
 *
 *   s3Client.putObject(request)
 *   dynamoDbClient.getItem(request)
 *   lambdaClient.invoke(request)
 *   S3Client.putObject(request)
 *   DynamoDbClient.getItem(request)
 *
 * The parser normalizes camelCase method names to PascalCase, deduplicates
 * operation names, and filters out common non-API utility methods.
 */

/**
 * Regex pattern to match AWS SDK for Java v2 client method calls.
 *
 * Matches patterns like:
 *   s3Client.putObject(
 *   dynamoDbClient.getItem(
 *   S3Client.putObject(
 *   DynamoDbClient.getItem(
 *   lambdaClient.invoke(
 *
 * Captures the method name (group 1). The identifier before the dot must
 * end with `Client` (case-sensitive).
 */
const SDK_CLIENT_METHOD_REGEX = /(?:\w*Client)\.(\w+)\(/g;

/**
 * Non-API method names that should be filtered out.
 * These are common Java SDK v2 utility/builder methods, not actual AWS API calls.
 */
const NON_API_METHODS = new Set([
  'create',
  'builder',
  'build',
  'close',
  'serviceClientConfiguration',
  'serviceName',
  'waiter',
]);

/**
 * Converts a camelCase method name to PascalCase by uppercasing the first letter.
 *
 * Examples:
 *   putObject → PutObject
 *   getItem → GetItem
 *   createBucket → CreateBucket
 *   PutObject → PutObject (already PascalCase, unchanged)
 */
function camelToPascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Determines whether a method name should be excluded from results.
 *
 * Filters out:
 * - Known non-API utility methods (create, builder, build, close, etc.)
 * - Methods that are too short to be real API operations (< 3 chars)
 */
function isExcludedMethod(methodName: string): boolean {
  if (NON_API_METHODS.has(methodName)) {
    return true;
  }

  if (methodName.length < 3) {
    return true;
  }

  return false;
}

/**
 * Parse a Java source file to extract AWS SDK for Java v2 client method calls.
 *
 * Looks for patterns like:
 *   s3Client.putObject(...)
 *   dynamoDbClient.getItem(...)
 *   S3Client.createBucket(...)
 *
 * Returns a sorted array of unique PascalCase API operation names found.
 * Non-API methods (create, builder, build, close, etc.) are filtered out.
 * Method names shorter than 3 characters are excluded.
 *
 * Returns an empty array if the content is empty, contains only whitespace,
 * or has no matching patterns.
 */
export function parseJavaFile(content: string): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const operations = new Set<string>();

  let match: RegExpExecArray | null;
  SDK_CLIENT_METHOD_REGEX.lastIndex = 0;
  while ((match = SDK_CLIENT_METHOD_REGEX.exec(content)) !== null) {
    const methodName = match[1];

    // Filter out non-API utility methods and short names
    if (isExcludedMethod(methodName)) {
      continue;
    }

    // Normalize camelCase to PascalCase
    const normalizedName = camelToPascal(methodName);

    operations.add(normalizedName);
  }

  return Array.from(operations).sort();
}
