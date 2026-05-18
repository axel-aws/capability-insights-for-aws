import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseJavaFile } from './java-sdk-parser';

/**
 * Property 1: Java SDK pattern extraction
 *
 * For any content with `I.M(` where I ends in `Client` and M is valid
 * (≥ 3 characters, not in the exclusion list), normalized M appears in output.
 *
 * **Validates: Requirements 1.2, 1.3**
 */

/** Non-API methods that should be filtered out by the parser. */
const EXCLUDED_METHODS = ['create', 'builder', 'build', 'close', 'serviceClientConfiguration', 'serviceName', 'waiter'];

/**
 * Generator for valid Java identifiers ending with "Client".
 * Produces identifiers like "s3Client", "dynamoDbClient", "S3Client", "LambdaClient".
 */
const clientIdentifierArb = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9]{0,10}$/)
  .map((prefix) => `${prefix}Client`);

/**
 * Generator for valid camelCase method names that are NOT in the exclusion list
 * and are at least 3 characters long.
 */
const validMethodNameArb = fc
  .stringMatching(/^[a-z][a-zA-Z]{2,15}$/)
  .filter((name) => !EXCLUDED_METHODS.includes(name) && name.length >= 3);

/**
 * Converts a camelCase method name to PascalCase (same logic as the parser).
 */
function camelToPascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

describe('Feature: multi-language-sdk-extraction, Property 1: Java SDK pattern extraction', () => {
  it('for any content with I.M( where I ends in Client and M is valid, normalized M appears in output', () => {
    fc.assert(
      fc.property(
        clientIdentifierArb,
        validMethodNameArb,
        (clientId, methodName) => {
          const content = `${clientId}.${methodName}(request);`;
          const result = parseJavaFile(content);
          const expected = camelToPascal(methodName);
          expect(result).toContain(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('extracts multiple distinct method calls from the same content', () => {
    fc.assert(
      fc.property(
        clientIdentifierArb,
        fc.uniqueArray(validMethodNameArb, { minLength: 1, maxLength: 5 }),
        (clientId, methodNames) => {
          const content = methodNames
            .map((m) => `${clientId}.${m}(request);`)
            .join('\n');
          const result = parseJavaFile(content);

          for (const methodName of methodNames) {
            expect(result).toContain(camelToPascal(methodName));
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('excluded methods never appear in output regardless of client identifier', () => {
    const excludedMethodArb = fc.constantFrom(...EXCLUDED_METHODS);

    fc.assert(
      fc.property(
        clientIdentifierArb,
        excludedMethodArb,
        (clientId, excludedMethod) => {
          const content = `${clientId}.${excludedMethod}(request);`;
          const result = parseJavaFile(content);
          expect(result).not.toContain(camelToPascal(excludedMethod));
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 5: Normalization to PascalCase
 *
 * All output strings start with uppercase and contain only ASCII letters.
 *
 * **Validates: Requirements 6.1, 1.4**
 */
describe('Feature: multi-language-sdk-extraction, Property 5: Normalization to PascalCase', () => {
  it('all output strings start with an uppercase letter and contain only ASCII letters', () => {
    fc.assert(
      fc.property(
        clientIdentifierArb,
        fc.uniqueArray(validMethodNameArb, { minLength: 1, maxLength: 10 }),
        (clientId, methodNames) => {
          const content = methodNames
            .map((m) => `${clientId}.${m}(request);`)
            .join('\n');
          const result = parseJavaFile(content);

          for (const op of result) {
            // Starts with uppercase
            expect(op[0]).toMatch(/^[A-Z]$/);
            // Contains only ASCII letters
            expect(op).toMatch(/^[A-Za-z]+$/);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('output strings are never empty', () => {
    fc.assert(
      fc.property(
        clientIdentifierArb,
        validMethodNameArb,
        (clientId, methodName) => {
          const content = `${clientId}.${methodName}(request);`;
          const result = parseJavaFile(content);

          for (const op of result) {
            expect(op.length).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 6: Normalization idempotence
 *
 * Applying camelToPascal to already-PascalCase strings returns them unchanged.
 *
 * **Validates: Requirements 6.4**
 */
describe('Feature: multi-language-sdk-extraction, Property 6: Normalization idempotence', () => {
  /**
   * Generator for already-PascalCase strings (start with uppercase, only ASCII letters).
   */
  const pascalCaseArb = fc
    .stringMatching(/^[A-Z][a-zA-Z]{2,20}$/)
    .filter((s) => s.length >= 3);

  it('applying camelToPascal to already-PascalCase strings returns them unchanged', () => {
    fc.assert(
      fc.property(pascalCaseArb, (pascalName) => {
        const result = camelToPascal(pascalName);
        expect(result).toBe(pascalName);
      }),
      { numRuns: 100 },
    );
  });

  it('parsing content with PascalCase method names returns them unchanged', () => {
    fc.assert(
      fc.property(
        clientIdentifierArb,
        pascalCaseArb.filter((s) => !EXCLUDED_METHODS.includes(s) && !EXCLUDED_METHODS.includes(s.charAt(0).toLowerCase() + s.slice(1))),
        (clientId, pascalMethod) => {
          const content = `${clientId}.${pascalMethod}(request);`;
          const result = parseJavaFile(content);
          // PascalCase input should appear unchanged in output
          expect(result).toContain(pascalMethod);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 8: Output format invariant
 *
 * Output is sorted, deduplicated, and all entries are valid PascalCase.
 *
 * **Validates: Requirements 7.4, 1.6**
 */
describe('Feature: multi-language-sdk-extraction, Property 8: Output format invariant', () => {
  /**
   * Generator for arbitrary Java-like source content with multiple SDK calls.
   */
  const javaContentArb = fc
    .array(
      fc.tuple(clientIdentifierArb, validMethodNameArb),
      { minLength: 1, maxLength: 15 },
    )
    .map((pairs) =>
      pairs.map(([client, method]) => `${client}.${method}(request);`).join('\n'),
    );

  it('output array is sorted in ascending lexicographic order', () => {
    fc.assert(
      fc.property(javaContentArb, (content) => {
        const result = parseJavaFile(content);

        for (let i = 1; i < result.length; i++) {
          expect(result[i - 1] <= result[i]).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('output array contains no duplicate entries', () => {
    fc.assert(
      fc.property(javaContentArb, (content) => {
        const result = parseJavaFile(content);
        const uniqueResult = [...new Set(result)];
        expect(result).toEqual(uniqueResult);
      }),
      { numRuns: 100 },
    );
  });

  it('all entries are valid PascalCase (start with uppercase, only ASCII letters)', () => {
    fc.assert(
      fc.property(javaContentArb, (content) => {
        const result = parseJavaFile(content);

        for (const entry of result) {
          // Starts with uppercase letter
          expect(entry[0]).toMatch(/^[A-Z]$/);
          // Contains only ASCII letters
          expect(entry).toMatch(/^[A-Za-z]+$/);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('output is empty array for empty or whitespace-only input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 20 }).map((chars) => chars.join('')),
        (whitespace) => {
          const result = parseJavaFile(whitespace);
          expect(result).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 9: Parser determinism
 *
 * Same input always produces same output.
 *
 * **Validates: Requirements 7.6**
 */
describe('Feature: multi-language-sdk-extraction, Property 9: Parser determinism', () => {
  /**
   * Generator for arbitrary strings that may or may not contain Java SDK patterns.
   */
  const arbitraryContentArb = fc.oneof(
    // Content with valid SDK patterns
    fc
      .array(
        fc.tuple(clientIdentifierArb, validMethodNameArb),
        { minLength: 1, maxLength: 10 },
      )
      .map((pairs) =>
        pairs.map(([client, method]) => `${client}.${method}(request);`).join('\n'),
      ),
    // Random strings that may not contain patterns
    fc.string({ minLength: 0, maxLength: 200 }),
    // Empty/whitespace
    fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 20 }).map((chars) => chars.join('')),
  );

  it('invoking parseJavaFile twice with identical input produces identical output', () => {
    fc.assert(
      fc.property(arbitraryContentArb, (content) => {
        const result1 = parseJavaFile(content);
        const result2 = parseJavaFile(content);
        expect(result1).toEqual(result2);
      }),
      { numRuns: 100 },
    );
  });
});
