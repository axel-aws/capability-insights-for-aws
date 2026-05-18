import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parsePythonFile, snakeToPascal } from './python-sdk-parser';

// --- Generators ---

/**
 * Generator for valid snake_case method names that won't be excluded.
 * Produces names like: put_object, get_item, describe_instances, list_buckets
 */
const validSnakeMethodArb = fc
  .tuple(
    fc.constantFrom(
      'put',
      'get',
      'list',
      'describe',
      'create',
      'delete',
      'update',
      'start',
      'stop',
      'run',
      'invoke',
      'send',
      'batch',
      'query',
      'scan',
    ),
    fc.constantFrom(
      'object',
      'item',
      'instances',
      'buckets',
      'functions',
      'tables',
      'queues',
      'topics',
      'streams',
      'clusters',
      'stacks',
      'roles',
      'users',
      'groups',
      'policies',
    ),
  )
  .map(([verb, noun]) => `${verb}_${noun}`)
  .filter(
    (name) =>
      !name.startsWith('_') &&
      name !== 'get_paginator' &&
      name !== 'get_waiter' &&
      name !== 'can_paginate' &&
      name !== 'generate_presigned_url' &&
      name !== 'generate_presigned_post' &&
      snakeToPascal(name).length >= 3,
  );

/**
 * Generator for Python identifiers ending with "client".
 * Matches the regex pattern: \w*(?:client|resource)|conn|svc
 */
const clientIdentifierArb = fc.constantFrom(
  'client',
  's3_client',
  'ec2_client',
  'my_client',
  'dynamodb_client',
  'lambda_client',
  'sqs_client',
  'conn',
  'svc',
);

/**
 * Generator for Python identifiers ending with "resource".
 */
const resourceIdentifierArb = fc.constantFrom(
  'resource',
  's3_resource',
  'ec2_resource',
  'my_resource',
  'dynamodb_resource',
);

/**
 * Generator for a boto3 identifier (client, resource, conn, or svc).
 */
const boto3IdentifierArb = fc.oneof(clientIdentifierArb, resourceIdentifierArb);

/**
 * Generator for a single boto3 method call line.
 * Produces lines like:
 *   s3_client.put_object(Bucket='my-bucket')
 *   conn.describe_instances()
 */
const boto3CallLineArb = fc
  .tuple(boto3IdentifierArb, validSnakeMethodArb)
  .map(([identifier, method]) => `${identifier}.${method}(params)`);

/**
 * Generator for PascalCase strings (already normalized).
 * These should be unchanged when snakeToPascal is applied.
 */
const pascalCaseStringArb = fc
  .tuple(
    fc.constantFrom(
      'Put',
      'Get',
      'List',
      'Describe',
      'Create',
      'Delete',
      'Update',
      'Start',
      'Stop',
      'Run',
    ),
    fc.constantFrom(
      'Object',
      'Item',
      'Instances',
      'Buckets',
      'Functions',
      'Tables',
      'Queues',
      'Topics',
      'Streams',
      'Clusters',
    ),
  )
  .map(([verb, noun]) => `${verb}${noun}`);

// --- Property Tests ---

/**
 * Feature: multi-language-sdk-extraction, Property 2: Python boto3 pattern extraction
 *
 * For any Python source file content containing one or more method calls on variables
 * whose names end with `client` or `resource` (or are exactly `conn` or `svc`),
 * the Python parser SHALL extract all non-excluded method names from those calls.
 * Specifically, for any identifier `I` matching the pattern and any method name `M`
 * (≥ 3 characters after conversion, not in the exclusion list, not starting with `_`),
 * if the content contains `I.M(`, then the normalized form of `M` SHALL appear in the output.
 *
 * **Validates: Requirements 2.2, 2.3**
 */
describe('Feature: multi-language-sdk-extraction, Property 2: Python boto3 pattern extraction', () => {
  it('extracts all valid boto3 method calls from generated Python source', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.tuple(boto3IdentifierArb, validSnakeMethodArb),
          {
            minLength: 1,
            maxLength: 20,
            selector: ([, method]) => method,
          },
        ),
        (calls) => {
          const lines = calls.map(([id, method]) => `${id}.${method}(params)`);
          const content = lines.join('\n');

          const results = parsePythonFile(content);
          const resultSet = new Set(results);

          // Every valid method call should produce its PascalCase form in the output
          for (const [, method] of calls) {
            const expected = snakeToPascal(method);
            expect(resultSet.has(expected)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: multi-language-sdk-extraction, Property 5: Normalization to PascalCase
 *
 * All output strings start with uppercase and contain only ASCII letters.
 *
 * **Validates: Requirements 6.1, 2.4**
 */
describe('Feature: multi-language-sdk-extraction, Property 5: Normalization to PascalCase (Python)', () => {
  it('all output strings start with uppercase and contain only ASCII letters', () => {
    fc.assert(
      fc.property(
        fc.array(boto3CallLineArb, { minLength: 1, maxLength: 20 }),
        (lines) => {
          const content = lines.join('\n');
          const results = parsePythonFile(content);

          for (const result of results) {
            // Starts with uppercase
            expect(result[0]).toMatch(/[A-Z]/);
            // Contains only ASCII letters (and digits for cases like V2)
            expect(result).toMatch(/^[A-Za-z0-9]+$/);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('snakeToPascal produces strings starting with uppercase containing only ASCII letters', () => {
    fc.assert(
      fc.property(validSnakeMethodArb, (method) => {
        const result = snakeToPascal(method);

        // Starts with uppercase
        expect(result[0]).toMatch(/[A-Z]/);
        // Contains only ASCII letters
        expect(result).toMatch(/^[A-Za-z0-9]+$/);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: multi-language-sdk-extraction, Property 6: Normalization idempotence
 *
 * Applying snakeToPascal to already-PascalCase strings returns them unchanged.
 *
 * **Validates: Requirements 6.4**
 */
describe('Feature: multi-language-sdk-extraction, Property 6: Normalization idempotence (Python)', () => {
  it('snakeToPascal applied to PascalCase strings returns them unchanged', () => {
    fc.assert(
      fc.property(pascalCaseStringArb, (pascalName) => {
        const result = snakeToPascal(pascalName);
        expect(result).toBe(pascalName);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: multi-language-sdk-extraction, Property 8: Output format invariant
 *
 * Output is sorted, deduplicated, and all entries are valid PascalCase.
 *
 * **Validates: Requirements 7.4, 2.6**
 */
describe('Feature: multi-language-sdk-extraction, Property 8: Output format invariant (Python)', () => {
  it('output is sorted in ascending lexicographic order', () => {
    fc.assert(
      fc.property(
        fc.array(boto3CallLineArb, { minLength: 1, maxLength: 30 }),
        (lines) => {
          const content = lines.join('\n');
          const results = parsePythonFile(content);

          // Verify sorted
          const sorted = [...results].sort();
          expect(results).toEqual(sorted);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('output contains no duplicate entries', () => {
    fc.assert(
      fc.property(
        fc.array(boto3CallLineArb, { minLength: 1, maxLength: 30 }),
        (lines) => {
          // Add duplicate lines to test deduplication
          const content = [...lines, ...lines].join('\n');
          const results = parsePythonFile(content);

          // Verify deduplicated
          const uniqueResults = new Set(results);
          expect(results.length).toBe(uniqueResults.size);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all entries are valid PascalCase (start with uppercase, only ASCII letters/digits)', () => {
    fc.assert(
      fc.property(
        fc.array(boto3CallLineArb, { minLength: 1, maxLength: 20 }),
        (lines) => {
          const content = lines.join('\n');
          const results = parsePythonFile(content);

          for (const result of results) {
            // Starts with uppercase letter
            expect(result[0]).toMatch(/[A-Z]/);
            // Contains only ASCII letters and digits
            expect(result).toMatch(/^[A-Za-z0-9]+$/);
            // At least 3 characters
            expect(result.length).toBeGreaterThanOrEqual(3);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: multi-language-sdk-extraction, Property 9: Parser determinism
 *
 * Same input always produces same output.
 *
 * **Validates: Requirements 7.6**
 */
describe('Feature: multi-language-sdk-extraction, Property 9: Parser determinism (Python)', () => {
  it('invoking parsePythonFile twice with identical input produces identical output', () => {
    fc.assert(
      fc.property(
        fc.array(boto3CallLineArb, { minLength: 0, maxLength: 20 }),
        (lines) => {
          const content = lines.join('\n');

          const result1 = parsePythonFile(content);
          const result2 = parsePythonFile(content);

          expect(result1).toEqual(result2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
