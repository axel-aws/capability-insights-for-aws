import * as yaml from 'js-yaml';

/**
 * Parses a CloudFormation template (YAML or JSON) and extracts unique AWS resource types.
 *
 * @param content - The raw CloudFormation template content as a string
 * @returns A deduplicated, sorted array of AWS resource type identifiers (e.g., "AWS::S3::Bucket")
 * @throws Error if the content cannot be parsed as YAML or JSON
 * @throws Error if the parsed template does not contain a "Resources" section
 */
export function parseCfnTemplate(content: string): string[] {
  const template = parseTemplateContent(content);
  validateResourcesSection(template);
  return extractResourceTypes(template.Resources);
}

/**
 * Custom YAML schema that handles CloudFormation intrinsic function tags.
 * CloudFormation uses custom YAML tags like !Ref, !Sub, !GetAtt, etc.
 * We define them as pass-through types so js-yaml doesn't throw on them.
 */
const CFN_YAML_SCHEMA = yaml.DEFAULT_SCHEMA.extend(
  [
    'Ref', 'Sub', 'GetAtt', 'Join', 'Select', 'Split', 'If', 'Equals',
    'And', 'Or', 'Not', 'Condition', 'FindInMap', 'Base64', 'Cidr',
    'GetAZs', 'ImportValue', 'Transform', 'Length', 'ToJsonString',
  ].map(
    (tag) =>
      new yaml.Type(`!${tag}`, {
        kind: 'scalar',
        construct: (data: string) => data,
      })
  )
);

/**
 * Extended schema that also handles sequence and mapping forms of intrinsic functions.
 */
const CFN_YAML_SCHEMA_FULL = CFN_YAML_SCHEMA.extend(
  [
    'Ref', 'Sub', 'GetAtt', 'Join', 'Select', 'Split', 'If', 'Equals',
    'And', 'Or', 'Not', 'Condition', 'FindInMap', 'Base64', 'Cidr',
    'GetAZs', 'ImportValue', 'Transform', 'Length', 'ToJsonString',
  ].flatMap((tag) => [
    new yaml.Type(`!${tag}`, {
      kind: 'sequence',
      construct: (data: unknown[]) => data,
    }),
    new yaml.Type(`!${tag}`, {
      kind: 'mapping',
      construct: (data: Record<string, unknown>) => data,
    }),
  ])
);

/**
 * Attempts to parse the template content as YAML first, then falls back to JSON.
 */
function parseTemplateContent(content: string): Record<string, unknown> {
  let parsed: unknown;

  // Attempt YAML parse first (with CloudFormation intrinsic function support)
  try {
    parsed = yaml.load(content, { schema: CFN_YAML_SCHEMA_FULL });
  } catch {
    // YAML parse failed, attempt JSON parse
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(
        'Failed to parse template: content is not valid YAML or JSON'
      );
    }
  }

  if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      'Failed to parse template: content does not represent a valid CloudFormation template object'
    );
  }

  return parsed as Record<string, unknown>;
}

/**
 * Validates that the parsed template contains a "Resources" section at the top level.
 */
function validateResourcesSection(template: Record<string, unknown>): void {
  if (!('Resources' in template) || template.Resources === null || template.Resources === undefined) {
    throw new Error(
      'Invalid CloudFormation template: missing "Resources" section'
    );
  }

  if (typeof template.Resources !== 'object' || Array.isArray(template.Resources)) {
    throw new Error(
      'Invalid CloudFormation template: "Resources" section must be an object'
    );
  }
}

/**
 * Extracts AWS resource types from the Resources section, deduplicates, and sorts them.
 */
function extractResourceTypes(resources: unknown): string[] {
  const resourceMap = resources as Record<string, unknown>;
  const types = new Set<string>();

  for (const [, resourceDef] of Object.entries(resourceMap)) {
    if (resourceDef === null || resourceDef === undefined || typeof resourceDef !== 'object') {
      continue;
    }

    const resource = resourceDef as Record<string, unknown>;
    const type = resource.Type;

    if (typeof type === 'string' && type.startsWith('AWS::')) {
      types.add(type);
    }
  }

  return [...types].sort();
}
