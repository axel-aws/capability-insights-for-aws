import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildAvailabilityTree,
  buildOperationAvailabilityIndex,
  computeResourceAvailability,
  getMissingOperations,
} from './classic-api-availability-engine';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { ApiAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { ClassicApiMappingData, ClassicApiResourceMapping } from '@capability-insights/shared/types/terraform-classic-api-mapping';

// --- Generators ---

/** Generator for valid SDK service names (e.g., "S3", "EC2", "Lambda") */
const sdkServiceNameArb = fc.stringMatching(/^[A-Z][A-Za-z0-9]{1,15}$/);

/** Generator for valid API operation names (e.g., "CreateBucket", "PutObject") */
const operationNameArb = fc.stringMatching(/^[A-Z][a-zA-Z]{2,20}$/);

/** Generator for valid Terraform type names (e.g., "aws_s3_bucket") */
const terraformTypeArb = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/), { minLength: 1, maxLength: 3 })
  .map((segments) => `aws_${segments.join('_')}`);

/** Generator for region codes (e.g., "us-east-1", "eu-west-2") */
const regionCodeArb = fc.constantFrom(
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-southeast-1',
  'ap-northeast-1',
);

/** Generator for a Region object */
const regionArb: fc.Arbitrary<Region> = regionCodeArb.map((code) => ({
  Region: code,
  RegionLongName: `Region ${code}`,
  Partition: 'aws',
  RegionStatus: 'available',
  RequireRegionOptIn: false,
}));

/** Generator for a ClassicApiResourceMapping */
const resourceMappingArb: fc.Arbitrary<ClassicApiResourceMapping> = fc
  .tuple(
    terraformTypeArb,
    sdkServiceNameArb,
    fc.uniqueArray(operationNameArb, { minLength: 1, maxLength: 5 }),
  )
  .map(([terraformType, sdkService, requiredApis]) => ({
    terraformType,
    sdkService,
    requiredApis,
    registryPath: terraformType.slice('aws_'.length),
  }));

/** Generator for ClassicApiMappingData with 1-5 resources */
const mappingDataArb: fc.Arbitrary<ClassicApiMappingData> = fc
  .array(resourceMappingArb, { minLength: 1, maxLength: 5 })
  .map((resources) => ({
    metadata: {
      generatedAt: '2025-01-15T10:30:00.000Z',
      providerCommitSha: 'abc123',
      resourceCount: resources.length,
      serviceCount: new Set(resources.map((r) => r.sdkService)).size,
    },
    resources,
  }));



// --- Property Tests ---

/**
 * Feature: terraform-classic-api-availability, Property 1: Tree Structure Correctness
 *
 * For any valid ClassicApiMappingData and API operations data, the generated availability tree
 * SHALL have exactly three levels: (a) every Terraform resource row has parentId: null,
 * (b) every SDK service row's parentId references a resource row, (c) every operation row's
 * parentId references a service row, and (d) no row exists at a fourth level.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4**
 */
describe('Feature: terraform-classic-api-availability, Property 1: Tree Structure Correctness', () => {
  it('resources have parentId null, services reference resources, operations reference services, no fourth level', () => {
    fc.assert(
      fc.property(
        mappingDataArb,
        fc.array(regionArb, { minLength: 1, maxLength: 3 }),
        (mapping, regions) => {
          // Build API rows that match the mapping resources
          const regionCodes = regions.map((r) => r.Region);
          const apiRows: ApiAvailability[] = [];
          for (const resource of mapping.resources) {
            for (const operation of resource.requiredApis) {
              const regionalAvailability: Record<string, AvailabilityStatus> = {};
              for (const region of regionCodes) {
                regionalAvailability[region] = AvailabilityStatus.AVAILABLE;
              }
              apiRows.push({
                id: `op-${resource.sdkService}-${operation}`,
                parentId: `svc-${resource.sdkService}`,
                name: operation,
                regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
                sdkServiceName: resource.sdkService,
                regionalAvailability,
              });
            }
          }

          const tree = buildAvailabilityTree(mapping, apiRows, regions);

          // Categorize rows by type
          const resourceRows = tree.filter(
            (r) => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE,
          );
          const serviceRows = tree.filter(
            (r) => r.regionalAvailabilityType === RegionalAvailabilityType.SDK_SERVICE,
          );
          const operationRows = tree.filter(
            (r) => r.regionalAvailabilityType === RegionalAvailabilityType.OPERATION,
          );

          // (a) Every resource row has parentId: null
          for (const row of resourceRows) {
            expect(row.parentId).toBeNull();
          }

          // (b) Every service row's parentId references a resource row
          const resourceIds = new Set(resourceRows.map((r) => r.id));
          for (const row of serviceRows) {
            expect(row.parentId).not.toBeNull();
            expect(resourceIds.has(row.parentId!)).toBe(true);
          }

          // (c) Every operation row's parentId references a service row
          const serviceIds = new Set(serviceRows.map((r) => r.id));
          for (const row of operationRows) {
            expect(row.parentId).not.toBeNull();
            expect(serviceIds.has(row.parentId!)).toBe(true);
          }

          // (d) No fourth level: all rows are one of the three types
          // and no row references an operation row as parent
          const operationIds = new Set(operationRows.map((r) => r.id));
          for (const row of tree) {
            if (row.parentId !== null) {
              // Parent must be a resource or service, never an operation
              expect(operationIds.has(row.parentId)).toBe(false);
            }
          }

          // Verify only three types exist in the tree
          expect(tree.length).toBe(resourceRows.length + serviceRows.length + operationRows.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: terraform-classic-api-availability, Property 2: Availability AND Computation
 *
 * For any ClassicApiResourceMapping with a non-empty requiredApis array, and for any region:
 * the computed availability SHALL be "Available" if and only if ALL required API operations
 * are available in that region according to the operation availability index. If any single
 * required operation is unavailable, the result SHALL be "Not Available". The computation
 * SHALL be deterministic — identical inputs always produce identical outputs.
 *
 * **Validates: Requirements 1.6, 2.1, 2.2, 2.4**
 */
describe('Feature: terraform-classic-api-availability, Property 2: Availability AND Computation', () => {
  it('"Available" iff ALL required ops available; "Not Available" if any missing', () => {
    // Generator that produces requiredApis and a subset that will be available
    const testCaseArb = fc
      .uniqueArray(operationNameArb, { minLength: 1, maxLength: 6 })
      .chain((requiredApis) =>
        fc.tuple(fc.constant(requiredApis), fc.subarray(requiredApis, { minLength: 0 })),
      );

    fc.assert(
      fc.property(
        sdkServiceNameArb,
        testCaseArb,
        regionCodeArb,
        (sdkService, [requiredApis, availableOps], region) => {
          const availableSet = new Set(availableOps);

          // Build an index with controlled availability per operation
          const apiRows: ApiAvailability[] = requiredApis.map((operation) => {
            const regionalAvailability: Record<string, AvailabilityStatus> = {};
            if (availableSet.has(operation)) {
              regionalAvailability[region] = AvailabilityStatus.AVAILABLE;
            } else {
              regionalAvailability[region] = AvailabilityStatus.NOT_AVAILABLE;
            }
            return {
              id: `op-${sdkService}-${operation}`,
              parentId: `svc-${sdkService}`,
              name: operation,
              regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
              sdkServiceName: sdkService,
              regionalAvailability,
            };
          });

          const index = buildOperationAvailabilityIndex(apiRows);
          const result = computeResourceAvailability(requiredApis, sdkService, region, index);

          // Determine expected result: all ops must be available
          const allAvailable = requiredApis.every((op) => availableSet.has(op));

          if (allAvailable) {
            expect(result).toBe('Available');
          } else {
            expect(result).toBe('Not Available');
          }

          // Determinism: calling again with same inputs produces same result
          const result2 = computeResourceAvailability(requiredApis, sdkService, region, index);
          expect(result2).toBe(result);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty requiredApis returns "Unknown"', () => {
    fc.assert(
      fc.property(sdkServiceNameArb, regionCodeArb, (sdkService, region) => {
        const index = buildOperationAvailabilityIndex([]);
        const result = computeResourceAvailability([], sdkService, region, index);
        expect(result).toBe('Unknown');
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: terraform-classic-api-availability, Property 3: Missing Operations Completeness
 *
 * For any Terraform resource that is "Unavailable" in a region, the getMissingOperations
 * function SHALL return exactly the set of required API operations that are not available
 * in that region — no more, no less. The returned set SHALL be a subset of the resource's
 * requiredApis.
 *
 * **Validates: Requirements 3.2, 3.4**
 */
describe('Feature: terraform-classic-api-availability, Property 3: Missing Operations Completeness', () => {
  it('getMissingOperations returns exactly the unavailable operations, subset of requiredApis', () => {
    // Generator that produces requiredApis and a subset that will be available
    const testCaseArb = fc
      .uniqueArray(operationNameArb, { minLength: 1, maxLength: 6 })
      .chain((requiredApis) =>
        fc.tuple(fc.constant(requiredApis), fc.subarray(requiredApis, { minLength: 0 })),
      );

    fc.assert(
      fc.property(
        sdkServiceNameArb,
        testCaseArb,
        regionCodeArb,
        (sdkService, [requiredApis, availableOps], region) => {
          const availableSet = new Set(availableOps);

          // Build API rows with controlled availability
          const apiRows: ApiAvailability[] = requiredApis.map((operation) => {
            const regionalAvailability: Record<string, AvailabilityStatus> = {};
            if (availableSet.has(operation)) {
              regionalAvailability[region] = AvailabilityStatus.AVAILABLE;
            } else {
              regionalAvailability[region] = AvailabilityStatus.NOT_AVAILABLE;
            }
            return {
              id: `op-${sdkService}-${operation}`,
              parentId: `svc-${sdkService}`,
              name: operation,
              regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
              sdkServiceName: sdkService,
              regionalAvailability,
            };
          });

          const index = buildOperationAvailabilityIndex(apiRows);
          const missing = getMissingOperations(requiredApis, sdkService, region, index);

          // Expected missing: operations NOT in availableSet
          const expectedMissing = requiredApis.filter((op) => !availableSet.has(op));
          const expectedMissingFormatted = expectedMissing.map((op) => `${sdkService}:${op}`);

          // Verify: returns exactly the unavailable operations
          expect(missing.sort()).toEqual(expectedMissingFormatted.sort());

          // Verify: returned operations are a subset of requiredApis (formatted)
          const allFormattedApis = requiredApis.map((op) => `${sdkService}:${op}`);
          for (const m of missing) {
            expect(allFormattedApis).toContain(m);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// --- Preservation Property Tests ---

/**
 * Feature: terraform-classic-api-service-mismatch, Property 2: Preservation —
 * Exact Match Behavior Unchanged
 *
 * For any input where the Terraform mapping service name exactly matches the index key
 * in both value and case (e.g., "S3" matches "S3"), the functions SHALL produce the
 * correct results, preserving all existing correct behavior for services that already match.
 *
 * These tests observe behavior on UNFIXED code for non-buggy inputs (exact case matches).
 * They MUST PASS on unfixed code to confirm baseline behavior to preserve.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 */
describe('Feature: terraform-classic-api-service-mismatch, Property 2: Preservation — Exact Match Behavior Unchanged', () => {
  /**
   * Property: For all service names where sdkServiceName is set directly on operation rows
   * and the lookup uses the exact same value, computeResourceAvailability matches expected
   * AND-logic (Available iff all ops available).
   */
  it('computeResourceAvailability with exact-match service names preserves AND-logic', () => {
    // Generator: exact-match service names (same case used for indexing and lookup)
    const exactMatchArb = fc
      .uniqueArray(operationNameArb, { minLength: 1, maxLength: 6 })
      .chain((requiredApis) =>
        fc.tuple(
          fc.constant(requiredApis),
          fc.subarray(requiredApis, { minLength: 0 }),
        ),
      );

    fc.assert(
      fc.property(
        sdkServiceNameArb,
        exactMatchArb,
        regionCodeArb,
        (sdkService, [requiredApis, availableOps], region) => {
          const availableSet = new Set(availableOps);

          // Build API rows with sdkServiceName set DIRECTLY on each operation row
          // (no parent fallback needed — this is the exact-match case)
          const apiRows: ApiAvailability[] = requiredApis.map((operation) => {
            const regionalAvailability: Record<string, AvailabilityStatus> = {};
            if (availableSet.has(operation)) {
              regionalAvailability[region] = AvailabilityStatus.AVAILABLE;
            } else {
              regionalAvailability[region] = AvailabilityStatus.NOT_AVAILABLE;
            }
            return {
              id: `op-${sdkService}-${operation}`,
              parentId: `svc-${sdkService}`,
              name: operation,
              regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
              sdkServiceName: sdkService, // Set directly — exact match
              regionalAvailability,
            };
          });

          const index = buildOperationAvailabilityIndex(apiRows);

          // Lookup using the EXACT SAME service name (same case)
          const result = computeResourceAvailability(requiredApis, sdkService, region, index);

          // AND-logic: Available iff ALL required ops are available
          const allAvailable = requiredApis.every((op) => availableSet.has(op));

          if (allAvailable) {
            expect(result).toBe('Available');
          } else {
            expect(result).toBe('Not Available');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property: For all exact-match services, getMissingOperations returns exactly the set
   * of unavailable operations formatted as service:operation.
   */
  it('getMissingOperations with exact-match service names returns exactly unavailable ops', () => {
    const exactMatchArb = fc
      .uniqueArray(operationNameArb, { minLength: 1, maxLength: 6 })
      .chain((requiredApis) =>
        fc.tuple(
          fc.constant(requiredApis),
          fc.subarray(requiredApis, { minLength: 0 }),
        ),
      );

    fc.assert(
      fc.property(
        sdkServiceNameArb,
        exactMatchArb,
        regionCodeArb,
        (sdkService, [requiredApis, availableOps], region) => {
          const availableSet = new Set(availableOps);

          // Build API rows with sdkServiceName set directly (exact match)
          const apiRows: ApiAvailability[] = requiredApis.map((operation) => {
            const regionalAvailability: Record<string, AvailabilityStatus> = {};
            if (availableSet.has(operation)) {
              regionalAvailability[region] = AvailabilityStatus.AVAILABLE;
            } else {
              regionalAvailability[region] = AvailabilityStatus.NOT_AVAILABLE;
            }
            return {
              id: `op-${sdkService}-${operation}`,
              parentId: `svc-${sdkService}`,
              name: operation,
              regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
              sdkServiceName: sdkService, // Set directly — exact match
              regionalAvailability,
            };
          });

          const index = buildOperationAvailabilityIndex(apiRows);

          // Lookup using the EXACT SAME service name
          const missing = getMissingOperations(requiredApis, sdkService, region, index);

          // Expected: exactly the unavailable operations, formatted as service:operation
          const expectedMissing = requiredApis
            .filter((op) => !availableSet.has(op))
            .map((op) => `${sdkService}:${op}`);

          expect(missing.sort()).toEqual(expectedMissing.sort());
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property: For all exact-match services, buildAvailabilityTree produces correct
   * three-level structure with correct availability.
   */
  it('buildAvailabilityTree with exact-match service names produces correct three-level structure', () => {
    const exactMatchTreeArb = fc.record({
      sdkService: sdkServiceNameArb,
      terraformType: terraformTypeArb,
      operations: fc.uniqueArray(operationNameArb, { minLength: 1, maxLength: 4 }),
      availableOps: fc.constant(null as string[] | null), // will be derived
      regions: fc.uniqueArray(regionCodeArb, { minLength: 1, maxLength: 3 }),
    }).chain(({ sdkService, terraformType, operations, regions }) =>
      fc.subarray(operations, { minLength: 0 }).map((availableOps) => ({
        sdkService,
        terraformType,
        operations,
        availableOps,
        regions,
      })),
    );

    fc.assert(
      fc.property(exactMatchTreeArb, ({ sdkService, terraformType, operations, availableOps, regions }) => {
        const availableSet = new Set(availableOps);

        // Build mapping with EXACT SAME service name (no case mismatch)
        const mapping: ClassicApiMappingData = {
          metadata: {
            generatedAt: '2025-01-15T10:30:00.000Z',
            providerCommitSha: 'abc123',
            resourceCount: 1,
            serviceCount: 1,
          },
          resources: [
            {
              terraformType,
              sdkService, // Same case as in API rows
              requiredApis: operations,
              registryPath: terraformType.slice('aws_'.length),
            },
          ],
        };

        // Build API rows with sdkServiceName set directly (exact match)
        const apiRows: ApiAvailability[] = operations.map((op) => ({
          id: `op-${sdkService}-${op}`,
          parentId: `svc-${sdkService}`,
          name: op,
          regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
          sdkServiceName: sdkService, // Same case as mapping
          regionalAvailability: Object.fromEntries(
            regions.map((r) => [
              r,
              availableSet.has(op) ? AvailabilityStatus.AVAILABLE : AvailabilityStatus.NOT_AVAILABLE,
            ]),
          ),
        }));

        const regionObjects: Region[] = regions.map((code) => ({
          Region: code,
          RegionLongName: `Region ${code}`,
          Partition: 'aws',
          RegionStatus: 'available',
          RequireRegionOptIn: false,
        }));

        const tree = buildAvailabilityTree(mapping, apiRows, regionObjects);

        // Verify three-level structure
        const resourceRows = tree.filter(
          (r) => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE,
        );
        const serviceRows = tree.filter(
          (r) => r.regionalAvailabilityType === RegionalAvailabilityType.SDK_SERVICE,
        );
        const operationRows = tree.filter(
          (r) => r.regionalAvailabilityType === RegionalAvailabilityType.OPERATION,
        );

        // Exactly 1 resource, 1 service, N operations
        expect(resourceRows.length).toBe(1);
        expect(serviceRows.length).toBe(1);
        expect(operationRows.length).toBe(operations.length);

        // Resource row has parentId null
        expect(resourceRows[0].parentId).toBeNull();

        // Service row references resource
        expect(serviceRows[0].parentId).toBe(resourceRows[0].id);

        // All operation rows reference service
        for (const opRow of operationRows) {
          expect(opRow.parentId).toBe(serviceRows[0].id);
        }

        // Verify resource availability: AND-logic
        const allAvailable = operations.every((op) => availableSet.has(op));
        for (const region of regions) {
          if (allAvailable) {
            expect(resourceRows[0].regionalAvailability![region]).toBe(AvailabilityStatus.AVAILABLE);
          } else {
            expect(resourceRows[0].regionalAvailability![region]).toBe(AvailabilityStatus.NOT_AVAILABLE);
          }
        }

        // Verify operation-level availability matches input data
        for (const opRow of operationRows) {
          const opName = opRow.name;
          for (const region of regions) {
            if (availableSet.has(opName)) {
              expect(opRow.regionalAvailability![region]).toBe(AvailabilityStatus.AVAILABLE);
            } else {
              expect(opRow.regionalAvailability![region]).toBe(AvailabilityStatus.NOT_AVAILABLE);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// --- Bug Condition Exploration Tests ---

/**
 * Feature: terraform-classic-api-service-mismatch, Property 1: Bug Condition —
 * Case-Insensitive Service Name Matching and Parent Fallback
 *
 * This test encodes the EXPECTED (correct) behavior. It is expected to FAIL on unfixed code,
 * confirming the bug exists. When the fix is applied, this test will pass.
 *
 * Sub-condition (a): Parent fallback should use `parent.sdkServiceName` not `parent.name`
 * Sub-condition (b): Lookups should be case-insensitive (lowercase Terraform names match PascalCase SDK names)
 *
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2**
 */
describe('Feature: terraform-classic-api-service-mismatch, Property 1: Bug Condition — Case-Insensitive Service Name Matching and Parent Fallback', () => {
  it('buildOperationAvailabilityIndex with parent fallback rows produces keys derived from parent.sdkServiceName, not parent.name', () => {
    // Scoped PBT: Generate parent rows with name != sdkServiceName (the bug condition)
    const parentFallbackCaseArb = fc.record({
      parentName: fc.constantFrom('AWS Organizations', 'Amazon DynamoDB', 'Amazon CloudWatch', 'AWS Lambda'),
      sdkServiceName: fc.constantFrom('Organizations', 'DynamoDB', 'CloudWatch', 'Lambda'),
      operations: fc.uniqueArray(operationNameArb, { minLength: 1, maxLength: 4 }),
      region: regionCodeArb,
    }).filter(({ parentName, sdkServiceName }) => parentName !== sdkServiceName);

    fc.assert(
      fc.property(parentFallbackCaseArb, ({ parentName, sdkServiceName, operations, region }) => {
        const parentId = `svc-${sdkServiceName}`;

        // Create a parent SERVICE row with name (full display name) and sdkServiceName (SDK name)
        const parentRow: ApiAvailability = {
          id: parentId,
          parentId: null,
          name: parentName,
          regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
          sdkServiceName: sdkServiceName,
        };

        // Create operation rows WITHOUT sdkServiceName — they rely on parent fallback
        const operationRows: ApiAvailability[] = operations.map((op) => ({
          id: `op-${sdkServiceName}-${op}`,
          parentId: parentId,
          name: op,
          regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
          // sdkServiceName is intentionally NOT set — triggers parent fallback
          regionalAvailability: {
            [region]: AvailabilityStatus.AVAILABLE,
          },
        }));

        const allRows = [parentRow, ...operationRows];
        const index = buildOperationAvailabilityIndex(allRows);

        // Expected: index key should be derived from parent.sdkServiceName (e.g., "Organizations")
        // lowercased for case-insensitive matching (e.g., "organizations")
        const expectedKey = sdkServiceName.toLowerCase();

        // The index should contain the service keyed by the lowercase sdkServiceName
        // On unfixed code, it will be keyed by parent.name (e.g., "AWS Organizations") instead
        const hasExpectedKey = index.has(expectedKey) || index.has(sdkServiceName);

        // At minimum, the index must NOT use the full display name as key
        expect(index.has(parentName)).toBe(false);
        // And the index MUST have the sdkServiceName (or its lowercase form) as key
        expect(hasExpectedKey).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('computeResourceAvailability with lowercase Terraform name finds data indexed under PascalCase SDK name', () => {
    // Scoped PBT: PascalCase SDK names with lowercase lookups
    const caseMismatchArb = fc.record({
      sdkName: fc.constantFrom('Organizations', 'DynamoDB', 'CloudWatch', 'ElastiCache', 'CloudFormation'),
      operations: fc.uniqueArray(operationNameArb, { minLength: 1, maxLength: 4 }),
      region: regionCodeArb,
    });

    fc.assert(
      fc.property(caseMismatchArb, ({ sdkName, operations, region }) => {
        const lowercaseName = sdkName.toLowerCase();

        // Build API rows with PascalCase sdkServiceName (as the real API data provides)
        const apiRows: ApiAvailability[] = operations.map((op) => ({
          id: `op-${sdkName}-${op}`,
          parentId: `svc-${sdkName}`,
          name: op,
          regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
          sdkServiceName: sdkName,
          regionalAvailability: {
            [region]: AvailabilityStatus.AVAILABLE,
          },
        }));

        const index = buildOperationAvailabilityIndex(apiRows);

        // Lookup using lowercase Terraform name (e.g., "organizations")
        // Expected: should find the data and return "Available" since all ops are available
        const result = computeResourceAvailability(operations, lowercaseName, region, index);

        // On unfixed code, this will return "Not Available" because Map.get("organizations")
        // won't find data stored under "Organizations" (case-sensitive)
        expect(result).toBe('Available');
      }),
      { numRuns: 50 },
    );
  });

  it('getMissingOperations with lowercase Terraform name finds data indexed under PascalCase SDK name', () => {
    // Scoped PBT: PascalCase SDK names with lowercase lookups for getMissingOperations
    const caseMismatchArb = fc.record({
      sdkName: fc.constantFrom('DynamoDB', 'CloudWatch', 'Organizations', 'ElastiCache'),
      availableOps: fc.uniqueArray(operationNameArb, { minLength: 1, maxLength: 3 }),
      unavailableOps: fc.uniqueArray(operationNameArb, { minLength: 1, maxLength: 2 }),
      region: regionCodeArb,
    }).filter(({ availableOps, unavailableOps }) => {
      // Ensure no overlap between available and unavailable ops
      const availSet = new Set(availableOps);
      return unavailableOps.every((op) => !availSet.has(op));
    });

    fc.assert(
      fc.property(caseMismatchArb, ({ sdkName, availableOps, unavailableOps, region }) => {
        const lowercaseName = sdkName.toLowerCase();
        const allOps = [...availableOps, ...unavailableOps];

        // Build API rows with PascalCase sdkServiceName
        // Only availableOps are marked as AVAILABLE in the region
        const apiRows: ApiAvailability[] = availableOps.map((op) => ({
          id: `op-${sdkName}-${op}`,
          parentId: `svc-${sdkName}`,
          name: op,
          regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
          sdkServiceName: sdkName,
          regionalAvailability: {
            [region]: AvailabilityStatus.AVAILABLE,
          },
        }));

        const index = buildOperationAvailabilityIndex(apiRows);

        // Lookup using lowercase Terraform name
        const missing = getMissingOperations(allOps, lowercaseName, region, index);

        // Expected: only the unavailableOps should be missing (formatted as lowercaseName:op)
        // On unfixed code, ALL ops will be reported as missing because the service lookup fails
        const expectedMissing = unavailableOps.map((op) => `${lowercaseName}:${op}`);
        expect(missing.sort()).toEqual(expectedMissing.sort());
      }),
      { numRuns: 50 },
    );
  });

  it('buildAvailabilityTree with lowercase Terraform mapping names resolves against PascalCase API data', () => {
    // Scoped PBT: Terraform mapping uses lowercase, API data uses PascalCase
    const treeTestArb = fc.record({
      sdkName: fc.constantFrom('Organizations', 'DynamoDB', 'CloudWatch'),
      terraformType: terraformTypeArb,
      operations: fc.uniqueArray(operationNameArb, { minLength: 1, maxLength: 3 }),
      regions: fc.uniqueArray(regionCodeArb, { minLength: 1, maxLength: 3 }),
    });

    fc.assert(
      fc.property(treeTestArb, ({ sdkName, terraformType, operations, regions }) => {
        const lowercaseName = sdkName.toLowerCase();

        // Build mapping with lowercase service name (as Terraform provider uses)
        const mapping: ClassicApiMappingData = {
          metadata: {
            generatedAt: '2025-01-15T10:30:00.000Z',
            providerCommitSha: 'abc123',
            resourceCount: 1,
            serviceCount: 1,
          },
          resources: [
            {
              terraformType,
              sdkService: lowercaseName, // lowercase Terraform directory name
              requiredApis: operations,
              registryPath: terraformType.slice('aws_'.length),
            },
          ],
        };

        // Build API rows with PascalCase sdkServiceName (as real API data provides)
        const apiRows: ApiAvailability[] = operations.map((op) => ({
          id: `op-${sdkName}-${op}`,
          parentId: `svc-${sdkName}`,
          name: op,
          regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
          sdkServiceName: sdkName, // PascalCase
          regionalAvailability: Object.fromEntries(
            regions.map((r) => [r, AvailabilityStatus.AVAILABLE]),
          ),
        }));

        const regionObjects: Region[] = regions.map((code) => ({
          Region: code,
          RegionLongName: `Region ${code}`,
          Partition: 'aws',
          RegionStatus: 'available',
          RequireRegionOptIn: false,
        }));

        const tree = buildAvailabilityTree(mapping, apiRows, regionObjects);

        // Find the resource row
        const resourceRow = tree.find(
          (r) => r.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE,
        );
        expect(resourceRow).toBeDefined();

        // Expected: resource should be "Available" in all regions since all ops are available
        // On unfixed code, it will be "Not Available" because lowercase lookup fails against PascalCase index
        for (const region of regions) {
          expect(resourceRow!.regionalAvailability![region]).toBe(AvailabilityStatus.AVAILABLE);
        }
      }),
      { numRuns: 50 },
    );
  });
});
