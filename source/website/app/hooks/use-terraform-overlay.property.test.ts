import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildOverlayIndex, translateRows, searchAllConventions, getResourceCount } from './use-terraform-overlay';
import type { CfnAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import type {
  TerraformOverlayData,
  AwsccMapping,
  ClassicAwsMapping,
  NamingConvention,
  OverlayIndex,
} from '@capability-insights/shared/types/terraform-overlay';

// --- Generators ---

/**
 * Generator for PascalCase service/resource segments (e.g., "S3", "Bucket", "EC2").
 */
const pascalCaseSegmentArb = fc
  .tuple(fc.stringMatching(/^[A-Z]$/), fc.stringMatching(/^[a-z]{1,9}$/))
  .map(([first, rest]) => first + rest);

/**
 * Generator for a valid CFN type string (e.g., "AWS::S3::Bucket").
 */
const cfnTypeArb = fc
  .tuple(pascalCaseSegmentArb, pascalCaseSegmentArb)
  .map(([service, resource]) => `AWS::${service}::${resource}`);

/**
 * Generator for a lowercase terraform suffix (e.g., "s3_bucket").
 */
const terraformSuffixArb = fc
  .array(fc.stringMatching(/^[a-z]{2,8}$/), { minLength: 1, maxLength: 3 })
  .map((segments) => segments.join('_'));

/**
 * Generator for a random AWSCC mapping with consistent CFN ↔ AWSCC relationship.
 */
const awsccMappingArb: fc.Arbitrary<AwsccMapping> = fc.record({
  terraformType: terraformSuffixArb.map((suffix) => `awscc_${suffix}`),
  cfnType: cfnTypeArb,
});

/**
 * Generator for a random classic AWS mapping (with or without cfnType).
 */
const classicAwsMappingWithCfnArb: fc.Arbitrary<ClassicAwsMapping> = fc.record({
  terraformType: terraformSuffixArb.map((suffix) => `aws_${suffix}`),
  cfnType: cfnTypeArb,
});

const classicAwsMappingUnmappedArb: fc.Arbitrary<ClassicAwsMapping> = fc.record({
  terraformType: terraformSuffixArb.map((suffix) => `aws_${suffix}`),
  cfnType: fc.constant(null),
});

const classicAwsMappingArb: fc.Arbitrary<ClassicAwsMapping> = fc.oneof(
  classicAwsMappingWithCfnArb,
  classicAwsMappingUnmappedArb,
);

/**
 * Generator for a random hex SHA (40 chars).
 */
const hexSha40Arb = fc.stringMatching(/^[0-9a-f]{40}$/);

/**
 * Generator for a random ISO timestamp.
 */
const isoTimestampArb = fc
  .date({ min: new Date('2000-01-01'), max: new Date('2099-12-31') })
  .map((d) => d.toISOString());

/**
 * Generator for random TerraformOverlayData with unique CFN types across mappings.
 */
const terraformOverlayDataArb: fc.Arbitrary<TerraformOverlayData> = fc
  .record({
    metadata: fc.record({
      generatedAt: isoTimestampArb,
      awsccProviderCommitSha: hexSha40Arb,
      classicAwsProviderCommitSha: hexSha40Arb,
      awsccResourceCount: fc.nat({ max: 100 }),
      classicAwsResourceCount: fc.nat({ max: 100 }),
    }),
    awscc: fc.array(awsccMappingArb, { minLength: 0, maxLength: 10 }),
    classicAws: fc.array(classicAwsMappingArb, { minLength: 0, maxLength: 10 }),
  })
  .map((data) => {
    // Ensure unique CFN types within awscc mappings
    const seenCfn = new Set<string>();
    const uniqueAwscc: AwsccMapping[] = [];
    for (const m of data.awscc) {
      if (!seenCfn.has(m.cfnType)) {
        seenCfn.add(m.cfnType);
        uniqueAwscc.push(m);
      }
    }
    // Ensure unique terraform types within awscc
    const seenTf = new Set<string>();
    const dedupedAwscc: AwsccMapping[] = [];
    for (const m of uniqueAwscc) {
      if (!seenTf.has(m.terraformType)) {
        seenTf.add(m.terraformType);
        dedupedAwscc.push(m);
      }
    }

    // Ensure unique terraform types within classicAws
    const seenClassicTf = new Set<string>();
    const seenClassicCfn = new Set<string>();
    const uniqueClassic: ClassicAwsMapping[] = [];
    for (const m of data.classicAws) {
      if (!seenClassicTf.has(m.terraformType)) {
        seenClassicTf.add(m.terraformType);
        if (m.cfnType === null || !seenClassicCfn.has(m.cfnType)) {
          if (m.cfnType !== null) seenClassicCfn.add(m.cfnType);
          uniqueClassic.push(m);
        }
      }
    }

    return {
      ...data,
      awscc: dedupedAwscc,
      classicAws: uniqueClassic,
    };
  });

/**
 * Generator for hierarchical CfnAvailability rows from a CFN type like "AWS::S3::Bucket".
 * Creates a service parent row + resource type child row.
 */
function cfnRowPairArb(cfnType: string): fc.Arbitrary<CfnAvailability[]> {
  // Parse "AWS::S3::Bucket" into service="S3", resource="Bucket"
  const parts = cfnType.split('::');
  const service = parts.length >= 2 ? parts[1] : 'Unknown';
  const resource = parts.length >= 3 ? parts.slice(2).join('::') : cfnType;

  return fc.uuid().map((uuid) => {
    const svcId = `svc-${service}-${uuid.slice(0, 8)}`;
    return [
      {
        id: svcId,
        parentId: null,
        name: service,
        regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
      },
      {
        id: `rt-${uuid}`,
        parentId: svcId,
        name: resource,
        regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
      },
    ] as CfnAvailability[];
  });
}

/**
 * Generator for random CfnAvailability rows with hierarchical structure.
 * Some CFN types may match overlay mappings, some may not.
 */
function cfnRowsArb(overlayData: TerraformOverlayData): fc.Arbitrary<CfnAvailability[]> {
  // Collect all known CFN types from the overlay
  const knownCfnTypes = [
    ...overlayData.awscc.map((m) => m.cfnType),
    ...overlayData.classicAws.filter((m) => m.cfnType !== null).map((m) => m.cfnType as string),
  ];

  // Generate a mix of known and unknown CFN type names
  const knownRowArb =
    knownCfnTypes.length > 0
      ? fc.array(fc.constantFrom(...knownCfnTypes), { minLength: 0, maxLength: 5 })
      : fc.constant([] as string[]);

  const unknownRowArb = fc.array(cfnTypeArb, { minLength: 0, maxLength: 5 });

  return fc
    .tuple(knownRowArb, unknownRowArb)
    .chain(([knownNames, unknownNames]) => {
      // Deduplicate names
      const allNames = [...new Set([...knownNames, ...unknownNames])];
      if (allNames.length === 0) {
        return fc.constant([] as CfnAvailability[]);
      }
      return fc.tuple(...allNames.map((name) => cfnRowPairArb(name))).map((pairs) => pairs.flat() as CfnAvailability[]);
    });
}

// --- Property Tests ---

/**
 * Feature: terraform-overlay, Property 5: Label Translation Correctness
 *
 * For any set of CFN availability rows and a valid overlay index, translating rows for a given
 * naming convention SHALL:
 * (a) produce labels matching the selected convention for all mapped resources,
 * (b) exclude resources with no mapping in the selected Terraform convention when AWSCC view is active,
 * (c) include unmapped Terraform resources when Terraform AWS view is active,
 * (d) exclude Terraform-only resources when CloudFormation view is active.
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 8.1, 8.3**
 */
describe('Feature: terraform-overlay, Property 5: Label Translation Correctness', () => {
  it('(a) CloudFormation convention: rows are returned as-is (identity)', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, (overlayData) => {
        const index = buildOverlayIndex(overlayData);

        return fc.assert(
          fc.property(cfnRowsArb(overlayData), (rows) => {
            const result = translateRows(rows, 'cloudformation', index);

            // In CloudFormation view, rows are returned unchanged (identity transform)
            expect(result).toEqual(rows);
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 10 },
    );
  });

  it('(b) Terraform AWSCC convention: unmapped CFN resources are excluded', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, (overlayData) => {
        const index = buildOverlayIndex(overlayData);

        return fc.assert(
          fc.property(cfnRowsArb(overlayData), (rows) => {
            const result = translateRows(rows, 'terraform-awscc', index);

            // Build a lookup from row ID to row for parent resolution
            const byId = new Map(rows.map((r) => [r.id, r]));

            // For each resource type row, construct full CFN type and check mapping
            for (const row of rows) {
              if (row.regionalAvailabilityType !== RegionalAvailabilityType.RESOURCE_TYPE) continue;

              const parent = row.parentId ? byId.get(row.parentId) : undefined;
              const fullCfnType = parent ? `AWS::${parent.name}::${row.name}` : null;
              const awsccType = fullCfnType ? index.cfnToAwscc.get(fullCfnType) : undefined;

              if (awsccType) {
                // Mapped: should appear in result with AWSCC name
                const found = result.find((r) => r.id === row.id);
                expect(found).toBeDefined();
                expect(found!.name).toBe(awsccType);
              } else {
                // Unmapped: should NOT appear in result
                const found = result.find((r) => r.id === row.id);
                expect(found).toBeUndefined();
              }
            }
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 10 },
    );
  });

  it('(c) Terraform AWS convention: only translates rows that have availability data', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, (overlayData) => {
        const index = buildOverlayIndex(overlayData);

        return fc.assert(
          fc.property(cfnRowsArb(overlayData), (rows) => {
            const result = translateRows(rows, 'terraform-aws', index);

            // Unmapped classic AWS resources should NOT be included (no availability data)
            for (const mapping of index.unmappedClassicAws) {
              const found = result.find((r) => r.name === mapping.terraformType);
              expect(found).toBeUndefined();
            }

            // Build a lookup from row ID to row for parent resolution
            const byId = new Map(rows.map((r) => [r.id, r]));

            // For each resource type row, construct full CFN type and check mapping
            for (const row of rows) {
              if (row.regionalAvailabilityType !== RegionalAvailabilityType.RESOURCE_TYPE) continue;

              const parent = row.parentId ? byId.get(row.parentId) : undefined;
              const fullCfnType = parent ? `AWS::${parent.name}::${row.name}` : null;
              const classicType = fullCfnType ? index.cfnToClassicAws.get(fullCfnType) : undefined;

              if (classicType) {
                // Mapped: should appear in result with classic AWS name
                const found = result.find((r) => r.id === row.id);
                expect(found).toBeDefined();
                expect(found!.name).toBe(classicType);
              } else {
                // Unmapped CFN resources are excluded
                const found = result.find((r) => r.id === row.id);
                expect(found).toBeUndefined();
              }
            }
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 10 },
    );
  });

  it('(d) CloudFormation convention: Terraform-only resources are NOT in the result', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, (overlayData) => {
        const index = buildOverlayIndex(overlayData);

        return fc.assert(
          fc.property(cfnRowsArb(overlayData), (rows) => {
            const result = translateRows(rows, 'cloudformation', index);

            // Unmapped classic AWS resources (cfnType === null) should NOT appear
            for (const mapping of index.unmappedClassicAws) {
              const found = result.find((r) => r.name === mapping.terraformType);
              expect(found).toBeUndefined();
            }

            // AWSCC-only resources (those not in the input rows) should NOT appear
            const cfnNamesInRows = new Set(rows.map((r) => r.name));
            for (const mapping of index.allAwscc) {
              if (!cfnNamesInRows.has(mapping.cfnType)) {
                // This is an AWSCC-only resource - should not be in CFN view
                const found = result.find((r) => r.name === mapping.terraformType);
                expect(found).toBeUndefined();
              }
            }

            // Result should only contain rows from the original input
            for (const row of result) {
              const originalRow = rows.find((r) => r.id === row.id);
              expect(originalRow).toBeDefined();
            }
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 10 },
    );
  });
});


/**
 * Feature: terraform-overlay, Property 6: Cross-Convention Search
 *
 * For any search query string and any set of CFN availability rows with overlay mappings,
 * the search function SHALL return all rows where the query is a case-insensitive substring
 * of any of the resource's naming convention labels (CFN, AWSCC, or classic AWS), and the
 * returned rows SHALL use the currently active convention's labels.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
 */
describe('Feature: terraform-overlay, Property 6: Cross-Convention Search', () => {
  /**
   * Generator for short lowercase search terms (2-5 chars) that are likely to match
   * parts of resource type names.
   */
  const searchTermArb = fc.stringMatching(/^[a-z]{2,5}$/);

  /**
   * Generator for a naming convention.
   */
  const conventionArb: fc.Arbitrary<NamingConvention> = fc.constantFrom(
    'cloudformation',
    'terraform-aws',
    'terraform-awscc',
  );

  it('returns all rows where query matches any convention label (case-insensitive substring)', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, conventionArb, searchTermArb, (overlayData, convention, query) => {
        const index = buildOverlayIndex(overlayData);

        return fc.assert(
          fc.property(cfnRowsArb(overlayData), (rows) => {
            const result = searchAllConventions(rows, query, index, convention);
            const lowerQuery = query.toLowerCase();

            // Build a lookup from row ID to row for parent resolution
            const byId = new Map(rows.map((r) => [r.id, r]));

            // Helper to construct full CFN type from a resource type row
            function getFullCfnType(row: CfnAvailability): string | null {
              if (!row.parentId) return null;
              const parent = byId.get(row.parentId);
              if (!parent) return null;
              return `AWS::${parent.name}::${row.name}`;
            }

            // Determine which row IDs SHOULD match (query is substring of any convention label)
            const expectedMatchingIds = new Set<string>();
            for (const row of rows) {
              // Check the row's own name (short name like "S3" or "Bucket")
              if (row.name.toLowerCase().includes(lowerQuery)) {
                expectedMatchingIds.add(row.id);
                continue;
              }

              // For resource type rows, also check full CFN type and terraform names
              if (row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE) {
                const fullCfnType = getFullCfnType(row);

                // Check full CFN type
                if (fullCfnType && fullCfnType.toLowerCase().includes(lowerQuery)) {
                  expectedMatchingIds.add(row.id);
                  continue;
                }

                // Check AWSCC name
                const awsccName = fullCfnType ? index.cfnToAwscc.get(fullCfnType) : undefined;
                if (awsccName && awsccName.toLowerCase().includes(lowerQuery)) {
                  expectedMatchingIds.add(row.id);
                  continue;
                }

                // Check classic AWS name
                const classicName = fullCfnType ? index.cfnToClassicAws.get(fullCfnType) : undefined;
                if (classicName && classicName.toLowerCase().includes(lowerQuery)) {
                  expectedMatchingIds.add(row.id);
                }
              }
            }

            // After filtering by search, the result is also translated by convention.
            // So only rows that survive both search AND translation should appear.
            const translated = translateRows(rows, convention, index);
            const translatedIds = new Set(translated.map((r) => r.id));

            // Verify: every result row should be both a search match (or parent of one) and in the translated set
            for (const resultRow of result) {
              expect(translatedIds.has(resultRow.id)).toBe(true);
            }

            // Verify: every expected matching resource type row that also survives translation should be in result
            for (const id of expectedMatchingIds) {
              const row = byId.get(id);
              if (!row) continue;
              if (row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE) {
                if (translatedIds.has(id)) {
                  const found = result.find((r) => r.id === id);
                  expect(found).toBeDefined();
                }
              }
            }
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 10 },
    );
  });

  it('result labels use the active convention', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, conventionArb, searchTermArb, (overlayData, convention, query) => {
        const index = buildOverlayIndex(overlayData);

        return fc.assert(
          fc.property(cfnRowsArb(overlayData), (rows) => {
            const result = searchAllConventions(rows, query, index, convention);

            // Build a lookup from row ID to row for parent resolution
            const byId = new Map(rows.map((r) => [r.id, r]));

            for (const row of result) {
              // Find the original row from input
              const originalRow = rows.find((r) => r.id === row.id);
              if (!originalRow) continue;

              // Service parent rows keep their original names regardless of convention
              if (originalRow.regionalAvailabilityType === RegionalAvailabilityType.SERVICE) {
                expect(row.name).toBe(originalRow.name);
                continue;
              }

              // For resource type rows, verify label matches convention
              if (originalRow.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE) {
                const parent = originalRow.parentId ? byId.get(originalRow.parentId) : undefined;
                const fullCfnType = parent ? `AWS::${parent.name}::${originalRow.name}` : null;

                if (convention === 'cloudformation') {
                  expect(row.name).toBe(originalRow.name);
                } else if (convention === 'terraform-awscc') {
                  const expectedName = fullCfnType ? index.cfnToAwscc.get(fullCfnType) : undefined;
                  expect(expectedName).toBeDefined();
                  expect(row.name).toBe(expectedName);
                  expect(row.name.startsWith('awscc_')).toBe(true);
                } else if (convention === 'terraform-aws') {
                  const expectedName = fullCfnType ? index.cfnToClassicAws.get(fullCfnType) : undefined;
                  expect(expectedName).toBeDefined();
                  expect(row.name).toBe(expectedName);
                  expect(row.name.startsWith('aws_')).toBe(true);
                }
              }
            }
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 10 },
    );
  });

  it('empty query returns all translated rows (same as translateRows)', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, conventionArb, (overlayData, convention) => {
        const index = buildOverlayIndex(overlayData);

        return fc.assert(
          fc.property(cfnRowsArb(overlayData), (rows) => {
            const searchResult = searchAllConventions(rows, '', index, convention);
            const translateResult = translateRows(rows, convention, index);

            // Empty query should return same result as translateRows
            expect(searchResult.length).toBe(translateResult.length);

            // All IDs should match
            const searchIds = new Set(searchResult.map((r) => r.id));
            const translateIds = new Set(translateResult.map((r) => r.id));
            expect(searchIds).toEqual(translateIds);
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 10 },
    );
  });
});


/**
 * Feature: terraform-overlay, Property 7: Resource Count Accuracy
 *
 * For any set of CFN availability rows and overlay data, the resource count for a selected
 * naming convention SHALL equal the number of rows visible after applying the translation
 * and filtering logic for that convention.
 *
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 */
describe('Feature: terraform-overlay, Property 7: Resource Count Accuracy', () => {
  /**
   * Generator for a naming convention.
   */
  const conventionArb: fc.Arbitrary<NamingConvention> = fc.constantFrom(
    'cloudformation',
    'terraform-aws',
    'terraform-awscc',
  );

  it('resource count equals number of visible rows after translation/filtering', () => {
    fc.assert(
      fc.property(terraformOverlayDataArb, conventionArb, (overlayData, convention) => {
        const index = buildOverlayIndex(overlayData);

        return fc.assert(
          fc.property(cfnRowsArb(overlayData), (rows) => {
            const count = getResourceCount(rows, convention, index);
            const translatedRows = translateRows(rows, convention, index);
            const resourceTypeCount = translatedRows.filter(
              r => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE
            ).length;

            expect(count).toBe(resourceTypeCount);
          }),
          { numRuns: 10 },
        );
      }),
      { numRuns: 10 },
    );
  });
});
