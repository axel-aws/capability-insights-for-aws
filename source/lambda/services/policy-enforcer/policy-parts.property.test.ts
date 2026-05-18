import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  computePartsSummary,
  countStatementItems,
  groupActionsByService,
  computeNextRefresh,
  generateMultiPolicyCdkSnippet,
  generateMultiPolicyCfnSnippet,
  buildDeleteConfirmationArns,
  buildPartialFailureReport,
  derivePolicyParts,
} from './policy-parts-utils';
import type {
  PolicyConfiguration,
  PolicyPart,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

// --- Generators ---

/** Generator for a valid IAM ARN. */
const arnArb = fc
  .tuple(
    fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'),
    fc.stringMatching(/^[0-9]{12}$/, { minLength: 12, maxLength: 12 }),
    fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,19}$/, { minLength: 1, maxLength: 20 }),
  )
  .map(([region, account, name]) => `arn:aws:iam::${account}:policy/${name}`);

/** Generator for a non-negative document size. */
const documentSizeArb = fc.integer({ min: 0, max: 6144 });

/** Generator for a non-negative statement item count. */
const statementItemCountArb = fc.integer({ min: 0, max: 500 });

/** Generator for a PolicyPart. */
const policyPartArb: fc.Arbitrary<PolicyPart> = fc
  .tuple(
    fc.integer({ min: 0, max: 20 }),
    arnArb,
    fc.constantFrom('blanket-deny' as const, 'specific-api-deny' as const),
    documentSizeArb,
    statementItemCountArb,
  )
  .map(([partIndex, arn, partType, documentSize, statementItemCount]) => ({
    partIndex,
    arn,
    partType,
    documentSize,
    statementItemCount,
  }));

/** Generator for a non-empty array of PolicyParts. */
const policyPartsArb = fc.array(policyPartArb, { minLength: 0, maxLength: 10 });

/** Generator for a valid service prefix (lowercase). */
const servicePrefixArb = fc.stringMatching(/^[a-z][a-z0-9]{1,14}$/, { minLength: 2, maxLength: 15 });

/** Generator for a valid action name (PascalCase). */
const actionNameArb = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{0,14}$/, { minLength: 1, maxLength: 15 });

/** Generator for a full IAM action string (service:ActionName). */
const iamActionArb = fc
  .tuple(servicePrefixArb, actionNameArb)
  .map(([prefix, action]) => `${prefix}:${action}`);

/** Generator for a non-empty array of IAM actions. */
const iamActionsArb = fc.array(iamActionArb, { minLength: 1, maxLength: 30 });

/** Generator for an ISO 8601 timestamp. */
const isoTimestampArb = fc
  .tuple(
    fc.integer({ min: 2020, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 0, max: 23 }),
    fc.integer({ min: 0, max: 59 }),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(([y, m, d, h, min, s]) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`,
  );

/** Generator for a positive refresh interval in hours. */
const refreshIntervalArb = fc.integer({ min: 1, max: 168 });

/** Generator for a policy name. */
const policyNameArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{0,19}$/, { minLength: 1, maxLength: 20 });

/** Generator for a PolicyConfiguration with optional ARNs. */
const policyConfigArb: fc.Arbitrary<PolicyConfiguration> = fc
  .tuple(
    policyNameArb,
    fc.option(arnArb, { nil: undefined }),
    fc.option(fc.array(arnArb, { minLength: 1, maxLength: 5 }), { nil: undefined }),
  )
  .map(([policyName, policyArn, additionalPolicyArns]) => ({
    policyId: 'test-id',
    policyName,
    tags: [],
    regions: ['us-east-1'],
    mode: 'intersection' as const,
    policyType: 'IAM' as const,
    exceptions: [],
    refreshIntervalHours: 24,
    status: 'active' as const,
    policyArn,
    additionalPolicyArns,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }));

/** Generator for an IAM policy document with Statement array. */
const policyDocumentArb = fc
  .array(
    fc.oneof(
      // Statement with NotAction
      fc.array(iamActionArb, { minLength: 1, maxLength: 20 }).map(actions => ({
        Effect: 'Deny',
        NotAction: actions,
        Resource: '*',
      })),
      // Statement with Action
      fc.array(iamActionArb, { minLength: 1, maxLength: 20 }).map(actions => ({
        Effect: 'Deny',
        Action: actions,
        Resource: '*',
      })),
    ),
    { minLength: 1, maxLength: 3 },
  )
  .map(statements => ({
    Version: '2012-10-17',
    Statement: statements,
  }));

// --- Property Tests ---

/**
 * Feature: policy-enforcer-ux, Property 1: computePartsSummary correctness
 * Validates: Requirements 1.3
 */
describe('Feature: policy-enforcer-ux, Property 1: computePartsSummary correctness', () => {
  it('totalParts equals array length and combinedSize equals sum of documentSize values', () => {
    fc.assert(
      fc.property(policyPartsArb, (parts) => {
        const result = computePartsSummary(parts);

        expect(result.totalParts).toBe(parts.length);
        expect(result.combinedSize).toBe(
          parts.reduce((sum, p) => sum + p.documentSize, 0),
        );
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer-ux, Property 2: countStatementItems matches array length
 * Validates: Requirements 1.5, 1.6
 */
describe('Feature: policy-enforcer-ux, Property 2: countStatementItems matches array length', () => {
  it('reported count equals the total number of items across all NotAction and Action arrays', () => {
    fc.assert(
      fc.property(policyDocumentArb, (document) => {
        const result = countStatementItems(document);

        // Manually compute expected count
        let expected = 0;
        for (const statement of document.Statement as Array<Record<string, unknown>>) {
          if (Array.isArray(statement.NotAction)) {
            expected += statement.NotAction.length;
          } else if (Array.isArray(statement.Action)) {
            expected += statement.Action.length;
          }
        }

        expect(result).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer-ux, Property 3: snippet generation includes all ARNs
 * Validates: Requirements 2.2, 2.3, 2.4
 */
describe('Feature: policy-enforcer-ux, Property 3: snippet generation includes all ARNs', () => {
  it('CDK snippet contains every ARN from the input array', () => {
    fc.assert(
      fc.property(
        fc.array(arnArb, { minLength: 1, maxLength: 10 }),
        policyNameArb,
        (arns, policyName) => {
          const snippet = generateMultiPolicyCdkSnippet(arns, policyName);

          for (const arn of arns) {
            expect(snippet).toContain(arn);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('CloudFormation snippet contains every ARN from the input array', () => {
    fc.assert(
      fc.property(
        fc.array(arnArb, { minLength: 1, maxLength: 10 }),
        (arns) => {
          const snippet = generateMultiPolicyCfnSnippet(arns);

          for (const arn of arns) {
            expect(snippet).toContain(arn);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer-ux, Property 4: groupActionsByService preserves all actions and groups correctly
 * Validates: Requirements 3.1
 */
describe('Feature: policy-enforcer-ux, Property 4: groupActionsByService preserves all actions and groups correctly', () => {
  it('every action in a group shares the same service prefix and the union of all actions equals the original input set', () => {
    fc.assert(
      fc.property(iamActionsArb, (actions) => {
        const groups = groupActionsByService(actions);

        // Reconstruct all actions from groups
        const reconstructed: string[] = [];
        for (const group of groups) {
          for (const action of group.actions) {
            reconstructed.push(`${group.servicePrefix}:${action}`);
          }
        }

        // The reconstructed set should equal the original input set (as multisets)
        expect(reconstructed.sort()).toEqual([...actions].sort());
      }),
      { numRuns: 100 },
    );
  });

  it('groups are sorted by servicePrefix', () => {
    fc.assert(
      fc.property(iamActionsArb, (actions) => {
        const groups = groupActionsByService(actions);

        for (let i = 0; i < groups.length - 1; i++) {
          expect(groups[i].servicePrefix.localeCompare(groups[i + 1].servicePrefix)).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer-ux, Property 5: computeNextRefresh adds exact interval
 * Validates: Requirements 4.2
 */
describe('Feature: policy-enforcer-ux, Property 5: computeNextRefresh adds exact interval', () => {
  it('next refresh time equals input timestamp plus exactly the interval in milliseconds', () => {
    fc.assert(
      fc.property(isoTimestampArb, refreshIntervalArb, (timestamp, intervalHours) => {
        const result = computeNextRefresh(timestamp, intervalHours);

        const lastMs = new Date(timestamp).getTime();
        const expectedMs = lastMs + intervalHours * 60 * 60 * 1000;
        const resultMs = new Date(result).getTime();

        expect(resultMs).toBe(expectedMs);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer-ux, Property 6: buildDeleteConfirmationArns includes all ARNs without duplicates
 * Validates: Requirements 5.1
 */
describe('Feature: policy-enforcer-ux, Property 6: buildDeleteConfirmationArns includes all ARNs without duplicates', () => {
  it('result contains all ARNs from primary and additional without duplicates', () => {
    fc.assert(
      fc.property(policyConfigArb, (policy) => {
        const result = buildDeleteConfirmationArns(policy);

        // No duplicates
        expect(result.length).toBe(new Set(result).size);

        // Contains primary ARN if present
        if (policy.policyArn) {
          expect(result).toContain(policy.policyArn);
        }

        // Contains all additional ARNs if present
        if (policy.additionalPolicyArns) {
          for (const arn of policy.additionalPolicyArns) {
            expect(result).toContain(arn);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer-ux, Property 7: partial failure reporting covers full ARN set
 * Validates: Requirements 5.3
 */
describe('Feature: policy-enforcer-ux, Property 7: partial failure reporting covers full ARN set', () => {
  it('union of deletedArns and failedArns equals the original ARN set', () => {
    fc.assert(
      fc.property(
        fc.array(arnArb, { minLength: 1, maxLength: 10 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        (arns, successes) => {
          // Build results matching arns length
          const results = arns.map((arn, i) => ({
            arn,
            success: successes[i % successes.length],
            error: successes[i % successes.length] ? undefined : 'Delete failed',
          }));

          const report = buildPartialFailureReport(arns, results);

          // Union of deleted and failed should cover all ARNs
          const allReported = [
            ...report.deletedArns,
            ...report.failedArns.map(f => f.arn),
          ];
          expect(allReported.sort()).toEqual([...arns].sort());

          // success flag should be true only if no failures
          expect(report.success).toBe(report.failedArns.length === 0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: policy-enforcer-ux, Property 8: parts derivation produces correct count and types
 * Validates: Requirements 6.1
 */
describe('Feature: policy-enforcer-ux, Property 8: parts derivation produces correct count and types', () => {
  it('derived parts have correct count, valid ARNs, and correct part types', () => {
    fc.assert(
      fc.property(policyConfigArb, (policy) => {
        const parts = derivePolicyParts(policy);
        const expectedArns = buildDeleteConfirmationArns(policy);

        // Correct count
        expect(parts.length).toBe(expectedArns.length);

        // Each part has a valid ARN from the config
        for (const part of parts) {
          expect(expectedArns).toContain(part.arn);
        }

        // First part (if exists) is blanket-deny, rest are specific-api-deny
        if (parts.length > 0) {
          expect(parts[0].partType).toBe('blanket-deny');
        }
        for (let i = 1; i < parts.length; i++) {
          expect(parts[i].partType).toBe('specific-api-deny');
        }

        // All document sizes are non-negative
        for (const part of parts) {
          expect(part.documentSize).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
