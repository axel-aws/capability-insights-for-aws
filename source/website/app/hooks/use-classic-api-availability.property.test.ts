import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { filterTreeBySearch } from './use-classic-api-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import type { ApiAvailability } from '@capability-insights/shared/types/availability/regional-availability';

// --- Generators ---

/** Generator for valid SDK service names (e.g., "S3", "EC2", "Lambda") */
const sdkServiceNameArb = fc.stringMatching(/^[A-Z][A-Za-z0-9]{1,15}$/);

/** Generator for valid API operation names (e.g., "CreateBucket", "PutObject") */
const operationNameArb = fc.stringMatching(/^[A-Z][a-zA-Z]{2,20}$/);

/** Generator for valid Terraform type names (e.g., "aws_s3_bucket") */
const terraformTypeArb = fc
  .array(fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/), { minLength: 1, maxLength: 3 })
  .map((segments) => `aws_${segments.join('_')}`);

/**
 * Generator for a three-level tree structure:
 * - Level 0: Terraform Resource (parentId: null)
 * - Level 1: SDK Service (parentId: resource)
 * - Level 2: API Operation (parentId: service)
 */
interface TreeWithNames {
  rows: ApiAvailability[];
  resourceNames: string[];
  serviceNames: string[];
  operationNames: string[];
}

const treeArb: fc.Arbitrary<TreeWithNames> = fc
  .array(
    fc.tuple(
      terraformTypeArb,
      sdkServiceNameArb,
      fc.uniqueArray(operationNameArb, { minLength: 1, maxLength: 4 }),
    ),
    { minLength: 1, maxLength: 5 },
  )
  .map((resources) => {
    const rows: ApiAvailability[] = [];
    const resourceNames: string[] = [];
    const serviceNames: string[] = [];
    const operationNames: string[] = [];

    for (const [terraformType, sdkService, operations] of resources) {
      const resourceId = `terraform-resource-${terraformType}`;
      const serviceId = `terraform-service-${terraformType}-${sdkService}`;

      resourceNames.push(terraformType);
      serviceNames.push(sdkService);

      // Level 0: Resource row
      rows.push({
        id: resourceId,
        parentId: null,
        name: terraformType,
        regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
        sdkServiceName: sdkService,
      });

      // Level 1: Service row
      rows.push({
        id: serviceId,
        parentId: resourceId,
        name: sdkService,
        regionalAvailabilityType: RegionalAvailabilityType.SDK_SERVICE,
      });

      // Level 2: Operation rows
      for (const operation of operations) {
        const operationId = `terraform-op-${terraformType}-${sdkService}-${operation}`;
        operationNames.push(operation);

        rows.push({
          id: operationId,
          parentId: serviceId,
          name: operation,
          regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
          sdkServiceName: sdkService,
        });
      }
    }

    return { rows, resourceNames, serviceNames, operationNames };
  });

/**
 * Helper: extract a random substring from a given string.
 * Returns an arbitrary that produces a non-empty substring of the input.
 */
function substringOf(str: string): fc.Arbitrary<string> {
  if (str.length === 0) return fc.constant('');
  return fc
    .tuple(
      fc.integer({ min: 0, max: str.length - 1 }),
      fc.integer({ min: 1, max: str.length }),
    )
    .map(([start, end]) => {
      const actualEnd = Math.max(start + 1, Math.min(end, str.length));
      return str.slice(start, actualEnd);
    });
}

// --- Property Tests ---

/**
 * Feature: terraform-classic-api-availability, Property 4: Search Across Tree Levels
 *
 * For any search query string that is a case-insensitive substring of a Terraform resource name,
 * SDK service name, or API operation name in the tree, the search function SHALL return the
 * matching row and all its ancestors (so the tree remains navigable). The search SHALL be
 * case-insensitive and support partial substring matching.
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
 */
describe('Feature: terraform-classic-api-availability, Property 4: Search Across Tree Levels', () => {
  it('matching rows and their ancestors are returned for resource name substrings', () => {
    fc.assert(
      fc.property(
        treeArb.chain((tree) => {
          // Pick a random resource name and generate a substring of it
          const nameArb = fc.constantFrom(...tree.resourceNames);
          return nameArb.chain((name) =>
            substringOf(name).map((sub) => ({ tree, searchQuery: sub, matchedName: name })),
          );
        }),
        ({ tree, searchQuery }) => {
          const result = filterTreeBySearch(tree.rows, searchQuery);
          const resultIds = new Set(result.map((r) => r.id));
          const byId = new Map(tree.rows.map((r) => [r.id, r]));

          // Every row whose name matches the query (case-insensitive) must be in the result
          const lowerQuery = searchQuery.toLowerCase();
          const matchingRows = tree.rows.filter((r) =>
            r.name.toLowerCase().includes(lowerQuery),
          );
          for (const row of matchingRows) {
            expect(resultIds.has(row.id)).toBe(true);
          }

          // Every matching row's ancestors must also be in the result
          for (const row of matchingRows) {
            let current = row;
            while (current.parentId) {
              expect(resultIds.has(current.parentId)).toBe(true);
              current = byId.get(current.parentId)!;
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('matching rows and their ancestors are returned for service name substrings', () => {
    fc.assert(
      fc.property(
        treeArb.chain((tree) => {
          const nameArb = fc.constantFrom(...tree.serviceNames);
          return nameArb.chain((name) =>
            substringOf(name).map((sub) => ({ tree, searchQuery: sub })),
          );
        }),
        ({ tree, searchQuery }) => {
          const result = filterTreeBySearch(tree.rows, searchQuery);
          const resultIds = new Set(result.map((r) => r.id));
          const byId = new Map(tree.rows.map((r) => [r.id, r]));

          const lowerQuery = searchQuery.toLowerCase();
          const matchingRows = tree.rows.filter((r) =>
            r.name.toLowerCase().includes(lowerQuery),
          );

          // All matching rows must be included
          for (const row of matchingRows) {
            expect(resultIds.has(row.id)).toBe(true);
          }

          // All ancestors of matching rows must be included
          for (const row of matchingRows) {
            let current = row;
            while (current.parentId) {
              expect(resultIds.has(current.parentId)).toBe(true);
              current = byId.get(current.parentId)!;
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('matching rows and their ancestors are returned for operation name substrings', () => {
    fc.assert(
      fc.property(
        treeArb.chain((tree) => {
          const nameArb = fc.constantFrom(...tree.operationNames);
          return nameArb.chain((name) =>
            substringOf(name).map((sub) => ({ tree, searchQuery: sub })),
          );
        }),
        ({ tree, searchQuery }) => {
          const result = filterTreeBySearch(tree.rows, searchQuery);
          const resultIds = new Set(result.map((r) => r.id));
          const byId = new Map(tree.rows.map((r) => [r.id, r]));

          const lowerQuery = searchQuery.toLowerCase();
          const matchingRows = tree.rows.filter((r) =>
            r.name.toLowerCase().includes(lowerQuery),
          );

          // All matching rows must be included
          for (const row of matchingRows) {
            expect(resultIds.has(row.id)).toBe(true);
          }

          // All ancestors of matching rows must be included
          for (const row of matchingRows) {
            let current = row;
            while (current.parentId) {
              expect(resultIds.has(current.parentId)).toBe(true);
              current = byId.get(current.parentId)!;
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('search is case-insensitive', () => {
    fc.assert(
      fc.property(
        treeArb.chain((tree) => {
          // Pick a random name from any level and generate a case-varied substring
          const allNames = [...tree.resourceNames, ...tree.serviceNames, ...tree.operationNames];
          const nameArb = fc.constantFrom(...allNames);
          return nameArb.chain((name) =>
            substringOf(name).map((sub) => ({
              tree,
              originalSub: sub,
            })),
          );
        }),
        fc.boolean(),
        ({ tree, originalSub }, useUpperCase) => {
          // Apply case transformation
          const searchQuery = useUpperCase ? originalSub.toUpperCase() : originalSub.toLowerCase();

          const result = filterTreeBySearch(tree.rows, searchQuery);
          const resultIds = new Set(result.map((r) => r.id));

          const lowerQuery = searchQuery.toLowerCase();
          const matchingRows = tree.rows.filter((r) =>
            r.name.toLowerCase().includes(lowerQuery),
          );

          // All matching rows must be included regardless of case
          for (const row of matchingRows) {
            expect(resultIds.has(row.id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty search query returns all rows', () => {
    fc.assert(
      fc.property(treeArb, ({ rows }) => {
        const result = filterTreeBySearch(rows, '');
        expect(result).toEqual(rows);
      }),
      { numRuns: 100 },
    );
  });

  it('result only contains rows that are matching or ancestors of matching rows', () => {
    fc.assert(
      fc.property(
        treeArb.chain((tree) => {
          const allNames = [...tree.resourceNames, ...tree.serviceNames, ...tree.operationNames];
          const nameArb = fc.constantFrom(...allNames);
          return nameArb.chain((name) =>
            substringOf(name).map((sub) => ({ tree, searchQuery: sub })),
          );
        }),
        ({ tree, searchQuery }) => {
          const result = filterTreeBySearch(tree.rows, searchQuery);
          const byId = new Map(tree.rows.map((r) => [r.id, r]));

          const lowerQuery = searchQuery.toLowerCase();

          // Compute the expected set: matching rows + their ancestors
          const matchingIds = new Set<string>();
          for (const row of tree.rows) {
            if (row.name.toLowerCase().includes(lowerQuery)) {
              matchingIds.add(row.id);
            }
          }

          const expectedIds = new Set<string>(matchingIds);
          for (const id of matchingIds) {
            let current = byId.get(id);
            while (current?.parentId) {
              expectedIds.add(current.parentId);
              current = byId.get(current.parentId);
            }
          }

          // Result should contain exactly the expected rows
          const resultIds = new Set(result.map((r) => r.id));
          expect(resultIds).toEqual(expectedIds);
        },
      ),
      { numRuns: 100 },
    );
  });
});
