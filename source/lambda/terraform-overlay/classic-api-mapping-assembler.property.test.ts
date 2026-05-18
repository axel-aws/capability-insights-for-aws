import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deriveRegistryPath } from './classic-api-mapping-assembler';

// --- Generators ---

/**
 * Generator for valid Terraform AWS resource type names.
 * Format: `aws_` prefix followed by one or more lowercase segments separated by underscores.
 * e.g., "aws_s3_bucket", "aws_ec2_instance", "aws_lambda_function_url"
 */
const awsTerraformTypeArb = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9]{1,12}$/), { minLength: 1, maxLength: 4 })
  .map((segments) => `aws_${segments.join('_')}`);

// --- Property Tests ---

/**
 * Feature: terraform-classic-api-availability, Property 5: Registry URL Derivation
 *
 * For any ClassicApiResourceMapping entry where terraformType starts with `aws_`,
 * the registryPath SHALL equal the terraformType with the `aws_` prefix removed,
 * and the full registry URL SHALL be constructable as
 * `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/{registryPath}`.
 *
 * **Validates: Requirements 6.2**
 */
describe('Feature: terraform-classic-api-availability, Property 5: Registry URL Derivation', () => {
  it('registryPath equals terraformType with aws_ prefix removed', () => {
    fc.assert(
      fc.property(awsTerraformTypeArb, (terraformType) => {
        const registryPath = deriveRegistryPath(terraformType);

        // Verify: registryPath equals terraformType with `aws_` prefix removed
        const expectedPath = terraformType.slice('aws_'.length);
        expect(registryPath).toBe(expectedPath);
      }),
      { numRuns: 100 },
    );
  });

  it('full registry URL is constructable from registryPath', () => {
    fc.assert(
      fc.property(awsTerraformTypeArb, (terraformType) => {
        const registryPath = deriveRegistryPath(terraformType);

        // Verify: the full registry URL can be constructed
        const registryUrl = `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/${registryPath}`;

        // The URL should contain the resource name without the aws_ prefix
        expect(registryUrl).toBe(
          `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/${terraformType.slice('aws_'.length)}`,
        );

        // The URL should be a valid URL structure
        expect(registryUrl).toMatch(/^https:\/\/registry\.terraform\.io\/providers\/hashicorp\/aws\/latest\/docs\/resources\/.+$/);
      }),
      { numRuns: 100 },
    );
  });
});
