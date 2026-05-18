import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseCfnTemplate } from './cfn-template-parser';

/**
 * Property 1: CloudFormation parser extracts all resource types
 *
 * For any valid CloudFormation template (YAML or JSON) containing a Resources section
 * with one or more resource definitions, the parser SHALL return exactly the set of
 * unique AWS::* type values present in that section, regardless of intrinsic functions,
 * conditions, or other template features.
 *
 * **Validates: Requirements 1.1, 1.2, 10.1, 10.2, 10.5**
 */

/**
 * Generates a valid AWS CloudFormation resource type string in the format AWS::Service::Resource.
 * Service and Resource segments are alphabetic, capitalized, and between 2-15 characters.
 */
const awsResourceTypeArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z][a-zA-Z]{1,14}$/),
    fc.stringMatching(/^[A-Z][a-zA-Z]{1,14}$/)
  )
  .map(([service, resource]) => `AWS::${service}::${resource}`);

/**
 * Generates a non-empty set of unique AWS resource types (1-20 types).
 */
const resourceTypeSetArb = fc
  .uniqueArray(awsResourceTypeArb, { minLength: 1, maxLength: 20 })
  .filter((arr) => arr.length >= 1);

/**
 * Builds a JSON CloudFormation template from a list of resource types.
 */
function buildJsonTemplate(resourceTypes: string[]): string {
  const resources: Record<string, { Type: string; Properties?: Record<string, unknown> }> = {};
  resourceTypes.forEach((type, index) => {
    resources[`Resource${index}`] = { Type: type };
  });
  return JSON.stringify({
    AWSTemplateFormatVersion: '2010-09-09',
    Resources: resources,
  });
}

/**
 * Builds a YAML CloudFormation template from a list of resource types.
 */
function buildYamlTemplate(resourceTypes: string[]): string {
  let yaml = 'AWSTemplateFormatVersion: "2010-09-09"\nResources:\n';
  resourceTypes.forEach((type, index) => {
    yaml += `  Resource${index}:\n    Type: ${type}\n`;
  });
  return yaml;
}

describe('Feature: infrastructure-planning, Property 1: extraction completeness', () => {
  it('should extract exactly the set of unique AWS::* resource types from a JSON template', () => {
    fc.assert(
      fc.property(resourceTypeSetArb, (resourceTypes) => {
        const template = buildJsonTemplate(resourceTypes);
        const result = parseCfnTemplate(template);

        // The result should contain exactly the unique types from the input, sorted
        const expected = [...new Set(resourceTypes)].sort();
        expect(result).toEqual(expected);
      }),
      { numRuns: 150 }
    );
  });

  it('should extract exactly the set of unique AWS::* resource types from a YAML template', () => {
    fc.assert(
      fc.property(resourceTypeSetArb, (resourceTypes) => {
        const template = buildYamlTemplate(resourceTypes);
        const result = parseCfnTemplate(template);

        const expected = [...new Set(resourceTypes)].sort();
        expect(result).toEqual(expected);
      }),
      { numRuns: 150 }
    );
  });

  it('should extract all types even when templates contain duplicate resource types', () => {
    fc.assert(
      fc.property(
        resourceTypeSetArb,
        fc.integer({ min: 2, max: 5 }),
        (resourceTypes, duplicationFactor) => {
          // Create a list with duplicates by repeating the first type
          const withDuplicates = [
            ...Array(duplicationFactor).fill(resourceTypes[0]),
            ...resourceTypes.slice(1),
          ];
          const template = buildJsonTemplate(withDuplicates);
          const result = parseCfnTemplate(template);

          // Result should still be the unique set, sorted
          const expected = [...new Set(resourceTypes)].sort();
          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should only extract AWS::* types and ignore non-AWS types mixed in', () => {
    const nonAwsTypeArb = fc.constantFrom(
      'Custom::MyResource',
      'Custom::AnotherCustom',
      'Module::MyModule',
      'Alexa::ASK::Skill'
    );

    fc.assert(
      fc.property(
        resourceTypeSetArb,
        fc.array(nonAwsTypeArb, { minLength: 1, maxLength: 5 }),
        (awsTypes, nonAwsTypes) => {
          const allTypes = [...awsTypes, ...nonAwsTypes];
          const template = buildJsonTemplate(allTypes);
          const result = parseCfnTemplate(template);

          // Result should only contain the AWS::* types
          const expected = [...new Set(awsTypes)].sort();
          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should extract types regardless of additional resource properties', () => {
    fc.assert(
      fc.property(
        resourceTypeSetArb,
        fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue()),
        (resourceTypes, extraProps) => {
          // Build a template where resources have additional properties
          const resources: Record<string, Record<string, unknown>> = {};
          resourceTypes.forEach((type, index) => {
            resources[`Resource${index}`] = { Type: type, Properties: extraProps };
          });
          const template = JSON.stringify({
            AWSTemplateFormatVersion: '2010-09-09',
            Resources: resources,
          });
          const result = parseCfnTemplate(template);

          const expected = [...new Set(resourceTypes)].sort();
          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});


// --- Generators for Property 2 ---

/**
 * Generator for valid AWS service name segments (e.g., "S3", "Lambda", "DynamoDB").
 * Must start with uppercase letter, followed by alphanumeric characters.
 */
const serviceNameArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]$/),
    fc.stringMatching(/^[A-Za-z0-9]{1,14}$/),
  )
  .map(([first, rest]) => first + rest)
  .filter((s) => s.length >= 2 && s.length <= 15);

/**
 * Generator for valid AWS resource name segments (e.g., "Bucket", "Function", "Table").
 * Must start with uppercase letter, followed by alphanumeric characters.
 */
const resourceNameArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]$/),
    fc.stringMatching(/^[A-Za-z0-9]{1,14}$/),
  )
  .map(([first, rest]) => first + rest)
  .filter((s) => s.length >= 2 && s.length <= 15);

/**
 * Generator for valid CloudFormation resource type strings (e.g., "AWS::S3::Bucket").
 */
const cfnResourceTypeArb = fc
  .tuple(serviceNameArb, resourceNameArb)
  .map(([service, resource]) => `AWS::${service}::${resource}`);

// --- Property Tests ---

/**
 * Feature: infrastructure-planning, Property 2: CloudFormation parser round-trip
 *
 * For any list of valid CloudFormation resource types, constructing a template
 * containing those types, then parsing it, SHALL produce an equivalent
 * (same elements, order-independent) resource type list.
 *
 * **Validates: Requirements 10.4**
 */
describe('Feature: infrastructure-planning, Property 2: CloudFormation parser round-trip', () => {
  it('constructing a JSON template from resource types and parsing it produces the same unique set', () => {
    fc.assert(
      fc.property(
        fc.array(cfnResourceTypeArb, { minLength: 1, maxLength: 30 }),
        (resourceTypes) => {
          // Construct a valid CloudFormation JSON template from the resource types
          const resources: Record<string, { Type: string; Properties: object }> = {};
          resourceTypes.forEach((type, index) => {
            resources[`Resource${index}`] = {
              Type: type,
              Properties: {},
            };
          });

          const template = JSON.stringify({
            AWSTemplateFormatVersion: '2010-09-09',
            Resources: resources,
          });

          // Parse the constructed template
          const result = parseCfnTemplate(template);

          // The expected result is the deduplicated, sorted set of input types
          const expectedTypes = [...new Set(resourceTypes)].sort();

          // Verify equivalence (same elements, order-independent via sort)
          expect(result).toEqual(expectedTypes);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('constructing a YAML template from resource types and parsing it produces the same unique set', () => {
    fc.assert(
      fc.property(
        fc.array(cfnResourceTypeArb, { minLength: 1, maxLength: 30 }),
        (resourceTypes) => {
          // Construct a valid CloudFormation YAML template from the resource types
          let yamlContent = 'AWSTemplateFormatVersion: "2010-09-09"\nResources:\n';
          resourceTypes.forEach((type, index) => {
            yamlContent += `  Resource${index}:\n`;
            yamlContent += `    Type: ${type}\n`;
            yamlContent += `    Properties: {}\n`;
          });

          // Parse the constructed template
          const result = parseCfnTemplate(yamlContent);

          // The expected result is the deduplicated, sorted set of input types
          const expectedTypes = [...new Set(resourceTypes)].sort();

          // Verify equivalence (same elements, order-independent via sort)
          expect(result).toEqual(expectedTypes);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('round-trip is idempotent: parsing twice produces the same result', () => {
    fc.assert(
      fc.property(
        fc.array(cfnResourceTypeArb, { minLength: 1, maxLength: 20 }),
        (resourceTypes) => {
          // Construct a template from the resource types
          const resources: Record<string, { Type: string; Properties: object }> = {};
          resourceTypes.forEach((type, index) => {
            resources[`Resource${index}`] = {
              Type: type,
              Properties: {},
            };
          });

          const template = JSON.stringify({
            AWSTemplateFormatVersion: '2010-09-09',
            Resources: resources,
          });

          // Parse once
          const firstParse = parseCfnTemplate(template);

          // Reconstruct a template from the first parse result
          const resources2: Record<string, { Type: string; Properties: object }> = {};
          firstParse.forEach((type, index) => {
            resources2[`Resource${index}`] = {
              Type: type,
              Properties: {},
            };
          });

          const template2 = JSON.stringify({
            AWSTemplateFormatVersion: '2010-09-09',
            Resources: resources2,
          });

          // Parse again
          const secondParse = parseCfnTemplate(template2);

          // Both parses should produce the same result
          expect(secondParse).toEqual(firstParse);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 5: Invalid template rejection
 *
 * For any string that is not valid YAML, JSON, or HCL (as appropriate for the
 * declared source type), the parser SHALL return an error and SHALL NOT produce
 * a resource type list.
 *
 * **Validates: Requirements 1.4, 2.4**
 */
describe('Feature: infrastructure-planning, Property 5: invalid template rejection', () => {
  it('should throw an error for arbitrary strings that are not valid YAML/JSON objects with a Resources section', () => {
    /**
     * Strategy: Generate strings that cannot be valid YAML/JSON objects with a Resources section.
     * We use multiple generators to cover different classes of invalid input:
     * - Random characters from a set that produces broken syntax
     * - Binary-like garbage
     * - Strings with unbalanced delimiters
     * - Random unicode
     */
    const invalidStringArb = fc.oneof(
      // Strings built from characters that produce broken JSON/YAML syntax
      fc.array(
        fc.constantFrom('{', '}', '[', ']', ':', ',', '"', '\\', '\t', '\n', '!', '@', '#'),
        { minLength: 2, maxLength: 50 }
      ).map((chars) => chars.join('')).filter((s) => {
        // Filter out strings that could accidentally be valid YAML/JSON with Resources
        try {
          const parsed = JSON.parse(s);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'Resources' in parsed) {
            return false;
          }
        } catch {
          // JSON parse failed - good candidate
        }
        return s.trim().length > 0;
      }),
      // Binary-like garbage strings
      fc.uint8Array({ minLength: 2, maxLength: 200 }).map((arr) =>
        Array.from(arr)
          .map((b) => String.fromCharCode(b))
          .join('')
      ).filter((s) => {
        try {
          const parsed = JSON.parse(s);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'Resources' in parsed) {
            return false;
          }
        } catch {
          // JSON parse failed - good candidate
        }
        return s.trim().length > 0;
      }),
      // Strings that look like broken templates with unbalanced braces
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 })
      ).map(([a, b]) => `{{${a}::${b}}}}`),
      // Random strings with special characters that break parsing
      fc.string({ minLength: 2, maxLength: 100 }).map((s) => `{{{${s}`)
    );

    fc.assert(
      fc.property(invalidStringArb, (invalidInput) => {
        expect(() => parseCfnTemplate(invalidInput)).toThrow();
      }),
      { numRuns: 100 }
    );
  });

  it('should throw for strings that parse as non-object types (scalars, arrays, null)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // JSON arrays
          fc.array(fc.anything({ maxDepth: 0 }), { minLength: 0, maxLength: 5 }).map((arr) =>
            JSON.stringify(arr)
          ),
          // JSON primitives (numbers, booleans, null)
          fc.oneof(
            fc.integer().map((n) => JSON.stringify(n)),
            fc.boolean().map((b) => JSON.stringify(b)),
            fc.constant('null')
          ),
          // JSON strings (which parse to string type, not object)
          fc.string().map((s) => JSON.stringify(s))
        ),
        (nonObjectJson) => {
          expect(() => parseCfnTemplate(nonObjectJson)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should throw for valid JSON/YAML objects that lack a Resources section', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }).filter((k) => k !== 'Resources'),
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null)
          )
        ).filter((obj) => Object.keys(obj).length > 0),
        (objWithoutResources) => {
          const content = JSON.stringify(objWithoutResources);
          expect(() => parseCfnTemplate(content)).toThrow();
        }
      ),
      { numRuns: 100 }
    );
  });
});
