import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { serializeOverlayData, deserializeOverlayData } from './mapping-writer';
import type { TerraformOverlayData, AwsccMapping, ClassicAwsMapping, OverlayMetadata } from '../../shared/types/terraform-overlay';

// --- Generators ---

/**
 * Generator for a random hex string of exactly 40 characters (Git SHA format).
 */
const hexSha40Arb = fc.stringMatching(/^[0-9a-f]{40}$/);

/**
 * Generator for a random ISO 8601 timestamp string.
 */
const isoTimestampArb = fc.date({ min: new Date('2000-01-01T00:00:00.000Z'), max: new Date('2099-12-31T23:59:59.999Z') }).map((d) => d.toISOString());

/**
 * Generator for a non-negative integer (resource counts).
 */
const nonNegativeIntArb = fc.nat({ max: 10000 });

/**
 * Generator for random OverlayMetadata objects.
 */
const overlayMetadataArb: fc.Arbitrary<OverlayMetadata> = fc.record({
  generatedAt: isoTimestampArb,
  awsccProviderCommitSha: hexSha40Arb,
  classicAwsProviderCommitSha: hexSha40Arb,
  awsccResourceCount: nonNegativeIntArb,
  classicAwsResourceCount: nonNegativeIntArb,
});

/**
 * Generator for lowercase alpha segments joined by underscores (e.g., "s3_bucket").
 * Used for Terraform type suffixes.
 */
const terraformSuffixArb = fc
  .array(fc.stringMatching(/^[a-z]{2,10}$/), { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join('_'));

/**
 * Generator for PascalCase segments joined by :: (e.g., "S3::Bucket").
 * Used for CFN type suffixes.
 */
const pascalCaseSegmentArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]$/),
    fc.stringMatching(/^[a-zA-Z]{1,9}$/),
  )
  .map(([first, rest]) => first + rest);

const cfnSuffixArb = fc
  .array(pascalCaseSegmentArb, { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join('::'));

/**
 * Generator for random AwsccMapping objects.
 * terraformType: "awscc_" + random lowercase alpha segments
 * cfnType: "AWS::" + random PascalCase segments
 */
const awsccMappingArb: fc.Arbitrary<AwsccMapping> = fc.record({
  terraformType: terraformSuffixArb.map((suffix) => `awscc_${suffix}`),
  cfnType: cfnSuffixArb.map((suffix) => `AWS::${suffix}`),
});

/**
 * Generator for random ClassicAwsMapping objects.
 * terraformType: "aws_" + random lowercase alpha segments
 * cfnType: either a valid CFN type string or null
 */
const classicAwsMappingArb: fc.Arbitrary<ClassicAwsMapping> = fc.record({
  terraformType: terraformSuffixArb.map((suffix) => `aws_${suffix}`),
  cfnType: fc.oneof(
    cfnSuffixArb.map((suffix) => `AWS::${suffix}`),
    fc.constant(null),
  ),
});

/**
 * Generator for random TerraformOverlayData objects.
 */
const terraformOverlayDataArb: fc.Arbitrary<TerraformOverlayData> = fc.record({
  metadata: overlayMetadataArb,
  awscc: fc.array(awsccMappingArb, { minLength: 0, maxLength: 20 }),
  classicAws: fc.array(classicAwsMappingArb, { minLength: 0, maxLength: 20 }),
});

// --- Property Tests ---

/**
 * Feature: terraform-overlay, Property 4: Mapping File Serialization Round-Trip
 *
 * For any valid TerraformOverlayData object, serializing it to JSON and parsing it back
 * SHALL produce a data structure equivalent to the original.
 *
 * **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
 */
describe('Feature: terraform-overlay, Property 4: Mapping File Serialization Round-Trip', () => {
  it('serialize to JSON → parse back → equivalent data structure', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, (originalData) => {
        // Step 1: Serialize the data to JSON
        const json = serializeOverlayData(originalData);

        // Step 2: Deserialize the JSON back to a data structure
        const roundTripped = deserializeOverlayData(json);

        // Step 3: Verify deep equality with the original
        expect(roundTripped).toEqual(originalData);
      }),
      { numRuns: 100 },
    );
  });
});
