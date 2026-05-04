import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseResourceType,
  deduplicateResourceTypePairs,
  buildPropertyMapping,
  isIntrinsicFunction,
  extractPropertyValues,
} from './cfn-resource-parser';
import type { PropertyMapping } from './cfn-resource-parser';
import type { ResourceTypePair } from '@capability-insights/shared/types/capability/stack';
import type {
  CfnResource,
  CfnResourceProperty,
  CfnResourceType,
  CfnResourceConfiguration,
} from '@capability-insights/shared/types/capability/cfn';

/**
 * Feature: stack-resource-filter, Property 2: Resource type parsing round-trip
 * Validates: Requirements 2.1
 */
describe('Feature: stack-resource-filter, Property 2: Resource type parsing round-trip', () => {
  // Arbitrary for non-empty alphanumeric strings (serviceName and resourceTypeName)
  const alphanumericNonEmpty = fc.stringMatching(/^[a-zA-Z0-9]+$/, { minLength: 1, maxLength: 50 });

  it('parsing a valid AWS resource type string produces the correct serviceName and resourceTypeName, and round-trips back to the original string', () => {
    fc.assert(
      fc.property(alphanumericNonEmpty, alphanumericNonEmpty, (serviceName, resourceTypeName) => {
        const fullType = `AWS::${serviceName}::${resourceTypeName}`;

        const result = parseResourceType(fullType);

        // Parsing should succeed (not return null)
        expect(result).not.toBeNull();

        // Should produce the correct serviceName and resourceTypeName
        expect(result!.serviceName).toBe(serviceName);
        expect(result!.resourceTypeName).toBe(resourceTypeName);

        // Round-trip: reconstructing the string should equal the original
        const roundTripped = `AWS::${result!.serviceName}::${result!.resourceTypeName}`;
        expect(roundTripped).toBe(fullType);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: stack-resource-filter, Property 3: Resource type pair deduplication
 * Validates: Requirements 2.1
 */
describe('Feature: stack-resource-filter, Property 3: Resource type pair deduplication', () => {
  // Arbitrary for non-empty alphanumeric strings
  const alphanumericNonEmpty = fc.stringMatching(/^[a-zA-Z0-9]+$/, { minLength: 1, maxLength: 30 });

  // Arbitrary for a single ResourceTypePair
  const resourceTypePairArb: fc.Arbitrary<ResourceTypePair> = fc.record({
    serviceName: alphanumericNonEmpty,
    resourceTypeName: alphanumericNonEmpty,
  });

  // Arbitrary for an array of ResourceTypePair with controlled duplicates:
  // Generate a base array, then duplicate some elements to ensure duplicates exist
  const pairsWithDuplicatesArb: fc.Arbitrary<ResourceTypePair[]> = fc
    .array(resourceTypePairArb, { minLength: 1, maxLength: 30 })
    .chain(basePairs =>
      fc.array(fc.nat({ max: basePairs.length - 1 }), { minLength: 0, maxLength: 20 }).map(indices => {
        const duplicates = indices.map(i => ({ ...basePairs[i] }));
        return [...basePairs, ...duplicates];
      }),
    );

  it('no two output elements share the same serviceName and resourceTypeName', () => {
    fc.assert(
      fc.property(pairsWithDuplicatesArb, pairs => {
        const result = deduplicateResourceTypePairs(pairs);

        // Build a set of keys from the output and verify no duplicates
        const keys = result.map(p => `${p.serviceName}::${p.resourceTypeName}`);
        const uniqueKeys = new Set(keys);
        expect(uniqueKeys.size).toBe(keys.length);
      }),
      { numRuns: 100 },
    );
  });

  it('every unique pair from input appears exactly once in output', () => {
    fc.assert(
      fc.property(pairsWithDuplicatesArb, pairs => {
        const result = deduplicateResourceTypePairs(pairs);

        // Compute the set of unique keys from the input
        const inputUniqueKeys = new Set(pairs.map(p => `${p.serviceName}::${p.resourceTypeName}`));

        // Compute the set of keys from the output
        const outputKeys = result.map(p => `${p.serviceName}::${p.resourceTypeName}`);
        const outputUniqueKeys = new Set(outputKeys);

        // Every unique input pair must appear in the output
        for (const key of inputUniqueKeys) {
          expect(outputUniqueKeys.has(key)).toBe(true);
        }

        // The output should have exactly as many elements as unique input pairs
        expect(result.length).toBe(inputUniqueKeys.size);

        // Each output key appears exactly once (no duplicates in output)
        expect(outputKeys.length).toBe(outputUniqueKeys.size);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: stack-resource-filter, Property 4: Dynamic property mapping correctness
 * Validates: Requirements 2.3
 */
describe('Feature: stack-resource-filter, Property 4: Dynamic property mapping correctness', () => {
  // Arbitrary for non-empty alphanumeric strings
  const alphanumericNonEmpty = fc.stringMatching(/^[a-zA-Z0-9]+$/, { minLength: 1, maxLength: 20 });

  // Arbitrary for a CfnResourceConfiguration (non-empty means it has at least a name and regional availability)
  const cfnResourceConfigurationArb: fc.Arbitrary<CfnResourceConfiguration> = fc.record({
    resourceConfigurationName: alphanumericNonEmpty,
    regionalAvailability: fc.constant({}),
  });

  // Arbitrary for a CfnResourceProperty with either empty or non-empty resourceConfigurations
  const cfnResourcePropertyArb: fc.Arbitrary<CfnResourceProperty> = fc.record({
    resourcePropertyName: alphanumericNonEmpty,
    resourceConfigurations: fc.array(cfnResourceConfigurationArb, { minLength: 0, maxLength: 3 }),
  });

  // Arbitrary for a CfnResourceType with optional resourceProperties
  const cfnResourceTypeArb: fc.Arbitrary<CfnResourceType> = fc.record({
    resourceTypeName: alphanumericNonEmpty,
    resourceTypeHomepage: fc.constant('https://example.com'),
    regionalAvailability: fc.constant({}),
    resourceProperties: fc.array(cfnResourcePropertyArb, { minLength: 0, maxLength: 5 }),
  });

  // Arbitrary for a CfnResource
  const cfnResourceArb: fc.Arbitrary<CfnResource> = fc.record({
    serviceName: alphanumericNonEmpty,
    resourceTypes: fc.array(cfnResourceTypeArb, { minLength: 1, maxLength: 4 }),
  });

  // Arbitrary for an array of CfnResource
  const cfnResourcesArb: fc.Arbitrary<CfnResource[]> = fc.array(cfnResourceArb, {
    minLength: 0,
    maxLength: 5,
  });

  it('mapping contains an entry for a resource type iff it has at least one property with non-empty resourceConfigurations', () => {
    fc.assert(
      fc.property(cfnResourcesArb, cfnResources => {
        const mapping = buildPropertyMapping(cfnResources);

        // Compute expected keys: resource types that have at least one property with non-empty resourceConfigurations
        const expectedKeys = new Set<string>();
        for (const resource of cfnResources) {
          for (const resourceType of resource.resourceTypes) {
            const key = `${resource.serviceName}::${resourceType.resourceTypeName}`;
            const hasConfiguredProperty = (resourceType.resourceProperties ?? []).some(
              prop => prop.resourceConfigurations.length > 0,
            );
            if (hasConfiguredProperty) {
              expectedKeys.add(key);
            }
          }
        }

        const mappingKeys = new Set(Object.keys(mapping));

        // Every expected key must be in the mapping
        for (const key of expectedKeys) {
          expect(mappingKeys.has(key)).toBe(true);
        }

        // Every mapping key must be an expected key (no extra entries)
        for (const key of mappingKeys) {
          expect(expectedKeys.has(key)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('mapped property names exactly match the resourcePropertyName values of properties with non-empty resourceConfigurations', () => {
    fc.assert(
      fc.property(cfnResourcesArb, cfnResources => {
        const mapping = buildPropertyMapping(cfnResources);

        // For each resource type, compute the expected property names
        for (const resource of cfnResources) {
          for (const resourceType of resource.resourceTypes) {
            const key = `${resource.serviceName}::${resourceType.resourceTypeName}`;
            const expectedPropertyNames = (resourceType.resourceProperties ?? [])
              .filter(prop => prop.resourceConfigurations.length > 0)
              .map(prop => prop.resourcePropertyName);

            if (expectedPropertyNames.length === 0) {
              // No entry should exist for this key (unless another CfnResource with the same
              // serviceName and resourceTypeName contributed properties)
              // We need to check across all resources, not just this one
              continue;
            }

            // If this key exists in the mapping, verify the property names are present
            if (mapping[key]) {
              for (const propName of expectedPropertyNames) {
                expect(mapping[key]).toContain(propName);
              }
            }
          }
        }

        // Also verify from the mapping side: every mapped property name must come from
        // a property with non-empty resourceConfigurations
        const allExpectedByKey = new Map<string, string[]>();
        for (const resource of cfnResources) {
          for (const resourceType of resource.resourceTypes) {
            const key = `${resource.serviceName}::${resourceType.resourceTypeName}`;
            const propNames = (resourceType.resourceProperties ?? [])
              .filter(prop => prop.resourceConfigurations.length > 0)
              .map(prop => prop.resourcePropertyName);
            if (!allExpectedByKey.has(key)) {
              allExpectedByKey.set(key, []);
            }
            allExpectedByKey.get(key)!.push(...propNames);
          }
        }

        for (const [key, mappedNames] of Object.entries(mapping)) {
          const expectedNames = allExpectedByKey.get(key) ?? [];
          // The mapped names should exactly match the expected names (same elements, same order)
          expect(mappedNames).toEqual(expectedNames);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: stack-resource-filter, Property 5: Intrinsic function detection
 * Validates: Requirements 2.3
 */
describe('Feature: stack-resource-filter, Property 5: Intrinsic function detection', () => {
  // Arbitrary for CloudFormation intrinsic function keys
  const intrinsicKeyArb = fc.oneof(
    fc.constant('Ref'),
    fc.constant('Fn::Base64'),
    fc.constant('Fn::Cidr'),
    fc.constant('Fn::FindInMap'),
    fc.constant('Fn::GetAtt'),
    fc.constant('Fn::GetAZs'),
    fc.constant('Fn::If'),
    fc.constant('Fn::ImportValue'),
    fc.constant('Fn::Join'),
    fc.constant('Fn::Select'),
    fc.constant('Fn::Split'),
    fc.constant('Fn::Sub'),
    fc.constant('Condition'),
  );

  // Arbitrary for intrinsic function objects (e.g., { Ref: "MyResource" }, { "Fn::If": [...] })
  const intrinsicFunctionArb = intrinsicKeyArb.map(key => ({ [key]: 'SomeValue' }));

  // Arbitrary for plain objects (non-intrinsic, but still objects)
  const plainObjectArb = fc.dictionary(
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]*$/, { minLength: 1, maxLength: 20 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    { minKeys: 1, maxKeys: 5 },
  );

  // Arbitrary for non-object values that should return false
  const nonObjectValueArb = fc.oneof(
    fc.string(),
    fc.integer(),
    fc.double({ noNaN: true }),
    fc.boolean(),
    fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), { minLength: 0, maxLength: 5 }),
    fc.constant(null),
    fc.constant(undefined),
  );

  // Arbitrary for values that ARE non-null, non-array objects (should return true)
  const objectValueArb = fc.oneof(intrinsicFunctionArb, plainObjectArb, fc.constant({}));

  it('returns true iff value is a non-null, non-array object', () => {
    fc.assert(
      fc.property(fc.oneof(objectValueArb, nonObjectValueArb), value => {
        const result = isIntrinsicFunction(value);
        const isNonNullNonArrayObject = typeof value === 'object' && value !== null && !Array.isArray(value);

        expect(result).toBe(isNonNullNonArrayObject);
      }),
      { numRuns: 100 },
    );
  });

  it('plain strings always return false', () => {
    fc.assert(
      fc.property(fc.string(), value => {
        expect(isIntrinsicFunction(value)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('non-null, non-array objects always return true', () => {
    fc.assert(
      fc.property(objectValueArb, value => {
        expect(isIntrinsicFunction(value)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('arrays always return false', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), { minLength: 0, maxLength: 10 }),
        value => {
          expect(isIntrinsicFunction(value)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('numbers and booleans always return false', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.double({ noNaN: true }), fc.boolean()), value => {
        expect(isIntrinsicFunction(value)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('null and undefined always return false', () => {
    expect(isIntrinsicFunction(null)).toBe(false);
    expect(isIntrinsicFunction(undefined)).toBe(false);
  });
});

// ============================================================================
// Unit Tests — specific examples and edge cases
// Validates: Requirements 2.1, 2.3
// ============================================================================

describe('parseResourceType — unit tests', () => {
  it('parses AWS::EC2::Instance correctly', () => {
    const result = parseResourceType('AWS::EC2::Instance');
    expect(result).toEqual({ serviceName: 'EC2', resourceTypeName: 'Instance' });
  });

  it('parses AWS::S3::Bucket correctly', () => {
    const result = parseResourceType('AWS::S3::Bucket');
    expect(result).toEqual({ serviceName: 'S3', resourceTypeName: 'Bucket' });
  });

  it('parses AWS::RDS::DBInstance correctly', () => {
    const result = parseResourceType('AWS::RDS::DBInstance');
    expect(result).toEqual({ serviceName: 'RDS', resourceTypeName: 'DBInstance' });
  });

  it('returns null for a string with only two parts', () => {
    expect(parseResourceType('AWS::EC2')).toBeNull();
  });

  it('returns null for a string with four parts', () => {
    expect(parseResourceType('AWS::EC2::Instance::Extra')).toBeNull();
  });

  it('returns null when prefix is not AWS', () => {
    expect(parseResourceType('GCP::EC2::Instance')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseResourceType('')).toBeNull();
  });

  it('returns null when serviceName is empty', () => {
    expect(parseResourceType('AWS::::Instance')).toBeNull();
  });

  it('returns null when resourceTypeName is empty', () => {
    expect(parseResourceType('AWS::EC2::')).toBeNull();
  });

  it('returns null for a plain string with no delimiters', () => {
    expect(parseResourceType('EC2Instance')).toBeNull();
  });
});

describe('deduplicateResourceTypePairs — unit tests', () => {
  it('removes exact duplicates', () => {
    const pairs: ResourceTypePair[] = [
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
      { serviceName: 'S3', resourceTypeName: 'Bucket' },
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
    ];
    const result = deduplicateResourceTypePairs(pairs);
    expect(result).toEqual([
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
      { serviceName: 'S3', resourceTypeName: 'Bucket' },
    ]);
  });

  it('returns an empty array when given an empty array', () => {
    expect(deduplicateResourceTypePairs([])).toEqual([]);
  });

  it('preserves order of first occurrence', () => {
    const pairs: ResourceTypePair[] = [
      { serviceName: 'S3', resourceTypeName: 'Bucket' },
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
      { serviceName: 'S3', resourceTypeName: 'Bucket' },
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
    ];
    const result = deduplicateResourceTypePairs(pairs);
    expect(result).toEqual([
      { serviceName: 'S3', resourceTypeName: 'Bucket' },
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
    ]);
  });

  it('keeps all items when there are no duplicates', () => {
    const pairs: ResourceTypePair[] = [
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
      { serviceName: 'S3', resourceTypeName: 'Bucket' },
      { serviceName: 'RDS', resourceTypeName: 'DBInstance' },
    ];
    const result = deduplicateResourceTypePairs(pairs);
    expect(result).toEqual(pairs);
  });

  it('treats different resource types under the same service as distinct', () => {
    const pairs: ResourceTypePair[] = [
      { serviceName: 'EC2', resourceTypeName: 'Instance' },
      { serviceName: 'EC2', resourceTypeName: 'SecurityGroup' },
    ];
    const result = deduplicateResourceTypePairs(pairs);
    expect(result).toHaveLength(2);
  });
});

describe('buildPropertyMapping — unit tests', () => {
  it('builds a mapping from a realistic CfnResource with configured properties', () => {
    const cfnResources: CfnResource[] = [
      {
        serviceName: 'EC2',
        resourceTypes: [
          {
            resourceTypeName: 'Instance',
            resourceTypeHomepage: 'https://docs.aws.amazon.com/ec2',
            regionalAvailability: {},
            resourceProperties: [
              {
                resourcePropertyName: 'InstanceType',
                resourceConfigurations: [
                  { resourceConfigurationName: 't3.micro', regionalAvailability: {} },
                  { resourceConfigurationName: 't3.small', regionalAvailability: {} },
                ],
              },
            ],
          },
        ],
      },
    ];
    const mapping = buildPropertyMapping(cfnResources);
    expect(mapping).toEqual({ 'EC2::Instance': ['InstanceType'] });
  });

  it('excludes properties with empty resourceConfigurations', () => {
    const cfnResources: CfnResource[] = [
      {
        serviceName: 'S3',
        resourceTypes: [
          {
            resourceTypeName: 'Bucket',
            resourceTypeHomepage: 'https://docs.aws.amazon.com/s3',
            regionalAvailability: {},
            resourceProperties: [
              {
                resourcePropertyName: 'BucketName',
                resourceConfigurations: [],
              },
            ],
          },
        ],
      },
    ];
    const mapping = buildPropertyMapping(cfnResources);
    expect(mapping).toEqual({});
  });

  it('handles resource types with no resourceProperties', () => {
    const cfnResources: CfnResource[] = [
      {
        serviceName: 'Lambda',
        resourceTypes: [
          {
            resourceTypeName: 'Function',
            resourceTypeHomepage: 'https://docs.aws.amazon.com/lambda',
            regionalAvailability: {},
            resourceProperties: undefined,
          },
        ],
      },
    ];
    const mapping = buildPropertyMapping(cfnResources);
    expect(mapping).toEqual({});
  });

  it('returns an empty mapping for an empty CfnResource array', () => {
    expect(buildPropertyMapping([])).toEqual({});
  });

  it('includes multiple properties for the same resource type', () => {
    const cfnResources: CfnResource[] = [
      {
        serviceName: 'RDS',
        resourceTypes: [
          {
            resourceTypeName: 'DBInstance',
            resourceTypeHomepage: 'https://docs.aws.amazon.com/rds',
            regionalAvailability: {},
            resourceProperties: [
              {
                resourcePropertyName: 'EngineVersion',
                resourceConfigurations: [{ resourceConfigurationName: '8.0', regionalAvailability: {} }],
              },
              {
                resourcePropertyName: 'DBInstanceClass',
                resourceConfigurations: [{ resourceConfigurationName: 'db.t3.micro', regionalAvailability: {} }],
              },
            ],
          },
        ],
      },
    ];
    const mapping = buildPropertyMapping(cfnResources);
    expect(mapping['RDS::DBInstance']).toEqual(['EngineVersion', 'DBInstanceClass']);
  });
});

describe('isIntrinsicFunction — unit tests', () => {
  it('returns true for { Ref: "MyResource" }', () => {
    expect(isIntrinsicFunction({ Ref: 'MyResource' })).toBe(true);
  });

  it('returns true for { "Fn::If": ["Cond", "a", "b"] }', () => {
    expect(isIntrinsicFunction({ 'Fn::If': ['Cond', 'a', 'b'] })).toBe(true);
  });

  it('returns true for { "Fn::Sub": "arn:aws:s3:::${Bucket}" }', () => {
    expect(isIntrinsicFunction({ 'Fn::Sub': 'arn:aws:s3:::${Bucket}' })).toBe(true);
  });

  it('returns true for an empty object', () => {
    expect(isIntrinsicFunction({})).toBe(true);
  });

  it('returns false for a plain string', () => {
    expect(isIntrinsicFunction('t3.micro')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isIntrinsicFunction(42)).toBe(false);
  });

  it('returns false for a boolean', () => {
    expect(isIntrinsicFunction(true)).toBe(false);
  });

  it('returns false for an array', () => {
    expect(isIntrinsicFunction(['a', 'b'])).toBe(false);
  });

  it('returns false for null', () => {
    expect(isIntrinsicFunction(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isIntrinsicFunction(undefined)).toBe(false);
  });
});

describe('extractPropertyValues — unit tests', () => {
  const propertyMapping: PropertyMapping = {
    'EC2::Instance': ['InstanceType'],
    'RDS::DBInstance': ['EngineVersion'],
  };

  it('extracts a plain string property value from a CloudFormation template', () => {
    const template = JSON.stringify({
      Resources: {
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            InstanceType: 't3.micro',
            ImageId: 'ami-12345678',
          },
        },
      },
    });

    const matches = extractPropertyValues(template, propertyMapping);
    expect(matches).toEqual([
      {
        serviceName: 'EC2',
        resourceTypeName: 'Instance',
        propertyName: 'InstanceType',
        value: 't3.micro',
      },
    ]);
  });

  it('skips intrinsic function values like Ref', () => {
    const template = JSON.stringify({
      Resources: {
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            InstanceType: { Ref: 'InstanceTypeParam' },
          },
        },
      },
    });

    const matches = extractPropertyValues(template, propertyMapping);
    expect(matches).toEqual([]);
  });

  it('skips Fn::If intrinsic function values', () => {
    const template = JSON.stringify({
      Resources: {
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            InstanceType: { 'Fn::If': ['IsProd', 'm5.large', 't3.micro'] },
          },
        },
      },
    });

    const matches = extractPropertyValues(template, propertyMapping);
    expect(matches).toEqual([]);
  });

  it('extracts values from multiple resources of different types', () => {
    const template = JSON.stringify({
      Resources: {
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            InstanceType: 't3.micro',
          },
        },
        MyDB: {
          Type: 'AWS::RDS::DBInstance',
          Properties: {
            EngineVersion: '8.0',
          },
        },
      },
    });

    const matches = extractPropertyValues(template, propertyMapping);
    expect(matches).toHaveLength(2);
    expect(matches).toContainEqual({
      serviceName: 'EC2',
      resourceTypeName: 'Instance',
      propertyName: 'InstanceType',
      value: 't3.micro',
    });
    expect(matches).toContainEqual({
      serviceName: 'RDS',
      resourceTypeName: 'DBInstance',
      propertyName: 'EngineVersion',
      value: '8.0',
    });
  });

  it('ignores resources whose type is not in the property mapping', () => {
    const template = JSON.stringify({
      Resources: {
        MyBucket: {
          Type: 'AWS::S3::Bucket',
          Properties: {
            BucketName: 'my-bucket',
          },
        },
      },
    });

    const matches = extractPropertyValues(template, propertyMapping);
    expect(matches).toEqual([]);
  });

  it('returns an empty array for invalid JSON', () => {
    const matches = extractPropertyValues('not valid json', propertyMapping);
    expect(matches).toEqual([]);
  });

  it('returns an empty array when template has no Resources section', () => {
    const template = JSON.stringify({ AWSTemplateFormatVersion: '2010-09-09' });
    const matches = extractPropertyValues(template, propertyMapping);
    expect(matches).toEqual([]);
  });

  it('returns an empty array when resource has no Properties', () => {
    const template = JSON.stringify({
      Resources: {
        MyInstance: {
          Type: 'AWS::EC2::Instance',
        },
      },
    });

    const matches = extractPropertyValues(template, propertyMapping);
    expect(matches).toEqual([]);
  });

  it('returns an empty array for an empty property mapping', () => {
    const template = JSON.stringify({
      Resources: {
        MyInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            InstanceType: 't3.micro',
          },
        },
      },
    });

    const matches = extractPropertyValues(template, {});
    expect(matches).toEqual([]);
  });
});
