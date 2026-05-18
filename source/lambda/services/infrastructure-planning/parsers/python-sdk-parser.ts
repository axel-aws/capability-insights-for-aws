/**
 * Python boto3 SDK file parser.
 *
 * Parses Python source files to extract AWS SDK (boto3) client and resource
 * method calls. These method calls represent the API operations that the
 * Python code invokes against AWS services.
 *
 * Example Python source patterns matched:
 *
 *   s3_client.put_object(Bucket='my-bucket')
 *   client.get_item(TableName='my-table')
 *   conn.describe_instances()
 *   svc.list_functions()
 *   s3_resource.Object('my-bucket', 'key')
 *   resource.Table('my-table')
 *
 * The parser converts snake_case method names to PascalCase, deduplicates
 * operation names, and filters out common non-API methods like `get_paginator`,
 * `get_waiter`, and private methods starting with `_`.
 */

/**
 * Regex pattern to match boto3 client and resource method calls.
 *
 * Matches patterns like:
 *   client.method_name(
 *   s3_client.method_name(
 *   my_client.method_name(
 *   resource.method_name(
 *   s3_resource.method_name(
 *   conn.method_name(
 *   svc.method_name(
 *
 * Captures the method name (group 1).
 */
const BOTO3_METHOD_REGEX = /(?:\w*(?:client|resource)|conn|svc)\.(\w+)\(/g;

/**
 * Non-API method names that should be filtered out.
 * These are common boto3 utility methods, not actual AWS API calls.
 */
const NON_API_METHODS = new Set([
  'get_paginator',
  'get_waiter',
  'can_paginate',
  'generate_presigned_url',
  'generate_presigned_post',
]);

/**
 * Converts a snake_case method name to PascalCase.
 *
 * Splits on underscores, capitalizes the first letter of each segment,
 * and joins them together.
 *
 * Examples:
 *   put_object → PutObject
 *   get_item → GetItem
 *   list_objects_v2 → ListObjectsV2
 *   describe_instances → DescribeInstances
 */
export function snakeToPascal(name: string): string {
  return name
    .split('_')
    .map((segment) => {
      if (segment.length === 0) return '';
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join('');
}

/**
 * Determines whether a method name should be excluded from results.
 *
 * Filters out:
 * - Known non-API methods (get_paginator, get_waiter, etc.)
 * - Methods starting with underscore (private/internal methods)
 * - Methods that are too short after PascalCase conversion (< 3 chars)
 */
function shouldExclude(methodName: string): boolean {
  // Filter known non-API methods
  if (NON_API_METHODS.has(methodName)) {
    return true;
  }

  // Filter private/internal methods starting with underscore
  if (methodName.startsWith('_')) {
    return true;
  }

  // Filter methods that are too short after conversion
  const pascalName = snakeToPascal(methodName);
  if (pascalName.length < 3) {
    return true;
  }

  return false;
}

/**
 * Parse a Python file to extract boto3 client and resource method calls.
 *
 * Looks for patterns like:
 *   s3_client.put_object(...)
 *   client.get_item(...)
 *   conn.describe_instances(...)
 *   svc.list_functions(...)
 *   s3_resource.Object(...)
 *   resource.Table(...)
 *
 * Returns a sorted array of unique PascalCase API operation names found.
 * Non-API methods (get_paginator, get_waiter, etc.) are filtered out.
 * Private methods starting with `_` are filtered out.
 * Methods shorter than 3 characters after conversion are filtered out.
 *
 * Returns an empty array if the content is empty or has no matching patterns.
 */
export function parsePythonFile(content: string): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const operations = new Set<string>();

  let match: RegExpExecArray | null;
  BOTO3_METHOD_REGEX.lastIndex = 0;
  while ((match = BOTO3_METHOD_REGEX.exec(content)) !== null) {
    const rawMethod = match[1];

    // Filter out excluded methods
    if (shouldExclude(rawMethod)) {
      continue;
    }

    // Convert snake_case to PascalCase
    const pascalName = snakeToPascal(rawMethod);

    operations.add(pascalName);
  }

  return Array.from(operations).sort();
}
