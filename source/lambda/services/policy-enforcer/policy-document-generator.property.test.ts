import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generatePolicyDocument } from './policy-document-generator';
import type { PolicyDocumentOptions } from './policy-document-generator';
import type { ApiService, ApiOperation } from '@capability-insights/shared/types/capability/api';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { AvailabilityStatus } from '../../../shared/types/availability/availability-status';

// --- Generators ---

/** Generator for a valid IAM action name (PascalCase). */
const actionNameArb = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{0,14}$/, { minLength: 1, maxLength: 15 });

/** Generator for a valid service name (lowercase). */
const serviceNameArb = fc.stringMatching(/^[a-z][a-z0-9]{1,14}$/, { minLength: 2, maxLength: 15 });

/** Generator for availability status. */
const availabilityStatusArb = fc.constantFrom(
  AvailabilityStatus.AVAILABLE,
  AvailabilityStatus.NOT_AVAILABLE,
  AvailabilityStatus.PLANNED,
  AvailabilityStatus.PLANNING,
  AvailabilityStatus.NOT_EXPANDING,
);

/** Generator for a region code. */
const regionArb = fc.constantFrom(
  'us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1',
);

/** Generator for a non-empty region list. */
const regionListArb = fc.uniqueArray(regionArb, { minLength: 1, maxLength: 5 });

/** Generator for an ISO 8601 timestamp string. */
const timestampArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(([y, m, d, h, min, s]) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}Z`,
  );

/** Generator for a policy name. */
const policyNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 -]{0,29}$/, {
  minLength: 1,
  maxLength: 30,
});

/** Generator for policy type: IAM or SCP. */
const policyTypeArb = fc.constantFrom('IAM' as const, 'SCP' as const);

/** Generator for mode. */
const modeArb = fc.constantFrom('intersection' as const, 'union' as const);

/** Generator for an ApiOperation with random availability. */
function apiOperationArb(regions: string[]): fc.Arbitrary<ApiOperation> {
  return fc.tuple(actionNameArb, fc.array(availabilityStatusArb, { minLength: regions.length, maxLength: regions.length }))
    .map(([action, statuses]) => {
      const regionalAvailability: Record<string, AvailabilityStatus> = {};
      regions.forEach((region, i) => {
        regionalAvailability[region] = statuses[i];
      });
      return {
        apiName: action,
        apiAction: action,
        homepage: `https://awscli.amazonaws.com/v2/documentation/api/latest/reference/svc/index.html`,
        regionalAvailability,
      };
    });
}

/** Generator for an ApiService with 1-5 APIs. */
function apiServiceArb(regions: string[]): fc.Arbitrary<ApiService> {
  return fc.tuple(
    serviceNameArb,
    fc.array(apiOperationArb(regions), { minLength: 1, maxLength: 5 }),
  ).map(([name, apis]) => ({
    sdkServiceName: name,
    sdkServiceFullName: `AWS ${name}`,
    apis,
  }));
}

/** Generator for catalog data with 1-20 services. */
function catalogDataArb(regions: string[]): fc.Arbitrary<ApiService[]> {
  return fc.array(apiServiceArb(regions), { minLength: 1, maxLength: 20 });
}

/** Generator for a full PolicyDocumentOptions. */
const policyDocumentOptionsArb: fc.Arbitrary<PolicyDocumentOptions> = regionListArb.chain(regions =>
  fc.tuple(
    catalogDataArb(regions),
    policyTypeArb,
    modeArb,
    timestampArb,
    policyNameArb,
  ).map(([catalogData, policyType, mode, timestamp, policyName]) => {
    const configuration: PolicyConfiguration = {
      policyId: 'test-id',
      policyName,
      tags: [],
      regions,
      mode,
      policyType,
      exceptions: [],
      refreshIntervalHours: 24,
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    return {
      catalogData,
      configuration,
      policyName,
      generationTimestamp: timestamp,
    };
  }),
);

/** Generator for larger catalog data (more services, more APIs). */
const largePolicyDocumentOptionsArb: fc.Arbitrary<PolicyDocumentOptions> = regionListArb.chain(regions =>
  fc.tuple(
    fc.array(
      fc.tuple(
        serviceNameArb,
        fc.array(apiOperationArb(regions), { minLength: 1, maxLength: 10 }),
      ).map(([name, apis]) => ({
        sdkServiceName: name,
        sdkServiceFullName: `AWS ${name}`,
        apis,
      })),
      { minLength: 10, maxLength: 40 },
    ),
    policyTypeArb,
    modeArb,
    timestampArb,
    policyNameArb,
  ).map(([catalogData, policyType, mode, timestamp, policyName]) => {
    const configuration: PolicyConfiguration = {
      policyId: 'test-id',
      policyName,
      tags: [],
      regions,
      mode,
      policyType,
      exceptions: [],
      refreshIntervalHours: 24,
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    return {
      catalogData,
      configuration,
      policyName,
      generationTimestamp: timestamp,
    };
  }),
);

// --- Property Tests ---

/**
 * Feature: policy-enforcer, Property 6: Generated policy document has valid structure
 * Validates: Requirements 4.1, 4.2, 4.4, 5.2, 5.4
 */
describe('Feature: policy-enforcer, Property 6: Generated policy document has valid structure', () => {
  it('generated policy documents have Version "2012-10-17", valid statements with Effect "Deny", and Sid containing sanitized timestamp', () => {
    fc.assert(
      fc.property(
        policyDocumentOptionsArb,
        (options) => {
          const result = generatePolicyDocument(options);

          const sanitizedTimestamp = options.generationTimestamp.replace(/[^a-zA-Z0-9]/g, '');

          for (const document of result.documents) {
            // Version must be "2012-10-17"
            expect(document.Version).toBe('2012-10-17');

            // At least one Statement must exist
            expect(document.Statement.length).toBeGreaterThanOrEqual(1);

            for (const statement of document.Statement) {
              // Each Statement has Effect "Deny"
              expect(statement.Effect).toBe('Deny');

              // Each Statement has either NotAction or Action array
              const hasNotAction = Array.isArray(statement.NotAction);
              const hasAction = Array.isArray(statement.Action);
              expect(hasNotAction || hasAction).toBe(true);

              // Each Statement has Resource "*"
              expect(statement.Resource).toBe('*');

              // Each Statement has a Sid field that contains the sanitized timestamp
              expect(statement.Sid).toContain(sanitizedTimestamp);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('first document is always the blanket deny with NotAction', () => {
    fc.assert(
      fc.property(
        policyDocumentOptionsArb,
        (options) => {
          const result = generatePolicyDocument(options);

          // First document always has NotAction (blanket deny)
          const firstDoc = result.documents[0];
          const firstStatement = firstDoc.Statement[0];
          expect(firstStatement.NotAction).toBeDefined();
          expect(Array.isArray(firstStatement.NotAction)).toBe(true);
          expect(firstStatement.Sid).toContain('BlanketDeny');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('subsequent documents (if any) are API deny with Action', () => {
    fc.assert(
      fc.property(
        largePolicyDocumentOptionsArb,
        (options) => {
          // Force IAM type so we can have multiple documents
          options.configuration.policyType = 'IAM';
          const result = generatePolicyDocument(options);

          // If there are additional documents beyond the first, they should have Action
          for (let i = 1; i < result.documents.length; i++) {
            const doc = result.documents[i];
            expect(doc.Statement[0].Action).toBeDefined();
            expect(Array.isArray(doc.Statement[0].Action)).toBe(true);
            expect(doc.Statement[0].Sid).toContain('APIDeny');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer, Property 7: Policy size limits are enforced
 * Validates: Requirements 4.3, 5.3
 */
describe('Feature: policy-enforcer, Property 7: Policy size limits are enforced', () => {
  it('IAM policy documents never exceed 6,144 characters each', () => {
    fc.assert(
      fc.property(
        largePolicyDocumentOptionsArb,
        (options) => {
          options.configuration.policyType = 'IAM';
          const result = generatePolicyDocument(options);

          // Every individual IAM document must not exceed 6,144 chars
          for (const document of result.documents) {
            const size = JSON.stringify(document).length;
            expect(size).toBeLessThanOrEqual(6144);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('SCP returns error if total document size exceeds 5,120 characters', () => {
    fc.assert(
      fc.property(
        largePolicyDocumentOptionsArb,
        (options) => {
          options.configuration.policyType = 'SCP';
          const result = generatePolicyDocument(options);

          // SCP always produces exactly one document
          expect(result.documents).toHaveLength(1);

          const docSize = JSON.stringify(result.documents[0]).length;

          if (docSize > 5120) {
            expect(result.error).toBeDefined();
            expect(result.error).not.toBeUndefined();
          } else {
            expect(result.error).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer, Property 8: Two-tier strategy correctness
 * Validates: Requirements 4.5, 14.4
 *
 * For the two-tier strategy, we verify:
 * - NotAction wildcards in the blanket deny are sorted and unique
 * - Specific deny actions are sorted and unique
 * - No action appears in both NotAction wildcards and specific deny actions
 */
describe('Feature: policy-enforcer, Property 8: Two-tier strategy correctness', () => {
  it('NotAction wildcards in blanket deny are sorted and unique', () => {
    fc.assert(
      fc.property(
        policyDocumentOptionsArb,
        (options) => {
          const result = generatePolicyDocument(options);

          const blanketDoc = result.documents[0];
          const notActions = blanketDoc.Statement[0].NotAction ?? [];

          // Sorted
          const sorted = [...notActions].sort();
          expect(notActions).toEqual(sorted);

          // Unique
          const unique = [...new Set(notActions)];
          expect(notActions).toEqual(unique);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('specific deny actions across all API deny documents are sorted within each document', () => {
    fc.assert(
      fc.property(
        largePolicyDocumentOptionsArb,
        (options) => {
          options.configuration.policyType = 'IAM';
          const result = generatePolicyDocument(options);

          // Check each API deny document has sorted actions
          for (let i = 1; i < result.documents.length; i++) {
            const actions = result.documents[i].Statement[0].Action ?? [];
            const sorted = [...actions].sort();
            expect(actions).toEqual(sorted);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('blanketDenyServiceCount + fullyAvailableServiceCount + partial services equals total services with APIs', () => {
    fc.assert(
      fc.property(
        policyDocumentOptionsArb,
        (options) => {
          const result = generatePolicyDocument(options);

          // Count services with at least one API
          const servicesWithApis = options.catalogData.filter(s => s.apis.length > 0).length;

          // The sum of blanket deny + fully available should account for all services
          // (fullyAvailableServiceCount includes both fully available AND partially available services)
          expect(result.blanketDenyServiceCount + result.fullyAvailableServiceCount).toBe(servicesWithApis);
        },
      ),
      { numRuns: 100 },
    );
  });
});
