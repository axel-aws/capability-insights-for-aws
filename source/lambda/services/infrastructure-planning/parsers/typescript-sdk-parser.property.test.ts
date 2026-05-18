import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseTypeScriptFile } from './typescript-sdk-parser';

// --- Shared Generators ---

/**
 * Generates a valid PascalCase operation name (at least 2 characters, starts with uppercase,
 * followed by one or more ASCII letters).
 */
const pascalCaseOpArb = fc
  .tuple(
    fc.stringMatching(/^[A-Z]$/),
    fc.stringMatching(/^[a-zA-Z]{1,15}$/)
  )
  .map(([first, rest]) => first + rest);

/**
 * Generates a valid camelCase method name (at least 3 characters, starts with lowercase,
 * followed by ASCII letters).
 */
const camelCaseMethodArb = fc
  .tuple(
    fc.stringMatching(/^[a-z]$/),
    fc.stringMatching(/^[a-zA-Z]{2,14}$/)
  )
  .map(([first, rest]) => first + rest);

/**
 * Known service prefixes for v2-style regex matching.
 */
const knownServicePrefixes = [
  's3',
  'dynamodb',
  'dynamoDb',
  'lambda',
  'sqs',
  'sns',
  'ec2',
  'iam',
  'sts',
  'cloudwatch',
  'cloudformation',
  'kinesis',
  'stepfunctions',
];

/**
 * Generates a known service prefix from the list.
 */
const servicePrefixArb = fc.constantFrom(...knownServicePrefixes);

/**
 * Generates an optional Client/client suffix.
 */
const clientSuffixArb = fc.constantFrom('', 'Client', 'client');

// --- Property 3 Tests ---

/**
 * Property 3: TypeScript v3 Command pattern extraction
 *
 * For any content with `new {Op}Command(` where Op is valid PascalCase ≥ 2 chars,
 * Op appears in output.
 *
 * **Validates: Requirements 3.2, 3.3**
 */
describe('Feature: multi-language-sdk-extraction, Property 3: TypeScript v3 Command pattern extraction', () => {
  it('extracts operation name from v3 Command pattern instantiation', () => {
    fc.assert(
      fc.property(pascalCaseOpArb, (opName) => {
        const content = `const result = await client.send(new ${opName}Command(params));`;
        const result = parseTypeScriptFile(content);

        // The operation name (without Command suffix) should appear in output
        // Only if the normalized name is >= 3 chars (parser filters < 3)
        if (opName.length >= 3) {
          expect(result).toContain(opName);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('extracts operation name from standalone new Command pattern', () => {
    fc.assert(
      fc.property(pascalCaseOpArb, (opName) => {
        const content = `new ${opName}Command({ TableName: 'my-table' });`;
        const result = parseTypeScriptFile(content);

        if (opName.length >= 3) {
          expect(result).toContain(opName);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// --- Property 4 Tests ---

/**
 * Property 4: TypeScript v2-style extraction
 *
 * For any content with known service prefix variable calling a method,
 * normalized method appears in output.
 *
 * **Validates: Requirements 3.4**
 */
describe('Feature: multi-language-sdk-extraction, Property 4: TypeScript v2-style extraction', () => {
  it('extracts and normalizes method calls on known service prefix variables', () => {
    fc.assert(
      fc.property(
        servicePrefixArb,
        clientSuffixArb,
        camelCaseMethodArb,
        (prefix, suffix, method) => {
          const varName = prefix + suffix;
          const content = `const result = ${varName}.${method}(params);`;
          const result = parseTypeScriptFile(content);

          // The method should be normalized to PascalCase (first letter uppercased)
          const expected = method.charAt(0).toUpperCase() + method.slice(1);

          expect(result).toContain(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 5 Tests ---

/**
 * Property 5: Normalization to PascalCase
 *
 * All output strings start with uppercase and contain only ASCII letters.
 *
 * **Validates: Requirements 6.1**
 */
describe('Feature: multi-language-sdk-extraction, Property 5: Normalization to PascalCase', () => {
  it('all output entries start with uppercase and contain only ASCII letters', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // v3 Command pattern content
          pascalCaseOpArb.map(
            (op) => `new ${op}Command(params);`
          ),
          // v2-style content
          fc.tuple(servicePrefixArb, clientSuffixArb, camelCaseMethodArb).map(
            ([prefix, suffix, method]) => `${prefix}${suffix}.${method}(params);`
          )
        ),
        (content) => {
          const result = parseTypeScriptFile(content);

          for (const entry of result) {
            // Starts with uppercase
            expect(entry[0]).toMatch(/^[A-Z]$/);
            // Contains only ASCII letters
            expect(entry).toMatch(/^[A-Za-z]+$/);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 6 Tests ---

/**
 * Property 6: Normalization idempotence
 *
 * Applying normalization to already-PascalCase strings returns them unchanged.
 *
 * **Validates: Requirements 6.4**
 */
describe('Feature: multi-language-sdk-extraction, Property 6: Normalization idempotence', () => {
  it('PascalCase operation names in v3 Command pattern are preserved unchanged', () => {
    fc.assert(
      fc.property(pascalCaseOpArb, (opName) => {
        // If we use a PascalCase name in a v3 Command pattern, the output should be
        // the same PascalCase name (since it's already normalized)
        const content = `new ${opName}Command(params);`;
        const result = parseTypeScriptFile(content);

        if (opName.length >= 3) {
          expect(result).toContain(opName);
          // Parsing the output again through a v3 pattern should yield the same result
          const secondContent = `new ${opName}Command(params);`;
          const secondResult = parseTypeScriptFile(secondContent);
          expect(secondResult).toEqual(result);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('already-PascalCase method names in v2 pattern are unchanged after normalization', () => {
    fc.assert(
      fc.property(
        servicePrefixArb,
        clientSuffixArb,
        pascalCaseOpArb,
        (prefix, suffix, pascalName) => {
          // Use a PascalCase name as the method — camelToPascal should leave it unchanged
          const varName = prefix + suffix;
          const content = `${varName}.${pascalName}(params);`;
          const result = parseTypeScriptFile(content);

          if (pascalName.length >= 3) {
            // The name is already PascalCase, so normalization should preserve it
            expect(result).toContain(pascalName);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 8 Tests ---

/**
 * Property 8: Output format invariant
 *
 * Output is sorted, deduplicated, and all entries are valid PascalCase.
 *
 * **Validates: Requirements 7.4, 3.6**
 */
describe('Feature: multi-language-sdk-extraction, Property 8: Output format invariant', () => {
  it('output is sorted in ascending lexicographic order', () => {
    fc.assert(
      fc.property(
        fc.array(pascalCaseOpArb, { minLength: 1, maxLength: 10 }),
        (opNames) => {
          // Create content with multiple v3 Command patterns
          const content = opNames
            .map((op) => `new ${op}Command(params);`)
            .join('\n');
          const result = parseTypeScriptFile(content);

          // Verify sorted order
          const sorted = [...result].sort();
          expect(result).toEqual(sorted);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('output contains no duplicates', () => {
    fc.assert(
      fc.property(pascalCaseOpArb, (opName) => {
        // Create content with the same operation repeated multiple times
        const content = [
          `new ${opName}Command(params);`,
          `new ${opName}Command(otherParams);`,
          `new ${opName}Command({});`,
        ].join('\n');
        const result = parseTypeScriptFile(content);

        // No duplicates
        const unique = [...new Set(result)];
        expect(result).toEqual(unique);
      }),
      { numRuns: 100 }
    );
  });

  it('all entries are valid PascalCase (start with uppercase, only ASCII letters)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            pascalCaseOpArb.map((op) => `new ${op}Command(params);`),
            fc.tuple(servicePrefixArb, clientSuffixArb, camelCaseMethodArb).map(
              ([prefix, suffix, method]) => `${prefix}${suffix}.${method}(params);`
            )
          ),
          { minLength: 1, maxLength: 5 }
        ),
        (lines) => {
          const content = lines.join('\n');
          const result = parseTypeScriptFile(content);

          for (const entry of result) {
            // Starts with uppercase letter
            expect(entry[0]).toMatch(/^[A-Z]$/);
            // Contains only ASCII letters (no digits, no special chars)
            expect(entry).toMatch(/^[A-Za-z]+$/);
            // At least 3 characters (parser filters shorter ones)
            expect(entry.length).toBeGreaterThanOrEqual(3);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// --- Property 9 Tests ---

/**
 * Property 9: Parser determinism
 *
 * Same input always produces same output.
 *
 * **Validates: Requirements 7.6**
 */
describe('Feature: multi-language-sdk-extraction, Property 9: Parser determinism', () => {
  it('invoking parseTypeScriptFile twice with identical input produces identical output', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            pascalCaseOpArb.map((op) => `new ${op}Command(params);`),
            fc.tuple(servicePrefixArb, clientSuffixArb, camelCaseMethodArb).map(
              ([prefix, suffix, method]) => `${prefix}${suffix}.${method}(params);`
            ),
            fc.string({ minLength: 0, maxLength: 80 })
          ),
          { minLength: 0, maxLength: 10 }
        ),
        (lines) => {
          const content = lines.join('\n');
          const result1 = parseTypeScriptFile(content);
          const result2 = parseTypeScriptFile(content);

          expect(result1).toEqual(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
