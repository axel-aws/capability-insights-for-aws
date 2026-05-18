import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseAwsccSchemaFilename,
  parseAwsccSchemaContent,
  cfnTypeToAwscc,
} from './awscc-parser';

// --- Generators ---

/**
 * Generator for alphabetic strings (2-20 chars) with first character uppercase.
 * These represent valid service or resource name segments in AWSCC schema filenames.
 * No underscores allowed since underscores are the delimiter in the filename format.
 */
const serviceOrResourceNameArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]$/),
    fc.stringMatching(/^[a-zA-Z]{1,19}$/),
  )
  .map(([first, rest]) => first + rest)
  .filter((s) => s.length >= 2 && s.length <= 20);

// --- Property Tests ---

/**
 * Feature: terraform-overlay, Property 1: AWSCC Filename Round-Trip
 *
 * For any valid AWSCC schema filename (matching the pattern `AWS_{Service}_{Resource}.json`),
 * parsing the filename into a CFN type and then converting that CFN type back to an AWSCC type
 * SHALL produce the same AWSCC type that would be derived directly from the filename.
 *
 * **Validates: Requirements 2.1, 2.2, 2.4**
 */
describe('Feature: terraform-overlay, Property 1: AWSCC Filename Round-Trip', () => {
  it('parse filename → CFN type → back to AWSCC type produces original AWSCC type', () => {
    fc.assert(
      fc.property(
        serviceOrResourceNameArb,
        serviceOrResourceNameArb,
        (service, resource) => {
          // Construct a valid AWSCC schema filename
          const filename = `AWS_${service}_${resource}.json`;

          // Step 1: Parse the filename to get the mapping
          const mapping = parseAwsccSchemaFilename(filename);

          // The parser must produce a valid mapping for any well-formed filename
          expect(mapping).not.toBeNull();

          if (mapping === null) return; // Type narrowing

          // Step 2: Convert the CFN type back to an AWSCC type
          const roundTrippedAwsccType = cfnTypeToAwscc(mapping.cfnType);

          // Step 3: Verify the round-trip produces the original AWSCC type
          expect(roundTrippedAwsccType).toBe(mapping.terraformType);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: terraform-overlay, Property 2: AWSCC Parser Completeness
 *
 * For any list of valid AWSCC schema filenames, the parser SHALL produce exactly one
 * mapping entry per filename, and the total count of output mappings SHALL equal the
 * count of input filenames.
 *
 * **Validates: Requirements 2.3**
 */
describe('Feature: terraform-overlay, Property 2: AWSCC Parser Completeness', () => {
  it('parser produces exactly one mapping per valid filename and output count equals input count', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(serviceOrResourceNameArb, serviceOrResourceNameArb),
          { minLength: 1, maxLength: 50 },
        ),
        (pairs) => {
          // Construct valid AWSCC schema filenames from each (service, resource) pair
          const filenames = pairs.map(
            ([service, resource]) => `AWS_${service}_${resource}.json`,
          );

          // Parse each filename
          const mappings = filenames.map((filename) =>
            parseAwsccSchemaFilename(filename),
          );

          // Every parse must produce a non-null mapping (one mapping per filename)
          for (let i = 0; i < mappings.length; i++) {
            expect(mappings[i]).not.toBeNull();
          }

          // Total count of output mappings equals the count of input filenames
          const nonNullMappings = mappings.filter((m) => m !== null);
          expect(nonNullMappings.length).toBe(filenames.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// --- Generators for Content Parser ---

/**
 * Generator for alphanumeric strings (2-20 chars) with first character uppercase.
 * These represent valid service or resource name segments in CFN type names.
 */
const alphanumericSegmentArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]$/),
    fc.stringMatching(/^[A-Za-z0-9]{1,19}$/),
  )
  .map(([first, rest]) => first + rest)
  .filter((s) => s.length >= 2 && s.length <= 20);

// --- Property Tests for Content Parser ---

/**
 * Feature: terraform-classic-api-availability, Property 7 (partial): AWSCC Content Parser
 *
 * For any valid CFN type name (matching the pattern `AWS::{Service}::{Resource}`),
 * embedding it in a JSON object with a `typeName` field and parsing the JSON content
 * SHALL extract the correct CFN type and derive the correct AWSCC Terraform type.
 *
 * The AWSCC type derivation follows: lowercase the CFN type parts after "AWS::",
 * replace "::" with "_", and prefix with "awscc_".
 *
 * **Validates: Requirements 11.2, 11.6**
 */
describe('Feature: terraform-classic-api-availability, Property 7 (partial): AWSCC Content Parser', () => {
  it('parsing JSON content with typeName extracts correct CFN type and derives correct AWSCC type', () => {
    fc.assert(
      fc.property(
        alphanumericSegmentArb,
        alphanumericSegmentArb,
        (service, resource) => {
          // Construct a valid CFN type name
          const cfnType = `AWS::${service}::${resource}`;

          // Create JSON content with the typeName field
          const jsonContent = JSON.stringify({
            typeName: cfnType,
            description: 'A test schema',
            properties: {},
          });

          // Parse the JSON content
          const result = parseAwsccSchemaContent(jsonContent);

          // The parser must produce a valid mapping for any well-formed JSON with typeName
          expect(result).not.toBeNull();

          if (result === null) return; // Type narrowing

          // Verify the cfnType matches the generated CFN type exactly
          expect(result.cfnType).toBe(cfnType);

          // Verify the terraformType matches the expected AWSCC derivation
          const expectedTerraformType = cfnTypeToAwscc(cfnType);
          expect(result.terraformType).toBe(expectedTerraformType);

          // Verify the AWSCC type follows the expected format: awscc_ + lowercase service_resource
          const expectedAwsccType =
            'awscc_' + service.toLowerCase() + '_' + resource.toLowerCase();
          expect(result.terraformType).toBe(expectedAwsccType);
        },
      ),
      { numRuns: 100 },
    );
  });
});
