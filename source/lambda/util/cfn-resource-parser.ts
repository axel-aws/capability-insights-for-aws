import type { CfnResource } from '@capability-insights/shared/types/capability/cfn';
import type { ResourceTypePair, PropertyMatch } from '@capability-insights/shared/types/capability/stack';

export type PropertyMapping = Record<string, string[]>;

/**
 * Splits a CloudFormation resource type string (e.g., "AWS::EC2::Instance")
 * into a ResourceTypePair ({ serviceName: "EC2", resourceTypeName: "Instance" }).
 * Returns null for invalid formats.
 */
export function parseResourceType(fullType: string): ResourceTypePair | null {
  const parts = fullType.split('::');
  if (parts.length !== 3 || parts[0] !== 'AWS' || !parts[1] || !parts[2]) {
    return null;
  }
  return { serviceName: parts[1], resourceTypeName: parts[2] };
}

/**
 * Removes duplicate ResourceTypePair entries by serviceName+resourceTypeName.
 */
export function deduplicateResourceTypePairs(pairs: ResourceTypePair[]): ResourceTypePair[] {
  const seen = new Set<string>();
  const result: ResourceTypePair[] = [];

  for (const pair of pairs) {
    const key = `${pair.serviceName}::${pair.resourceTypeName}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(pair);
    }
  }

  return result;
}

/**
 * Builds a mapping of resource types to property names from CfnResource[] data.
 * Only includes properties that have non-empty resourceConfigurations.
 * The key format is "ServiceName::ResourceTypeName".
 */
export function buildPropertyMapping(cfnResources: CfnResource[]): PropertyMapping {
  const mapping: PropertyMapping = {};

  for (const resource of cfnResources) {
    for (const resourceType of resource.resourceTypes) {
      const key = `${resource.serviceName}::${resourceType.resourceTypeName}`;

      for (const property of resourceType.resourceProperties ?? []) {
        if (property.resourceConfigurations.length > 0) {
          if (!mapping[key]) {
            mapping[key] = [];
          }
          mapping[key].push(property.resourcePropertyName);
        }
      }
    }
  }

  return mapping;
}

/**
 * Returns true if a CloudFormation template value is an intrinsic function
 * (i.e., a non-null object that is not an array).
 * Plain strings, numbers, booleans, arrays, null, and undefined return false.
 */
export function isIntrinsicFunction(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parses a CloudFormation template JSON body and extracts plain string property
 * values that match the property mapping.
 */
export function extractPropertyValues(
  templateBody: string,
  propertyMapping: PropertyMapping,
): PropertyMatch[] {
  const matches: PropertyMatch[] = [];

  let template: Record<string, unknown>;
  try {
    template = JSON.parse(templateBody);
  } catch {
    return matches;
  }

  const resources = template.Resources as Record<string, Record<string, unknown>> | undefined;
  if (!resources || typeof resources !== 'object') {
    return matches;
  }

  for (const [, resourceDef] of Object.entries(resources)) {
    const resourceType = resourceDef.Type as string | undefined;
    if (!resourceType) continue;

    const parsed = parseResourceType(resourceType);
    if (!parsed) continue;

    const mappingKey = `${parsed.serviceName}::${parsed.resourceTypeName}`;
    const propertyNames = propertyMapping[mappingKey];
    if (!propertyNames) continue;

    const properties = resourceDef.Properties as Record<string, unknown> | undefined;
    if (!properties || typeof properties !== 'object') continue;

    for (const propertyName of propertyNames) {
      const value = properties[propertyName];
      if (typeof value === 'string') {
        matches.push({
          serviceName: parsed.serviceName,
          resourceTypeName: parsed.resourceTypeName,
          propertyName,
          value,
        });
      }
    }
  }

  return matches;
}
