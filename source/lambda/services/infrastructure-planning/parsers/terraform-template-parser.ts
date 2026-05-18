/**
 * Terraform Template Parser
 *
 * Parses Terraform HCL files to extract AWS resource type identifiers
 * from `resource` blocks. Ignores `data` blocks and `module` blocks.
 *
 * Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 11.1, 11.2, 11.5, 11.6
 */

/**
 * Regex pattern to match Terraform `resource` blocks.
 * Captures the resource type identifier (first quoted string after `resource` keyword).
 * Pattern: resource "type" "name" { ... }
 */
const RESOURCE_BLOCK_PATTERN = /resource\s+"([^"]+)"\s+"[^"]+"/g;

/**
 * Regex pattern to match Terraform `data` blocks.
 * Used to identify lines that should NOT be matched as resource blocks.
 * Pattern: data "type" "name" { ... }
 */
const DATA_BLOCK_PATTERN = /data\s+"([^"]+)"\s+"[^"]+"/g;

/**
 * Validates that a resource type is an AWS or AWSCC provider type.
 */
function isAwsResourceType(type: string): boolean {
  return type.startsWith('aws_') || type.startsWith('awscc_');
}

/**
 * Parses a Terraform HCL template and extracts unique AWS resource type identifiers.
 *
 * The parser:
 * 1. Uses regex to find all `resource "type" "name"` blocks
 * 2. Filters to only `aws_*` or `awscc_*` prefixed types
 * 3. Ignores `data` blocks (pattern: `data "type" "name"`)
 * 4. Deduplicates and sorts the result
 *
 * @param content - The raw Terraform HCL template content as a string
 * @returns A sorted, deduplicated array of AWS resource type identifiers
 * @throws Error if the content contains no valid AWS resource blocks
 */
export function parseTerraformTemplate(content: string): string[] {
  if (!content || content.trim().length === 0) {
    throw new Error('Failed to parse Terraform template: content is empty');
  }

  // First, collect all data block type+name pairs so we can exclude them
  const dataBlockMatches = new Set<string>();
  let dataMatch: RegExpExecArray | null;
  const dataPattern = new RegExp(DATA_BLOCK_PATTERN.source, 'g');
  while ((dataMatch = dataPattern.exec(content)) !== null) {
    // Store the full match text to identify data blocks
    dataBlockMatches.add(dataMatch[0]);
  }

  // Remove data blocks from content before extracting resource blocks
  // This ensures that `data "aws_ami" "example"` is not confused with resource blocks
  let contentWithoutDataBlocks = content;
  for (const dataBlock of dataBlockMatches) {
    contentWithoutDataBlocks = contentWithoutDataBlocks.replace(dataBlock, '');
  }

  // Extract resource type identifiers from resource blocks
  const resourceTypes = new Set<string>();
  let match: RegExpExecArray | null;
  const resourcePattern = new RegExp(RESOURCE_BLOCK_PATTERN.source, 'g');

  while ((match = resourcePattern.exec(contentWithoutDataBlocks)) !== null) {
    const resourceType = match[1];
    if (isAwsResourceType(resourceType)) {
      resourceTypes.add(resourceType);
    }
  }

  if (resourceTypes.size === 0) {
    throw new Error(
      'No AWS resources found in Terraform template: no resource blocks with aws_* or awscc_* types were detected'
    );
  }

  // Return deduplicated and sorted list
  return Array.from(resourceTypes).sort();
}
