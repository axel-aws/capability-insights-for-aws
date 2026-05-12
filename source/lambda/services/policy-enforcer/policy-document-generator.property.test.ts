import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generatePolicyDocument } from './policy-document-generator';
import type { PolicyDocumentOptions } from './policy-document-generator';

// --- Generators ---

/** Generator for a valid IAM action string in the format "service:Action". */
const iamActionArb = fc
  .tuple(
    fc.stringMatching(/^[a-z][a-z0-9]{1,14}$/, { minLength: 2, maxLength: 15 }),
    fc.stringMatching(/^[A-Z][a-zA-Z0-9]{0,14}$/, { minLength: 1, maxLength: 15 }),
  )
  .map(([service, action]) => `${service}:${action}`);

/** Generator for a non-empty action list with 1-50 actions (small to moderate). */
const smallActionListArb = fc.array(iamActionArb, { minLength: 1, maxLength: 50 });

/** Generator for a larger action list with 50-200 actions. */
const largeActionListArb = fc.array(iamActionArb, { minLength: 50, maxLength: 200 });

/** Generator for policy type: IAM or SCP. */
const policyTypeArb = fc.constantFrom('IAM' as const, 'SCP' as const);

/** Generator for an ISO 8601 timestamp string (avoids fc.date shrinking issues). */
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

// --- Property Tests ---

/**
 * Feature: policy-enforcer, Property 6: Generated policy document has valid structure
 * Validates: Requirements 4.1, 4.2, 4.4, 5.2, 5.4
 */
describe('Feature: policy-enforcer, Property 6: Generated policy document has valid structure', () => {
  it('generated policy documents have Version "2012-10-17", at least one Statement with Effect "Deny", NotAction array, Resource "*", and Sid containing sanitized timestamp (small action lists)', () => {
    fc.assert(
      fc.property(
        smallActionListArb,
        policyTypeArb,
        timestampArb,
        policyNameArb,
        (actions, policyType, timestamp, policyName) => {
          const options: PolicyDocumentOptions = {
            allowList: actions,
            policyType,
            policyName,
            generationTimestamp: timestamp,
          };

          const result = generatePolicyDocument(options);

          // The sanitized timestamp is the timestamp with all non-alphanumeric chars removed
          const sanitizedTimestamp = timestamp.replace(/[^a-zA-Z0-9]/g, '');

          // Assert for each document in the result
          for (const document of result.documents) {
            // Version must be "2012-10-17"
            expect(document.Version).toBe('2012-10-17');

            // At least one Statement must exist
            expect(document.Statement.length).toBeGreaterThanOrEqual(1);

            for (const statement of document.Statement) {
              // Each Statement has Effect "Deny"
              expect(statement.Effect).toBe('Deny');

              // Each Statement has a NotAction array (non-empty since we have non-empty action list)
              expect(Array.isArray(statement.NotAction)).toBe(true);
              expect(statement.NotAction.length).toBeGreaterThan(0);

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

  it('generated policy documents have valid structure with larger action lists', () => {
    fc.assert(
      fc.property(
        largeActionListArb,
        policyTypeArb,
        timestampArb,
        policyNameArb,
        (actions, policyType, timestamp, policyName) => {
          const options: PolicyDocumentOptions = {
            allowList: actions,
            policyType,
            policyName,
            generationTimestamp: timestamp,
          };

          const result = generatePolicyDocument(options);

          // The sanitized timestamp is the timestamp with all non-alphanumeric chars removed
          const sanitizedTimestamp = timestamp.replace(/[^a-zA-Z0-9]/g, '');

          // If SCP exceeds limit, an error is returned but the document is still present
          // We still validate the document structure regardless
          for (const document of result.documents) {
            // Version must be "2012-10-17"
            expect(document.Version).toBe('2012-10-17');

            // At least one Statement must exist
            expect(document.Statement.length).toBeGreaterThanOrEqual(1);

            for (const statement of document.Statement) {
              // Each Statement has Effect "Deny"
              expect(statement.Effect).toBe('Deny');

              // Each Statement has a NotAction array (non-empty)
              expect(Array.isArray(statement.NotAction)).toBe(true);
              expect(statement.NotAction.length).toBeGreaterThan(0);

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
});

/**
 * Feature: policy-enforcer, Property 7: Policy size limits are enforced
 * Validates: Requirements 4.3, 5.3
 */
describe('Feature: policy-enforcer, Property 7: Policy size limits are enforced', () => {
  /** Generator for action lists of varying sizes (1 to 500+ actions). */
  const varyingSizeActionListArb = fc
    .integer({ min: 1, max: 600 })
    .chain(size =>
      fc.array(iamActionArb, { minLength: size, maxLength: size }),
    );

  it('IAM policy documents never exceed 6,144 characters each', () => {
    fc.assert(
      fc.property(
        varyingSizeActionListArb,
        timestampArb,
        policyNameArb,
        (actions, timestamp, policyName) => {
          const options: PolicyDocumentOptions = {
            allowList: actions,
            policyType: 'IAM',
            policyName,
            generationTimestamp: timestamp,
          };

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

  it('SCP returns error if document would exceed 5,120 characters', () => {
    fc.assert(
      fc.property(
        varyingSizeActionListArb,
        timestampArb,
        policyNameArb,
        (actions, timestamp, policyName) => {
          const options: PolicyDocumentOptions = {
            allowList: actions,
            policyType: 'SCP',
            policyName,
            generationTimestamp: timestamp,
          };

          const result = generatePolicyDocument(options);

          // There is always exactly one document for SCP
          const docSize = JSON.stringify(result.documents[0]).length;

          if (docSize > 5120) {
            // If the document exceeds 5,120 chars, error must be set
            expect(result.error).toBeDefined();
            expect(result.error).not.toBeUndefined();
          } else {
            // If the document is within limits, error must be undefined
            expect(result.error).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: policy-enforcer, Property 8: Policy document action round-trip
 * Validates: Requirements 4.5, 14.4
 */
describe('Feature: policy-enforcer, Property 8: Policy document action round-trip', () => {
  /** Generator for a sorted, deduplicated action list (mimics computeAllowList output). */
  const sortedDeduplicatedActionListArb = fc
    .array(iamActionArb, { minLength: 1, maxLength: 300 })
    .map(actions => [...new Set(actions)].sort());

  it('IAM policy round-trip: generating a policy document and extracting NotAction arrays produces the original allow-list', () => {
    fc.assert(
      fc.property(
        sortedDeduplicatedActionListArb,
        timestampArb,
        policyNameArb,
        (actions, timestamp, policyName) => {
          const options: PolicyDocumentOptions = {
            allowList: actions,
            policyType: 'IAM',
            policyName,
            generationTimestamp: timestamp,
          };

          const result = generatePolicyDocument(options);

          // Extract NotAction arrays from all documents (may be split)
          const extractedActions: string[] = [];
          for (const document of result.documents) {
            const parsed = JSON.parse(JSON.stringify(document));
            for (const statement of parsed.Statement) {
              extractedActions.push(...statement.NotAction);
            }
          }

          // Sort the flattened list
          const sortedExtracted = [...extractedActions].sort();

          // Assert the round-trip: extracted sorted list equals original allow-list
          expect(sortedExtracted).toEqual(actions);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('SCP policy round-trip: generating a policy document and extracting NotAction arrays produces the original allow-list', () => {
    // Use a simple string-based timestamp to avoid date shrinking issues
    const safeTimestampArb = fc
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

    fc.assert(
      fc.property(
        sortedDeduplicatedActionListArb,
        safeTimestampArb,
        policyNameArb,
        (actions, timestamp, policyName) => {
          const options: PolicyDocumentOptions = {
            allowList: actions,
            policyType: 'SCP',
            policyName,
            generationTimestamp: timestamp,
          };

          const result = generatePolicyDocument(options);

          // SCP always produces a single document (even if it has an error, the document still contains the full list)
          const extractedActions: string[] = [];
          for (const document of result.documents) {
            const parsed = JSON.parse(JSON.stringify(document));
            for (const statement of parsed.Statement) {
              extractedActions.push(...statement.NotAction);
            }
          }

          // Sort the flattened list
          const sortedExtracted = [...extractedActions].sort();

          // Assert the round-trip: extracted sorted list equals original allow-list
          expect(sortedExtracted).toEqual(actions);
        },
      ),
      { numRuns: 100 },
    );
  });
});
