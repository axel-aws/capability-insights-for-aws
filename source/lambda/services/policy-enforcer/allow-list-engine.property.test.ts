import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeAllowList } from './allow-list-engine';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { ApiService, ApiOperation } from '@capability-insights/shared/types/capability/api';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

// --- Shared Generators ---

/** A pool of realistic AWS region codes to draw from. */
const REGION_POOL = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-south-1',
  'sa-east-1',
  'ca-central-1',
  'me-south-1',
];

/** Generator for a non-empty subset of regions from the pool. */
const regionSubsetArb = fc
  .subarray(REGION_POOL, { minLength: 1, maxLength: REGION_POOL.length })
  .filter(arr => arr.length > 0);

/** Generator for a random AvailabilityStatus value. */
const availabilityStatusArb = fc.constantFrom(
  AvailabilityStatus.AVAILABLE,
  AvailabilityStatus.PLANNED,
  AvailabilityStatus.PLANNING,
  AvailabilityStatus.NOT_EXPANDING,
  AvailabilityStatus.NOT_AVAILABLE,
);

/** Generator for a PascalCase API action name. */
const apiActionArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]$/, { minLength: 1, maxLength: 1 }),
    fc.stringMatching(/^[a-zA-Z0-9]*$/, { minLength: 1, maxLength: 15 }),
  )
  .map(([first, rest]) => first + rest);

/** Generator for a lowercase SDK service name. */
const sdkServiceNameArb = fc.stringMatching(/^[a-z][a-z0-9]*$/, {
  minLength: 2,
  maxLength: 15,
});

/**
 * Generator for a random ApiOperation with availability data for a given set of regions.
 * Each region gets a random AvailabilityStatus.
 */
function apiOperationArb(allRegions: string[]): fc.Arbitrary<ApiOperation> {
  return fc.tuple(apiActionArb, fc.array(availabilityStatusArb, { minLength: allRegions.length, maxLength: allRegions.length })).map(
    ([actionName, statuses]) => {
      const regionalAvailability: Record<string, AvailabilityStatus> = {};
      allRegions.forEach((region, idx) => {
        regionalAvailability[region] = statuses[idx];
      });
      return {
        apiName: actionName,
        apiAction: actionName,
        homepage: '',
        regionalAvailability,
      };
    },
  );
}

/**
 * Generator for a random ApiService with 1-5 operations, each with availability for the given regions.
 */
function apiServiceArb(allRegions: string[]): fc.Arbitrary<ApiService> {
  return fc.tuple(sdkServiceNameArb, fc.array(apiOperationArb(allRegions), { minLength: 1, maxLength: 5 })).map(
    ([serviceName, operations]) => ({
      sdkServiceName: serviceName,
      sdkServiceFullName: `Amazon ${serviceName}`,
      apis: operations,
    }),
  );
}

/**
 * Generator for a random catalog (ApiService[]) with 1-4 services, each with operations
 * that have availability data for the given regions.
 */
function catalogDataArb(allRegions: string[]): fc.Arbitrary<ApiService[]> {
  return fc.array(apiServiceArb(allRegions), { minLength: 1, maxLength: 4 });
}

/**
 * Helper to build a minimal PolicyConfiguration for testing.
 */
function buildPolicyConfig(
  regions: string[],
  mode: 'intersection' | 'union',
  exceptions: { action: string; reason?: string; addedAt: string }[] = [],
): PolicyConfiguration {
  return {
    policyId: 'test-policy-id',
    policyName: 'Test Policy',
    tags: [],
    regions,
    mode,
    policyType: 'IAM',
    exceptions,
    refreshIntervalHours: 24,
    status: 'active',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

// --- Property Tests ---

/**
 * Feature: policy-enforcer, Property 1: Intersection mode includes only universally available actions
 * Validates: Requirements 2.2, 3.1
 */
describe('Feature: policy-enforcer, Property 1: Intersection mode includes only universally available actions', () => {
  it('every action in the intersection result has Available status in ALL selected regions', () => {
    fc.assert(
      fc.property(
        regionSubsetArb.chain(selectedRegions => {
          // Use the full REGION_POOL as the universe of regions for catalog data
          // so that catalog data has availability info for all possible regions
          return fc.tuple(
            fc.constant(selectedRegions),
            catalogDataArb(REGION_POOL),
          );
        }),
        ([selectedRegions, catalog]) => {
          const config = buildPolicyConfig(selectedRegions, 'intersection', []);
          const result = computeAllowList({ catalogData: catalog, configuration: config });

          // For every action in the result, verify it has Available status in ALL selected regions
          for (const action of result.actions) {
            // Find the source operation in the catalog that produced this action
            let foundAvailableInAll = false;

            for (const service of catalog) {
              for (const operation of service.apis) {
                // Reconstruct the IAM action the same way computeAllowList does
                const iamAction = `${service.sdkServiceName}:${operation.apiAction}`;

                if (iamAction === action) {
                  // Check that this operation is Available in ALL selected regions
                  const availableInAll = selectedRegions.every(
                    region => operation.regionalAvailability[region] === AvailabilityStatus.AVAILABLE,
                  );
                  if (availableInAll) {
                    foundAvailableInAll = true;
                  }
                }
              }
            }

            // The action must have been found as Available in all selected regions
            // in at least one matching catalog entry
            expect(foundAvailableInAll).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: policy-enforcer, Property 2: Union mode includes only regionally available actions
 * Validates: Requirements 2.3, 3.2
 */
describe('Feature: policy-enforcer, Property 2: Union mode includes only regionally available actions', () => {
  it('every action in the union result has Available status in at least ONE selected region', () => {
    fc.assert(
      fc.property(
        regionSubsetArb.chain(selectedRegions => {
          return fc.tuple(
            fc.constant(selectedRegions),
            catalogDataArb(REGION_POOL),
          );
        }),
        ([selectedRegions, catalog]) => {
          const config = buildPolicyConfig(selectedRegions, 'union', []);
          const result = computeAllowList({ catalogData: catalog, configuration: config });

          // For every action in the result, verify it has Available status in at least ONE selected region
          for (const action of result.actions) {
            let foundAvailableInAny = false;

            for (const service of catalog) {
              for (const operation of service.apis) {
                const iamAction = `${service.sdkServiceName}:${operation.apiAction}`;

                if (iamAction === action) {
                  // Check that this operation is Available in at least one selected region
                  const availableInAny = selectedRegions.some(
                    region => operation.regionalAvailability[region] === AvailabilityStatus.AVAILABLE,
                  );
                  if (availableInAny) {
                    foundAvailableInAny = true;
                  }
                }
              }
            }

            // The action must have been found as Available in at least one selected region
            expect(foundAvailableInAny).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: policy-enforcer, Property 3: Intersection is a subset of union
 * Validates: Requirements 3.5
 */
describe('Feature: policy-enforcer, Property 3: Intersection is a subset of union', () => {
  it('every action in the intersection result is also present in the union result given the same exceptions', () => {
    fc.assert(
      fc.property(
        regionSubsetArb.chain(selectedRegions => {
          return fc.tuple(
            fc.constant(selectedRegions),
            catalogDataArb(REGION_POOL),
            fc.array(
              fc.tuple(sdkServiceNameArb, apiActionArb).map(([svc, action]) => ({
                action: `${svc}:${action}`,
                reason: 'test exception',
                addedAt: '2024-01-01T00:00:00Z',
              })),
              { minLength: 0, maxLength: 5 },
            ),
          );
        }),
        ([selectedRegions, catalog, exceptions]) => {
          const intersectionConfig = buildPolicyConfig(selectedRegions, 'intersection', exceptions);
          const unionConfig = buildPolicyConfig(selectedRegions, 'union', exceptions);

          const intersectionResult = computeAllowList({ catalogData: catalog, configuration: intersectionConfig });
          const unionResult = computeAllowList({ catalogData: catalog, configuration: unionConfig });

          const unionSet = new Set(unionResult.actions);

          // Every action in the intersection result must also be in the union result
          for (const action of intersectionResult.actions) {
            expect(unionSet.has(action)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: policy-enforcer, Property 4: Exceptions are always included
 * Validates: Requirements 3.4, 6.4
 */
describe('Feature: policy-enforcer, Property 4: Exceptions are always included', () => {
  /** Generator for a valid exception action in the format "service:Action" or "service:*". */
  const exceptionActionArb = fc.oneof(
    fc.tuple(sdkServiceNameArb, apiActionArb).map(([svc, action]) => `${svc}:${action}`),
    sdkServiceNameArb.map(svc => `${svc}:*`),
  );

  /** Generator for a non-empty array of exception entries. */
  const exceptionEntriesArb = fc
    .array(exceptionActionArb, { minLength: 1, maxLength: 10 })
    .map(actions =>
      actions.map(action => ({
        action,
        reason: 'test exception',
        addedAt: '2024-01-01T00:00:00Z',
      })),
    );

  it('every exception action appears in the allow-list in intersection mode', () => {
    fc.assert(
      fc.property(
        regionSubsetArb.chain(selectedRegions => {
          return fc.tuple(
            fc.constant(selectedRegions),
            catalogDataArb(REGION_POOL),
            exceptionEntriesArb,
          );
        }),
        ([selectedRegions, catalog, exceptions]) => {
          const config = buildPolicyConfig(selectedRegions, 'intersection', exceptions);
          const result = computeAllowList({ catalogData: catalog, configuration: config });

          const resultSet = new Set(result.actions);

          // Every exception action must appear in the computed allow-list
          for (const exception of exceptions) {
            expect(resultSet.has(exception.action)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every exception action appears in the allow-list in union mode', () => {
    fc.assert(
      fc.property(
        regionSubsetArb.chain(selectedRegions => {
          return fc.tuple(
            fc.constant(selectedRegions),
            catalogDataArb(REGION_POOL),
            exceptionEntriesArb,
          );
        }),
        ([selectedRegions, catalog, exceptions]) => {
          const config = buildPolicyConfig(selectedRegions, 'union', exceptions);
          const result = computeAllowList({ catalogData: catalog, configuration: config });

          const resultSet = new Set(result.actions);

          // Every exception action must appear in the computed allow-list
          for (const exception of exceptions) {
            expect(resultSet.has(exception.action)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: policy-enforcer, Property 9: Allow-list output invariants
 * Validates: Requirements 14.1, 14.2, 6.6
 */
describe('Feature: policy-enforcer, Property 9: Allow-list output invariants', () => {
  /** Generator for a valid mode. */
  const modeArb = fc.constantFrom('intersection' as const, 'union' as const);

  /** Generator for exception entries using valid action format. */
  const exceptionEntriesArb = fc.array(
    fc.tuple(sdkServiceNameArb, apiActionArb).map(([svc, action]) => ({
      action: `${svc}:${action}`,
      reason: 'test exception',
      addedAt: '2024-01-01T00:00:00Z',
    })),
    { minLength: 0, maxLength: 5 },
  );

  it('the actions array is sorted alphabetically (each element <= next element)', () => {
    fc.assert(
      fc.property(
        regionSubsetArb.chain(selectedRegions =>
          fc.tuple(
            fc.constant(selectedRegions),
            catalogDataArb(REGION_POOL),
            modeArb,
            exceptionEntriesArb,
          ),
        ),
        ([selectedRegions, catalog, mode, exceptions]) => {
          const config = buildPolicyConfig(selectedRegions, mode, exceptions);
          const result = computeAllowList({ catalogData: catalog, configuration: config });

          // Assert sorted alphabetically
          for (let i = 0; i < result.actions.length - 1; i++) {
            expect(result.actions[i] <= result.actions[i + 1]).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('the actions array has no duplicates (Set size equals array length)', () => {
    fc.assert(
      fc.property(
        regionSubsetArb.chain(selectedRegions =>
          fc.tuple(
            fc.constant(selectedRegions),
            catalogDataArb(REGION_POOL),
            modeArb,
            exceptionEntriesArb,
          ),
        ),
        ([selectedRegions, catalog, mode, exceptions]) => {
          const config = buildPolicyConfig(selectedRegions, mode, exceptions);
          const result = computeAllowList({ catalogData: catalog, configuration: config });

          // Assert no duplicates
          const uniqueActions = new Set(result.actions);
          expect(uniqueActions.size).toBe(result.actions.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('computing the allow-list again with identical inputs produces identical output (determinism)', () => {
    fc.assert(
      fc.property(
        regionSubsetArb.chain(selectedRegions =>
          fc.tuple(
            fc.constant(selectedRegions),
            catalogDataArb(REGION_POOL),
            modeArb,
            exceptionEntriesArb,
          ),
        ),
        ([selectedRegions, catalog, mode, exceptions]) => {
          const config = buildPolicyConfig(selectedRegions, mode, exceptions);
          const input = { catalogData: catalog, configuration: config };

          const result1 = computeAllowList(input);
          const result2 = computeAllowList(input);

          // Assert deterministic output
          expect(result1).toEqual(result2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
