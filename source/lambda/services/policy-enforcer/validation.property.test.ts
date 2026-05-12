import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateExceptionEntry } from './validation';

/**
 * Feature: policy-enforcer, Property 10: Exception entry format validation
 * Validates: Requirements 6.3
 */
describe('Feature: policy-enforcer, Property 10: Exception entry format validation', () => {
  const EXCEPTION_ENTRY_REGEX = /^[a-zA-Z0-9-]+:(([A-Z][a-zA-Z0-9]*)|(\*))$/;

  // Generator for valid service prefixes: alphanumeric + hyphens, non-empty
  const validServicePrefixArb = fc.stringMatching(/^[a-zA-Z0-9-]+$/, { minLength: 1, maxLength: 30 });

  // Generator for valid PascalCase action names: starts with uppercase letter, followed by alphanumeric
  const validPascalCaseActionArb = fc
    .tuple(
      fc.stringMatching(/^[A-Z]$/, { minLength: 1, maxLength: 1 }),
      fc.stringMatching(/^[a-zA-Z0-9]*$/, { minLength: 0, maxLength: 29 }),
    )
    .map(([first, rest]) => first + rest);

  // Generator for valid wildcard action
  const validWildcardActionArb = fc.constant('*');

  // Generator for valid action (either PascalCase or wildcard)
  const validActionArb = fc.oneof(validPascalCaseActionArb, validWildcardActionArb);

  // Generator for valid exception entries: "servicePrefix:Action" or "servicePrefix:*"
  const validExceptionEntryArb = fc
    .tuple(validServicePrefixArb, validActionArb)
    .map(([prefix, action]) => `${prefix}:${action}`);

  // Generator for invalid entries: various patterns that don't match the regex
  const invalidExceptionEntryArb = fc.oneof(
    // Empty string
    fc.constant(''),
    // Missing colon (just alphanumeric)
    fc.stringMatching(/^[a-zA-Z0-9-]+$/, { minLength: 1, maxLength: 20 }),
    // Lowercase action (starts with lowercase after colon)
    fc
      .tuple(
        validServicePrefixArb,
        fc
          .tuple(
            fc.stringMatching(/^[a-z]$/, { minLength: 1, maxLength: 1 }),
            fc.stringMatching(/^[a-zA-Z0-9]*$/, { minLength: 1, maxLength: 10 }),
          )
          .map(([first, rest]) => first + rest),
      )
      .map(([prefix, action]) => `${prefix}:${action}`),
    // Empty action (colon at end with nothing after)
    validServicePrefixArb.map(prefix => `${prefix}:`),
    // Empty prefix (colon at start)
    validActionArb.map(action => `:${action}`),
    // Action starting with a digit after colon
    fc
      .tuple(validServicePrefixArb, fc.stringMatching(/^[0-9][a-zA-Z0-9]*$/, { minLength: 1, maxLength: 10 }))
      .map(([prefix, action]) => `${prefix}:${action}`),
    // Contains spaces
    fc
      .tuple(validServicePrefixArb, validActionArb)
      .map(([prefix, action]) => `${prefix} : ${action}`),
    // Multiple colons
    fc
      .tuple(validServicePrefixArb, validServicePrefixArb, validActionArb)
      .map(([p1, p2, action]) => `${p1}:${p2}:${action}`),
  );

  it('accepts all valid exception entry strings matching the regex pattern', () => {
    fc.assert(
      fc.property(validExceptionEntryArb, entry => {
        // Sanity check: our generator produces strings that match the regex
        expect(EXCEPTION_ENTRY_REGEX.test(entry)).toBe(true);

        // The function should accept valid entries
        expect(validateExceptionEntry(entry)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects all invalid exception entry strings that do not match the regex pattern', () => {
    fc.assert(
      fc.property(invalidExceptionEntryArb, entry => {
        // Sanity check: our generator produces strings that do NOT match the regex
        expect(EXCEPTION_ENTRY_REGEX.test(entry)).toBe(false);

        // The function should reject invalid entries
        expect(validateExceptionEntry(entry)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('validateExceptionEntry returns true if and only if the string matches the regex', () => {
    fc.assert(
      fc.property(
        fc.oneof(validExceptionEntryArb, invalidExceptionEntryArb, fc.string({ minLength: 0, maxLength: 50 })),
        entry => {
          const matchesRegex = EXCEPTION_ENTRY_REGEX.test(entry);
          const functionResult = validateExceptionEntry(entry);

          // The function should return true iff the regex matches
          expect(functionResult).toBe(matchesRegex);
        },
      ),
      { numRuns: 100 },
    );
  });
});
