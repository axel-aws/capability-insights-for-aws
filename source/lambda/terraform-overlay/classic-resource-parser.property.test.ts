import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseResourceGoFile } from './classic-resource-parser';

// --- Generators ---

/**
 * Generator for valid AWS SDK API operation names.
 * Format: PascalCase, at least 4 characters, not starting with "Set",
 * and not matching known non-API method names.
 *
 * Examples: "CreateBucket", "PutObject", "RunInstances", "DescribeVpcs"
 */
const apiOperationNameArb = fc
  .tuple(
    fc.constantFrom(
      'Create',
      'Delete',
      'Describe',
      'Get',
      'List',
      'Put',
      'Update',
      'Start',
      'Stop',
      'Run',
      'Terminate',
      'Attach',
      'Detach',
      'Enable',
      'Disable',
      'Modify',
      'Register',
      'Deregister',
      'Tag',
      'Untag',
    ),
    fc.stringMatching(/^[A-Z][a-z]{2,10}$/),
  )
  .map(([verb, noun]) => `${verb}${noun}`)
  .filter(
    (name) =>
      name.length >= 4 &&
      !name.startsWith('Set') &&
      name !== 'String' &&
      name !== 'GoString' &&
      name !== 'Validate',
  );

/**
 * Generator for SDK client variable names used in Terraform provider Go code.
 */
const clientVarArb = fc.constantFrom('conn', 'client', 'svc');

/**
 * Generator for a single SDK method call line in Go source.
 * Produces lines like:
 *   conn.CreateBucket(input)
 *   client.PutObject(ctx, params)
 */
const sdkCallLineArb = fc
  .tuple(clientVarArb, apiOperationNameArb)
  .map(([clientVar, opName]) => `\t${clientVar}.${opName}(input)`);

/**
 * Generator for non-API method call lines that should be filtered out.
 * These represent utility methods that are NOT real AWS API calls.
 * Note: Set* methods on conn/client/svc ARE real API operations, so they're not here.
 */
const nonApiCallLineArb = fc
  .tuple(
    clientVarArb,
    fc.constantFrom('String', 'GoString', 'Validate', 'SetContext', 'WithContext'),
  )
  .map(([clientVar, method]) => `\t${clientVar}.${method}(input)`);

/**
 * Generator for a complete Go resource file with N distinct SDK method calls.
 * Ensures unique operation names to verify deduplication behavior.
 */
const goResourceFileArb = fc
  .tuple(
    fc.uniqueArray(apiOperationNameArb, { minLength: 1, maxLength: 20 }),
    fc.array(nonApiCallLineArb, { minLength: 0, maxLength: 5 }),
  )
  .map(([operations, nonApiCalls]) => {
    const header = `package s3

import (
\t"context"
\t"github.com/aws/aws-sdk-go/service/s3"
)

func resourceBucketCreate(ctx context.Context, d *schema.ResourceData, meta interface{}) diag.Diagnostics {
\tconn := meta.(*conns.AWSClient).S3Conn(ctx)
`;

    // Build SDK call lines using random client vars
    const clientVars = ['conn', 'client', 'svc'];
    const apiCallLines = operations.map((op, i) => {
      const clientVar = clientVars[i % clientVars.length];
      return `\t${clientVar}.${op}(input)`;
    });

    const footer = `
\treturn nil
}`;

    const allLines = [...apiCallLines, ...nonApiCalls];
    // Shuffle lines to make the test more realistic
    const shuffled = allLines.sort(() => Math.random() - 0.5);

    return {
      content: header + shuffled.join('\n') + footer,
      expectedOperations: operations,
    };
  });

/**
 * Generator for a Go resource file that includes duplicate SDK calls.
 * The same operation is called multiple times to verify deduplication.
 */
const goResourceFileWithDuplicatesArb = fc
  .tuple(
    fc.uniqueArray(apiOperationNameArb, { minLength: 1, maxLength: 10 }),
    fc.integer({ min: 2, max: 4 }),
  )
  .map(([operations, duplicateCount]) => {
    const header = `package ec2

func resourceInstanceCreate(ctx context.Context, d *schema.ResourceData, meta interface{}) diag.Diagnostics {
\tconn := meta.(*conns.AWSClient).EC2Conn(ctx)
`;

    // Each operation appears multiple times
    const apiCallLines: string[] = [];
    for (const op of operations) {
      for (let i = 0; i < duplicateCount; i++) {
        apiCallLines.push(`\tconn.${op}(input${i})`);
      }
    }

    const footer = `
\treturn nil
}`;

    return {
      content: header + apiCallLines.join('\n') + footer,
      expectedOperations: operations,
    };
  });

// --- Property Tests ---

/**
 * Feature: terraform-classic-api-availability, Property 7: Go Source Parser Extraction
 *
 * For any Go source file containing N distinct SDK client method call patterns
 * (e.g., `conn.CreateBucket(`, `client.PutObject(`), the parser SHALL extract
 * at least those N operation names. The extracted operations SHALL be deduplicated
 * and SHALL not include common non-API methods (e.g., `String`, `GoString`).
 *
 * **Validates: Requirements 7.1, 7.6**
 */
describe('Feature: terraform-classic-api-availability, Property 7: Go Source Parser Extraction', () => {
  it('extracts all N distinct SDK method calls from generated Go source', () => {
    fc.assert(
      fc.property(goResourceFileArb, ({ content, expectedOperations }) => {
        const results = parseResourceGoFile(content);

        // Verify: parser extracts at least those N operations
        const resultSet = new Set(results);
        for (const op of expectedOperations) {
          expect(resultSet.has(op)).toBe(true);
        }

        // Verify: results contain at least N operations
        expect(results.length).toBeGreaterThanOrEqual(expectedOperations.length);
      }),
      { numRuns: 100 },
    );
  });

  it('results are sorted and deduplicated', () => {
    fc.assert(
      fc.property(goResourceFileWithDuplicatesArb, ({ content, expectedOperations }) => {
        const results = parseResourceGoFile(content);

        // Verify: results are deduplicated (no duplicates despite multiple calls)
        const uniqueResults = new Set(results);
        expect(results.length).toBe(uniqueResults.size);

        // Verify: results are sorted alphabetically
        const sorted = [...results].sort();
        expect(results).toEqual(sorted);

        // Verify: all expected operations are present
        for (const op of expectedOperations) {
          expect(uniqueResults.has(op)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('non-API methods are excluded from results', () => {
    fc.assert(
      fc.property(goResourceFileArb, ({ content }) => {
        const results = parseResourceGoFile(content);

        // Verify: non-API methods are never in results
        const nonApiMethods = ['String', 'GoString', 'Validate', 'SetContext', 'WithContext'];
        for (const method of nonApiMethods) {
          expect(results).not.toContain(method);
        }

        // Verify: no result starts with "Set" followed by uppercase
        for (const result of results) {
          if (result.startsWith('Set') && result.length > 3) {
            const charAfterSet = result[3];
            expect(charAfterSet >= 'A' && charAfterSet <= 'Z').toBe(false);
          }
        }

        // Verify: all results are at least 3 characters long
        for (const result of results) {
          expect(result.length).toBeGreaterThanOrEqual(3);
        }
      }),
      { numRuns: 100 },
    );
  });
});
