/**
 * TypeScript/JavaScript AWS SDK parser.
 *
 * Parses TypeScript and JavaScript source files to extract AWS SDK API
 * operation names. Supports both AWS SDK for JavaScript v3 (Command pattern)
 * and v2-style client method calls.
 *
 * Example v3 patterns matched:
 *
 *   new PutObjectCommand(params)
 *   client.send(new GetItemCommand({ TableName: 'my-table' }))
 *   new ListBucketsCommand({})
 *
 * Example v2-style patterns matched:
 *
 *   s3Client.putObject(params)
 *   dynamodb.getItem(params)
 *   lambdaClient.invoke(params)
 *
 * The parser strips the `Command` suffix from v3 names, converts v2
 * camelCase names to PascalCase, deduplicates operation names, and filters
 * out non-API patterns like import statements and type annotations.
 */

/**
 * Regex to match AWS SDK v3 Command pattern instantiations.
 *
 * Matches patterns like:
 *   new PutObjectCommand(
 *   new GetItemCommand(
 *   new ListBucketsCommand(
 *
 * Captures the operation name before "Command" (group 1).
 * Requires at least one uppercase letter followed by one or more letters.
 */
const V3_COMMAND_REGEX = /new\s+([A-Z][a-zA-Z]+)Command\s*\(/g;

/**
 * Regex to match v2-style SDK client method calls on known service prefixes.
 *
 * Matches patterns like:
 *   s3Client.putObject(
 *   dynamodb.getItem(
 *   lambdaClient.invoke(
 *   sqs.sendMessage(
 *
 * The variable name must be a known AWS service prefix optionally followed
 * by "Client" or "client". Captures the method name (group 1).
 */
const V2_CLIENT_METHOD_REGEX =
  /(?:s3|dynamodb|dynamoDb|lambda|sqs|sns|ec2|iam|sts|cloudwatch|cloudformation|kinesis|stepfunctions)(?:Client|client)?\.(\w+)\(/g;

/**
 * Regex to detect import/require lines that should be skipped.
 */
const IMPORT_REQUIRE_REGEX = /^\s*(?:import\s|.*require\s*\()/;

/**
 * Regex to detect type annotation lines that should be skipped.
 * Matches lines containing `: typeof` or `as` type casts referencing Command classes.
 */
const TYPE_ANNOTATION_REGEX = /:\s*typeof\s|as\s+\w+Command/;

/**
 * Strips the `Command` suffix from a v3 operation name if present.
 *
 * Example:
 *   PutObjectCommand → PutObject
 *   GetItem → GetItem (no suffix, unchanged)
 */
function stripCommandSuffix(name: string): string {
  if (name.endsWith('Command')) {
    return name.slice(0, -7);
  }
  return name;
}

/**
 * Converts a camelCase method name to PascalCase by uppercasing the first letter.
 *
 * Example:
 *   putObject → PutObject
 *   getItem → GetItem
 *   listBuckets → ListBuckets
 */
function camelToPascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Determines whether a line should be skipped for extraction purposes.
 *
 * Lines containing import/require statements or type annotations are
 * not actual SDK calls and should be excluded.
 */
function shouldSkipLine(line: string): boolean {
  return IMPORT_REQUIRE_REGEX.test(line) || TYPE_ANNOTATION_REGEX.test(line);
}

/**
 * Parse a TypeScript/JavaScript file to extract AWS SDK API operation names.
 *
 * Looks for:
 * 1. AWS SDK v3 Command pattern: `new {OperationName}Command(`
 * 2. v2-style client method calls: `{servicePrefix}.{methodName}(`
 *
 * Returns a sorted array of unique PascalCase API operation names found.
 * Filters out bare `Command` without prefix, import/require lines,
 * type annotations, and method names shorter than 3 characters.
 *
 * Returns an empty array if the content is empty or has no matching patterns.
 */
export function parseTypeScriptFile(content: string): string[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const operations = new Set<string>();
  const lines = content.split('\n');

  for (const line of lines) {
    // Skip import/require lines and type annotations
    if (shouldSkipLine(line)) {
      continue;
    }

    // Match v3 Command pattern
    V3_COMMAND_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = V3_COMMAND_REGEX.exec(line)) !== null) {
      const operationName = match[1];

      // The regex already ensures at least 2 characters ([A-Z][a-zA-Z]+),
      // so minimum length is satisfied. Strip Command suffix if somehow present.
      const normalized = stripCommandSuffix(operationName);

      // Filter out names shorter than 3 characters after processing
      if (normalized.length < 3) {
        continue;
      }

      operations.add(normalized);
    }

    // Match v2-style client method calls
    V2_CLIENT_METHOD_REGEX.lastIndex = 0;
    while ((match = V2_CLIENT_METHOD_REGEX.exec(line)) !== null) {
      const methodName = match[1];

      // Filter out methods shorter than 3 characters
      if (methodName.length < 3) {
        continue;
      }

      // Convert camelCase to PascalCase
      const normalized = camelToPascal(methodName);

      operations.add(normalized);
    }
  }

  return Array.from(operations).sort();
}
