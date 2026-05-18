/**
 * Classic AWS service package gen parser.
 *
 * Parses `service_package_gen.go` files from the Terraform AWS provider to
 * extract resource TypeNames and their factory function names. Each service
 * package file lists all resources belonging to that service, along with the
 * factory function used to instantiate the resource — which corresponds to
 * the Go source file where SDK API calls are made.
 *
 * Example Go source block:
 *
 *   {
 *     Factory:  resourceBucket,
 *     TypeName: "aws_s3_bucket",
 *     Name:     "Bucket",
 *   },
 */

export interface ServicePackageResource {
  /** Terraform resource type name, e.g., "aws_s3_bucket" */
  typeName: string;
  /** Factory function name, e.g., "resourceBucket" — used to find the Go file */
  factoryName: string;
}

/**
 * Regex to match resource blocks in service_package_gen.go.
 *
 * Captures the Factory and TypeName fields from blocks like:
 *   {
 *     Factory:  resourceBucket,
 *     TypeName: "aws_s3_bucket",
 *     ...
 *   },
 *
 * The block is delimited by `{` and `},` and may contain other fields
 * (Name, Tags, etc.) that we ignore.
 */
const RESOURCE_BLOCK_REGEX = /\{[^}]*?Factory:\s*(\w+)[^}]*?TypeName:\s*"(aws_[^"]+)"[^}]*?\}/gs;

/**
 * Alternate regex for blocks where TypeName appears before Factory.
 */
const RESOURCE_BLOCK_ALT_REGEX = /\{[^}]*?TypeName:\s*"(aws_[^"]+)"[^}]*?Factory:\s*(\w+)[^}]*?\}/gs;

/**
 * Parse a `service_package_gen.go` file to extract all resource TypeNames
 * and their factory function names.
 *
 * Looks for blocks containing both a `Factory: functionName` field and a
 * `TypeName: "aws_..."` field. The order of these fields within the block
 * may vary.
 *
 * Returns an empty array if the content is empty, has no matching entries,
 * or is malformed.
 */
export function parseServicePackageGen(content: string): ServicePackageResource[] {
  if (!content || content.trim().length === 0) {
    return [];
  }

  const results = new Map<string, ServicePackageResource>();

  // Match blocks where Factory appears before TypeName
  let match: RegExpExecArray | null;
  RESOURCE_BLOCK_REGEX.lastIndex = 0;
  while ((match = RESOURCE_BLOCK_REGEX.exec(content)) !== null) {
    const factoryName = match[1];
    const typeName = match[2];
    if (factoryName && typeName) {
      results.set(typeName, { typeName, factoryName });
    }
  }

  // Match blocks where TypeName appears before Factory
  RESOURCE_BLOCK_ALT_REGEX.lastIndex = 0;
  while ((match = RESOURCE_BLOCK_ALT_REGEX.exec(content)) !== null) {
    const typeName = match[1];
    const factoryName = match[2];
    if (factoryName && typeName && !results.has(typeName)) {
      results.set(typeName, { typeName, factoryName });
    }
  }

  return Array.from(results.values());
}
