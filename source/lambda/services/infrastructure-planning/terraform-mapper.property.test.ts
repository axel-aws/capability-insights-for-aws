import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { TerraformMapper } from './terraform-mapper';
import { TerraformOverlayData } from '../../shared/types/terraform-overlay';

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
 * Generates a valid CFN type string in the format AWS::Service::Resource.
 */
const cfnTypeArb = fc
  .tuple(fc.stringMatching(/^[A-Z][a-z]{1,9}$/), fc.stringMatching(/^[A-Z][a-z]{1,9}$/))
  .map(([service, resource]) => `AWS::${service}::${resource}`);

// --- Shared Helpers ---

function createOverlayData(
  classicAws: { terraformType: string; cfnType: string | null }[] = []
): TerraformOverlayData {
  return {
    metadata: {
      generatedAt: '2025-01-01T00:00:00Z',
      awsccProviderCommitSha: 'abc123',
      classicAwsProviderCommitSha: 'def456',
      awsccResourceCount: 0,
      classicAwsResourceCount: classicAws.length,
    },
    awscc: [],
    classicAws,
  };
}

// --- Property 10 Tests ---

/**
 * Property 10: AWS-to-CloudFormation mapping via overlay
 *
 * For any `aws_*` resource type that exists in the terraform overlay mapping data,
 * the mapper SHALL produce the corresponding CloudFormation type from the overlay.
 * For types not in the overlay, the mapper SHALL retain the original Terraform type
 * without a CFN equivalent.
 *
 * **Validates: Requirements 12.2, 12.3**
 */
describe('Feature: infrastructure-planning, Property 10: AWS-to-CloudFormation mapping via overlay', () => {
  const mapper = new TerraformMapper();

  it('maps aws_* types found in overlay to their corresponding cfnType', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.tuple(awsTerraformTypeArb, cfnTypeArb),
          { minLength: 1, maxLength: 20, selector: ([tf]) => tf }
        ),
        (pairs) => {
          const classicAws = pairs.map(([tf, cfn]) => ({
            terraformType: tf,
            cfnType: cfn,
          }));
          const overlay = createOverlayData(classicAws);
          const terraformTypes = pairs.map(([tf]) => tf);

          const result = mapper.mapToCfn(terraformTypes, overlay);

          // Every type in the overlay with a non-null cfnType should be mapped
          for (const [tf, cfn] of pairs) {
            expect(result.cfnTypes).toContain(cfn);
            expect(result.mapping[tf]).toBe(cfn);
          }

          // cfnTypes length should match the number of mapped entries
          expect(result.cfnTypes).toHaveLength(pairs.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not include aws_* types with null cfnType in overlay in cfnTypes or mapping', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(awsTerraformTypeArb, { minLength: 1, maxLength: 20 }),
        (terraformTypes) => {
          // All entries have null cfnType (unmapped)
          const classicAws = terraformTypes.map((tf) => ({
            terraformType: tf,
            cfnType: null,
          }));
          const overlay = createOverlayData(classicAws);

          const result = mapper.mapToCfn(terraformTypes, overlay);

          // No types should be mapped since all have null cfnType
          expect(result.cfnTypes).toHaveLength(0);
          expect(Object.keys(result.mapping)).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('does not include aws_* types not found in overlay in cfnTypes or mapping', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          // Overlay entries (the known mappings)
          fc.uniqueArray(
            fc.tuple(awsTerraformTypeArb, cfnTypeArb),
            { minLength: 1, maxLength: 10, selector: ([tf]) => tf }
          ),
          // Unknown types that are NOT in the overlay
          fc.uniqueArray(awsTerraformTypeArb, { minLength: 1, maxLength: 10 })
        ),
        ([overlayPairs, unknownTypes]) => {
          const classicAws = overlayPairs.map(([tf, cfn]) => ({
            terraformType: tf,
            cfnType: cfn,
          }));
          const overlay = createOverlayData(classicAws);
          const overlayTypeSet = new Set(overlayPairs.map(([tf]) => tf));

          // Filter unknown types to ensure they're truly not in the overlay
          const trulyUnknown = unknownTypes.filter((t) => !overlayTypeSet.has(t));
          if (trulyUnknown.length === 0) return; // Skip if all generated types happen to be in overlay

          const result = mapper.mapToCfn(trulyUnknown, overlay);

          // None of the unknown types should appear in cfnTypes or mapping
          expect(result.cfnTypes).toHaveLength(0);
          expect(Object.keys(result.mapping)).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('correctly separates mapped and unmapped aws_* types in mixed input', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          // Mapped entries (non-null cfnType) - unique terraform types
          fc.uniqueArray(
            fc.tuple(awsTerraformTypeArb, cfnTypeArb),
            { minLength: 1, maxLength: 10, selector: ([tf]) => tf }
          ),
          // Unmapped entries (null cfnType) - unique terraform types
          fc.uniqueArray(awsTerraformTypeArb, { minLength: 1, maxLength: 10 })
        ),
        ([mappedPairs, unmappedTypes]) => {
          const mappedSet = new Set(mappedPairs.map(([tf]) => tf));
          // Ensure unmapped types don't overlap with mapped types
          const trulyUnmapped = unmappedTypes.filter((t) => !mappedSet.has(t));

          const classicAws = [
            ...mappedPairs.map(([tf, cfn]) => ({ terraformType: tf, cfnType: cfn })),
            ...trulyUnmapped.map((tf) => ({ terraformType: tf, cfnType: null })),
          ];
          const overlay = createOverlayData(classicAws);

          const allTypes = [...mappedPairs.map(([tf]) => tf), ...trulyUnmapped];
          const result = mapper.mapToCfn(allTypes, overlay);

          // Only entries with non-null cfnType should be in cfnTypes and mapping
          expect(result.cfnTypes).toHaveLength(mappedPairs.length);
          for (const [tf, cfn] of mappedPairs) {
            expect(result.cfnTypes).toContain(cfn);
            expect(result.mapping[tf]).toBe(cfn);
          }

          // Unmapped types should NOT appear in mapping
          for (const tf of trulyUnmapped) {
            expect(result.mapping[tf]).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 11 Tests ---

/**
 * Property 11: Mapping preserves both original and mapped types
 *
 * For any Terraform resource type that is successfully mapped to a CloudFormation equivalent,
 * the resulting Capability_Set SHALL contain both the original Terraform type
 * (in `terraformResourceTypes`) and the mapped CloudFormation type (in `cfnResourceTypes`).
 *
 * Since the TerraformMapper returns `{ cfnTypes, mapping }`, we verify:
 * - Every key in `mapping` is present in the input `terraformTypes` array
 * - Every value in `mapping` is present in the `cfnTypes` array
 *
 * **Validates: Requirements 12.4**
 */
describe('Feature: infrastructure-planning, Property 11: Mapping preserves both original and mapped types', () => {
  const mapper = new TerraformMapper();

  it('every successfully mapped awscc_* type has its original in the input and its CFN equivalent in cfnTypes', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(awsccTerraformTypeArb, { minLength: 1, maxLength: 15 }),
        (terraformTypes) => {
          const overlay = createOverlayData();
          const result = mapper.mapToCfn(terraformTypes, overlay);

          // Every key in mapping must be in the original input array
          for (const tfType of Object.keys(result.mapping)) {
            expect(terraformTypes).toContain(tfType);
          }

          // Every value in mapping must be in cfnTypes
          for (const cfnType of Object.values(result.mapping)) {
            expect(result.cfnTypes).toContain(cfnType);
          }

          // All awscc_* types should be mapped (they always convert via naming convention)
          for (const tfType of terraformTypes) {
            expect(result.mapping).toHaveProperty(tfType);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('every successfully mapped aws_* type (via overlay) has its original in the input and its CFN equivalent in cfnTypes', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.tuple(awsTerraformTypeArb, cfnTypeArb),
          { minLength: 1, maxLength: 15, selector: ([tf]) => tf }
        ),
        (pairs) => {
          // Build overlay with all generated pairs having valid CFN mappings
          const classicAws = pairs.map(([tf, cfn]) => ({
            terraformType: tf,
            cfnType: cfn,
          }));
          const overlay = createOverlayData(classicAws);

          const terraformTypes = pairs.map(([tf]) => tf);
          const result = mapper.mapToCfn(terraformTypes, overlay);

          // Every key in mapping must be in the original input array
          for (const tfType of Object.keys(result.mapping)) {
            expect(terraformTypes).toContain(tfType);
          }

          // Every value in mapping must be in cfnTypes
          for (const cfnType of Object.values(result.mapping)) {
            expect(result.cfnTypes).toContain(cfnType);
          }

          // All aws_* types with valid overlay entries should be mapped
          for (const tfType of terraformTypes) {
            expect(result.mapping).toHaveProperty(tfType);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('mixed awscc_* and aws_* types: all mapped types preserve both original and CFN type', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.uniqueArray(awsccTerraformTypeArb, { minLength: 1, maxLength: 8 }),
          fc.uniqueArray(
            fc.tuple(awsTerraformTypeArb, cfnTypeArb),
            { minLength: 1, maxLength: 8, selector: ([tf]) => tf }
          )
        ),
        ([awsccTypes, awsPairs]) => {
          const classicAws = awsPairs.map(([tf, cfn]) => ({
            terraformType: tf,
            cfnType: cfn,
          }));
          const overlay = createOverlayData(classicAws);

          const terraformTypes = [...awsccTypes, ...awsPairs.map(([tf]) => tf)];
          const result = mapper.mapToCfn(terraformTypes, overlay);

          // Every key in mapping must be in the original input array
          for (const tfType of Object.keys(result.mapping)) {
            expect(terraformTypes).toContain(tfType);
          }

          // Every value in mapping must be in cfnTypes
          for (const cfnType of Object.values(result.mapping)) {
            expect(result.cfnTypes).toContain(cfnType);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('unmapped aws_* types (null cfnType in overlay) do NOT appear in mapping or cfnTypes', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(awsTerraformTypeArb, { minLength: 1, maxLength: 10 }),
        (terraformTypes) => {
          // Create overlay where all types have null cfnType (unmapped)
          const classicAws = terraformTypes.map((tf) => ({
            terraformType: tf,
            cfnType: null,
          }));
          const overlay = createOverlayData(classicAws);

          const result = mapper.mapToCfn(terraformTypes, overlay);

          // No types should be mapped
          expect(Object.keys(result.mapping)).toHaveLength(0);
          expect(result.cfnTypes).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('aws_* types not in overlay do NOT appear in mapping or cfnTypes', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(awsTerraformTypeArb, { minLength: 1, maxLength: 10 }),
        (terraformTypes) => {
          // Empty overlay — no types are mapped
          const overlay = createOverlayData([]);

          const result = mapper.mapToCfn(terraformTypes, overlay);

          // No types should be mapped since overlay is empty
          expect(Object.keys(result.mapping)).toHaveLength(0);
          expect(result.cfnTypes).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cfnTypes length equals the number of entries in mapping', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.uniqueArray(awsccTerraformTypeArb, { minLength: 0, maxLength: 8 }),
          fc.uniqueArray(
            fc.tuple(awsTerraformTypeArb, cfnTypeArb),
            { minLength: 0, maxLength: 8, selector: ([tf]) => tf }
          ),
          fc.uniqueArray(awsTerraformTypeArb, { minLength: 0, maxLength: 5 })
        ),
        ([awsccTypes, mappedAwsPairs, unmappedAwsTypes]) => {
          const classicAws = [
            ...mappedAwsPairs.map(([tf, cfn]) => ({
              terraformType: tf,
              cfnType: cfn,
            })),
            ...unmappedAwsTypes.map((tf) => ({
              terraformType: tf,
              cfnType: null,
            })),
          ];
          const overlay = createOverlayData(classicAws);

          const terraformTypes = [
            ...awsccTypes,
            ...mappedAwsPairs.map(([tf]) => tf),
            ...unmappedAwsTypes,
          ];
          const result = mapper.mapToCfn(terraformTypes, overlay);

          // cfnTypes should have exactly as many entries as mapping
          expect(result.cfnTypes.length).toBe(Object.keys(result.mapping).length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
