import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseTerraformTemplate } from './terraform-template-parser';

// --- Shared Generators ---

/**
 * Generates a valid Terraform resource type identifier with `aws_` prefix.
 * Format: aws_{service}_{resource} where service and resource are lowercase alpha segments.
 */
const awsTerraformTypeArb = fc
  .tuple(fc.stringMatching(/^[a-z]{2,10}$/), fc.stringMatching(/^[a-z]{2,10}$/))
  .map(([service, resource]) => `aws_${service}_${resource}`);

/**
 * Generates a valid Terraform resource type identifier with `awscc_` prefix.
 * Format: awscc_{service}_{resource} where service and resource are lowercase alpha segments.
 */
const awsccTerraformTypeArb = fc
  .tuple(fc.stringMatching(/^[a-z]{2,10}$/), fc.stringMatching(/^[a-z]{2,10}$/))
  .map(([service, resource]) => `awscc_${service}_${resource}`);

/**
 * Generates a valid Terraform resource type identifier (either aws_ or awscc_ prefix).
 */
const terraformResourceTypeArb = fc.oneof(awsTerraformTypeArb, awsccTerraformTypeArb);

/**
 * Generates a valid Terraform resource block name (lowercase alpha with underscores).
 */
const terraformResourceNameArb = fc.stringMatching(/^[a-z][a-z0-9_]{1,15}$/);

/**
 * Generates a non-AWS resource type (e.g., google_*, azurerm_*, null_resource).
 */
const nonAwsResourceTypeArb = fc.oneof(
  fc.stringMatching(/^[a-z]{2,10}$/).map(s => `google_${s}`),
  fc.stringMatching(/^[a-z]{2,10}$/).map(s => `azurerm_${s}`),
  fc.constant('null_resource'),
  fc.constant('random_id')
);

/**
 * Generates a unique set of valid Terraform resource type identifiers (1-15 types).
 */
const terraformResourceTypeSetArb = fc
  .uniqueArray(terraformResourceTypeArb, { minLength: 1, maxLength: 15 })
  .filter(arr => arr.length >= 1);

// --- Shared Helpers ---

/**
 * Constructs a Terraform resource block string.
 */
function resourceBlock(type: string, name: string): string {
  return `resource "${type}" "${name}" {\n  # configuration\n}\n`;
}

/**
 * Constructs a Terraform data block string (should be ignored by parser).
 */
function dataBlock(type: string, name: string): string {
  return `data "${type}" "${name}" {\n  # data source\n}\n`;
}

/**
 * Constructs a Terraform module block string (should be ignored by parser).
 */
function moduleBlock(name: string): string {
  return `module "${name}" {\n  source = "terraform-aws-modules/vpc/aws"\n}\n`;
}

/**
 * Constructs a valid Terraform HCL file from a list of resource type identifiers.
 */
function buildTerraformHcl(resourceTypes: string[]): string {
  return resourceTypes
    .map((type, index) => resourceBlock(type, `res_${index}`))
    .join('\n');
}


// --- Property 3 Tests ---

/**
 * Property 3: Terraform parser extracts all resource block types
 *
 * For any valid Terraform HCL file containing `resource` blocks (with `aws_*` or `awscc_*`
 * type identifiers), the parser SHALL return exactly the set of unique resource type
 * identifiers from `resource` blocks, excluding `data` blocks and `module` blocks.
 *
 * **Validates: Requirements 2.1, 2.2, 11.1, 11.2, 11.5**
 */
describe('Feature: infrastructure-planning, Property 3: Terraform parser extracts all resource block types', () => {
  it('should extract exactly the unique aws_* resource types from generated HCL', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(awsTerraformTypeArb, terraformResourceNameArb), {
          minLength: 1,
          maxLength: 10,
        }),
        resourceBlocks => {
          // Build HCL content from the generated resource blocks
          const hclContent = resourceBlocks
            .map(([type, name], i) => resourceBlock(type, `${name}_${i}`))
            .join('\n');

          // Compute expected unique types (sorted)
          const expectedTypes = [...new Set(resourceBlocks.map(([type]) => type))].sort();

          // Parse and verify
          const result = parseTerraformTemplate(hclContent);
          expect(result).toEqual(expectedTypes);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should extract exactly the unique awscc_* resource types from generated HCL', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(awsccTerraformTypeArb, terraformResourceNameArb), {
          minLength: 1,
          maxLength: 10,
        }),
        resourceBlocks => {
          const hclContent = resourceBlocks
            .map(([type, name], i) => resourceBlock(type, `${name}_${i}`))
            .join('\n');

          const expectedTypes = [...new Set(resourceBlocks.map(([type]) => type))].sort();

          const result = parseTerraformTemplate(hclContent);
          expect(result).toEqual(expectedTypes);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should extract both aws_* and awscc_* types from mixed templates', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(fc.tuple(awsTerraformTypeArb, terraformResourceNameArb), {
            minLength: 1,
            maxLength: 5,
          }),
          fc.array(fc.tuple(awsccTerraformTypeArb, terraformResourceNameArb), {
            minLength: 1,
            maxLength: 5,
          })
        ),
        ([awsBlocks, awsccBlocks]) => {
          const allBlocks = [...awsBlocks, ...awsccBlocks];
          const hclContent = allBlocks
            .map(([type, name], i) => resourceBlock(type, `${name}_${i}`))
            .join('\n');

          const expectedTypes = [...new Set(allBlocks.map(([type]) => type))].sort();

          const result = parseTerraformTemplate(hclContent);
          expect(result).toEqual(expectedTypes);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should exclude data blocks and only return resource block types', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(fc.tuple(awsTerraformTypeArb, terraformResourceNameArb), {
            minLength: 1,
            maxLength: 5,
          }),
          fc.array(fc.tuple(awsTerraformTypeArb, terraformResourceNameArb), {
            minLength: 1,
            maxLength: 5,
          })
        ),
        ([resourceBlocks, dataBlockDefs]) => {
          // Build HCL with both data blocks and resource blocks
          const dataContent = dataBlockDefs
            .map(([type, name], i) => dataBlock(type, `data_${name}_${i}`))
            .join('\n');
          const resourceContent = resourceBlocks
            .map(([type, name], i) => resourceBlock(type, `res_${name}_${i}`))
            .join('\n');
          const hclContent = `${dataContent}\n${resourceContent}`;

          // Only resource block types should be in the result
          const expectedTypes = [...new Set(resourceBlocks.map(([type]) => type))].sort();

          const result = parseTerraformTemplate(hclContent);
          expect(result).toEqual(expectedTypes);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should exclude non-AWS resource types and only return aws_*/awscc_* types', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(fc.tuple(terraformResourceTypeArb, terraformResourceNameArb), {
            minLength: 1,
            maxLength: 5,
          }),
          fc.array(fc.tuple(nonAwsResourceTypeArb, terraformResourceNameArb), {
            minLength: 1,
            maxLength: 5,
          })
        ),
        ([awsBlocks, nonAwsBlocks]) => {
          const allBlocks = [...awsBlocks, ...nonAwsBlocks];
          const hclContent = allBlocks
            .map(([type, name], i) => resourceBlock(type, `${name}_${i}`))
            .join('\n');

          // Only aws_*/awscc_* types should be in the result
          const expectedTypes = [...new Set(awsBlocks.map(([type]) => type))].sort();

          const result = parseTerraformTemplate(hclContent);
          expect(result).toEqual(expectedTypes);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should ignore module blocks and only extract resource block types', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(fc.tuple(terraformResourceTypeArb, terraformResourceNameArb), {
            minLength: 1,
            maxLength: 5,
          }),
          fc.array(terraformResourceNameArb, { minLength: 1, maxLength: 3 })
        ),
        ([resourceBlocks, moduleNames]) => {
          const moduleContent = moduleNames.map((name, i) => moduleBlock(`${name}_${i}`)).join('\n');
          const resourceContent = resourceBlocks
            .map(([type, name], i) => resourceBlock(type, `${name}_${i}`))
            .join('\n');
          const hclContent = `${moduleContent}\n${resourceContent}`;

          const expectedTypes = [...new Set(resourceBlocks.map(([type]) => type))].sort();

          const result = parseTerraformTemplate(hclContent);
          expect(result).toEqual(expectedTypes);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 4 Tests ---

/**
 * Property 4: Terraform parser round-trip
 *
 * For any list of valid Terraform resource type identifiers, constructing an HCL file
 * containing those types as resource blocks, then parsing it, SHALL produce an equivalent
 * (same elements, order-independent) resource type list.
 *
 * **Validates: Requirements 11.4**
 */
describe('Feature: infrastructure-planning, Property 4: Terraform parser round-trip', () => {
  it('constructing HCL from resource types then parsing produces the same set of types', () => {
    fc.assert(
      fc.property(terraformResourceTypeSetArb, resourceTypes => {
        // Construct HCL content from the generated resource types
        const hcl = buildTerraformHcl(resourceTypes);

        // Parse the constructed HCL
        const result = parseTerraformTemplate(hcl);

        // The result should be equivalent to the input set (sorted, deduplicated)
        const expected = [...new Set(resourceTypes)].sort();
        expect(result).toEqual(expected);
      }),
      { numRuns: 150 }
    );
  });

  it('round-trip holds when resource types include duplicates in the input list', () => {
    fc.assert(
      fc.property(
        terraformResourceTypeSetArb,
        fc.integer({ min: 2, max: 4 }),
        (resourceTypes, duplicationFactor) => {
          // Create a list with duplicates by repeating the first type
          const withDuplicates = [
            ...Array(duplicationFactor).fill(resourceTypes[0]),
            ...resourceTypes.slice(1),
          ];

          // Construct HCL with duplicated resource blocks (different names, same type)
          const hcl = withDuplicates
            .map((type, index) => resourceBlock(type, `res_${index}`))
            .join('\n');

          // Parse the constructed HCL
          const result = parseTerraformTemplate(hcl);

          // Result should be the unique set, sorted (deduplication is part of the contract)
          const expected = [...new Set(resourceTypes)].sort();
          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('round-trip holds regardless of resource block name variations', () => {
    fc.assert(
      fc.property(
        terraformResourceTypeSetArb,
        fc.array(terraformResourceNameArb, { minLength: 1, maxLength: 15 }),
        (resourceTypes, blockNames) => {
          // Construct HCL with varied block names
          const hcl = resourceTypes
            .map((type, index) => {
              const name = blockNames[index % blockNames.length];
              return resourceBlock(type, `${name}_${index}`);
            })
            .join('\n');

          const result = parseTerraformTemplate(hcl);

          const expected = [...new Set(resourceTypes)].sort();
          expect(result).toEqual(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('round-trip holds when HCL contains additional whitespace and comments', () => {
    fc.assert(
      fc.property(terraformResourceTypeSetArb, resourceTypes => {
        // Construct HCL with extra whitespace, comments, and blank lines
        const hcl = resourceTypes
          .map((type, index) => {
            return [
              `# Resource block ${index}`,
              `resource   "${type}"   "instance_${index}" {`,
              `  # some configuration here`,
              `  tags = {`,
              `    Name = "test"`,
              `  }`,
              `}`,
              '',
            ].join('\n');
          })
          .join('\n\n');

        const result = parseTerraformTemplate(hcl);

        const expected = [...new Set(resourceTypes)].sort();
        expect(result).toEqual(expected);
      }),
      { numRuns: 100 }
    );
  });
});
