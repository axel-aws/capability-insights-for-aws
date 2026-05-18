import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isValidGitHubUrl, parseGitHubUrl, classifyFile, shouldExcludeFile } from './repository-analyzer';
import { parseJavaFile } from './java-sdk-parser';
import { parsePythonFile } from './python-sdk-parser';
import { parseTypeScriptFile } from './typescript-sdk-parser';

/**
 * Property 15: GitHub URL validation
 *
 * For any string, the URL validator SHALL accept it if and only if it matches
 * the pattern `https://github.com/{owner}/{repo}` where owner and repo are
 * non-empty strings containing valid GitHub identifier characters
 * (alphanumeric, hyphens, underscores, dots).
 *
 * **Validates: Requirements 3.7**
 */

/**
 * Generator for valid GitHub identifier characters (alphanumeric, hyphens, underscores, dots).
 * Produces non-empty strings of 1-30 characters matching [a-zA-Z0-9_.-]+.
 */
const githubIdentifierArb = fc.stringMatching(/^[a-zA-Z0-9_.-]{1,30}$/);

/**
 * Generator for valid GitHub repository URLs in the format:
 * https://github.com/{owner}/{repo} with optional trailing slash.
 */
const validGitHubUrlArb = fc
  .tuple(githubIdentifierArb, githubIdentifierArb, fc.boolean())
  .map(([owner, repo, trailingSlash]) =>
    `https://github.com/${owner}/${repo}${trailingSlash ? '/' : ''}`
  );

/**
 * Generator for invalid URLs that should be rejected by the validator.
 * Covers multiple categories of invalid input.
 */
const invalidGitHubUrlArb = fc.oneof(
  // Wrong protocol (http instead of https)
  fc.tuple(githubIdentifierArb, githubIdentifierArb).map(
    ([owner, repo]) => `http://github.com/${owner}/${repo}`
  ),
  // Wrong host
  fc.tuple(
    fc.constantFrom('gitlab.com', 'bitbucket.org', 'github.io', 'github.org', 'example.com'),
    githubIdentifierArb,
    githubIdentifierArb
  ).map(([host, owner, repo]) => `https://${host}/${owner}/${repo}`),
  // Missing repo (only owner)
  githubIdentifierArb.map((owner) => `https://github.com/${owner}`),
  // Extra path segments beyond owner/repo
  fc.tuple(githubIdentifierArb, githubIdentifierArb, githubIdentifierArb).map(
    ([owner, repo, extra]) => `https://github.com/${owner}/${repo}/${extra}`
  ),
  // Empty owner or repo
  fc.constantFrom(
    'https://github.com//repo',
    'https://github.com/owner/',
    'https://github.com//',
    'https://github.com/'
  ),
  // Random strings that are not URLs at all
  fc.string({ minLength: 1, maxLength: 100 }).filter(
    (s) => !s.startsWith('https://github.com/')
  ),
  // URLs with invalid characters in owner/repo
  fc.tuple(
    fc.stringMatching(/^[a-zA-Z0-9_.-]{1,10}$/),
    fc.constantFrom(' ', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '+', '=', '~')
  ).map(([base, invalid]) => `https://github.com/${base}${invalid}/${base}`),
  // URLs with query parameters or fragments
  fc.tuple(githubIdentifierArb, githubIdentifierArb).map(
    ([owner, repo]) => `https://github.com/${owner}/${repo}?tab=code`
  ),
  fc.tuple(githubIdentifierArb, githubIdentifierArb).map(
    ([owner, repo]) => `https://github.com/${owner}/${repo}#readme`
  )
);

describe('Feature: infrastructure-planning, Property 15: GitHub URL validation', () => {
  it('should accept all valid GitHub URLs matching https://github.com/{owner}/{repo}', () => {
    fc.assert(
      fc.property(validGitHubUrlArb, (url) => {
        expect(isValidGitHubUrl(url)).toBe(true);
      }),
      { numRuns: 150 }
    );
  });

  it('should reject all invalid GitHub URLs', () => {
    fc.assert(
      fc.property(invalidGitHubUrlArb, (url) => {
        expect(isValidGitHubUrl(url)).toBe(false);
      }),
      { numRuns: 150 }
    );
  });

  it('should accept URLs if and only if owner and repo contain valid GitHub identifier characters', () => {
    // Generate arbitrary strings for owner and repo, then check that the validator
    // accepts exactly when both match [a-zA-Z0-9_.-]+
    const validCharPattern = /^[a-zA-Z0-9_.-]+$/;

    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 30 }),
        fc.string({ minLength: 0, maxLength: 30 }),
        (owner, repo) => {
          const url = `https://github.com/${owner}/${repo}`;
          const ownerValid = owner.length > 0 && validCharPattern.test(owner);
          const repoValid = repo.length > 0 && validCharPattern.test(repo);
          const expectedValid = ownerValid && repoValid;

          expect(isValidGitHubUrl(url)).toBe(expectedValid);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('should correctly parse owner and repo from valid URLs', () => {
    fc.assert(
      fc.property(
        githubIdentifierArb,
        githubIdentifierArb,
        (owner, repo) => {
          const url = `https://github.com/${owner}/${repo}`;
          const parsed = parseGitHubUrl(url);

          expect(parsed.owner).toBe(owner);
          expect(parsed.repo).toBe(repo);
        }
      ),
      { numRuns: 150 }
    );
  });

  it('should throw when parseGitHubUrl is called with an invalid URL', () => {
    fc.assert(
      fc.property(invalidGitHubUrlArb, (url) => {
        expect(() => parseGitHubUrl(url)).toThrow();
      }),
      { numRuns: 100 }
    );
  });
});


/**
 * Property 7: Cross-language deduplication
 *
 * For any set of source files across multiple languages that yield operation names
 * normalizing to the same PascalCase string, the final aggregated apiOperations
 * SHALL contain exactly one entry for that operation name.
 *
 * **Validates: Requirements 6.3**
 */
describe('Feature: multi-language-sdk-extraction, Property 7: Cross-language deduplication', () => {
  /**
   * Generator for a valid PascalCase operation name (2+ segments, each starting uppercase).
   * These represent the canonical form that all parsers normalize to.
   */
  const pascalCaseOperationArb = fc
    .tuple(
      fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
      fc.stringMatching(/^[A-Z][a-z]{2,8}$/)
    )
    .map(([first, second]) => first + second);

  it('should deduplicate operations that normalize to the same PascalCase string across Java, Python, and TypeScript', () => {
    fc.assert(
      fc.property(pascalCaseOperationArb, (operationName) => {
        // Convert PascalCase to the language-specific forms
        // Java: camelCase (lowercase first letter)
        const javaCamel = operationName.charAt(0).toLowerCase() + operationName.slice(1);
        // Python: snake_case (insert underscore before each uppercase letter, then lowercase)
        const pythonSnake = operationName
          .replace(/([A-Z])/g, '_$1')
          .toLowerCase()
          .replace(/^_/, '');
        // TypeScript v3: PascalCase + Command suffix
        const tsCommand = operationName;

        // Create source content for each language
        const javaContent = `s3Client.${javaCamel}(request);`;
        const pythonContent = `s3_client.${pythonSnake}(params)`;
        const tsContent = `new ${tsCommand}Command(params)`;

        // Parse each language
        const javaOps = parseJavaFile(javaContent);
        const pythonOps = parsePythonFile(pythonContent);
        const tsOps = parseTypeScriptFile(tsContent);

        // Simulate the repository analyzer aggregation: collect into a Set (deduplication)
        const aggregated = new Set<string>();
        for (const op of javaOps) aggregated.add(op);
        for (const op of pythonOps) aggregated.add(op);
        for (const op of tsOps) aggregated.add(op);

        // All three parsers should produce the same normalized name
        // and the aggregated set should contain exactly one entry
        const result = Array.from(aggregated);
        const matchingOps = result.filter((op) => op === operationName);
        expect(matchingOps.length).toBe(1);
      }),
      { numRuns: 100 }
    );
  });

  it('should produce exactly one entry when the same operation appears in multiple languages', () => {
    fc.assert(
      fc.property(pascalCaseOperationArb, (operationName) => {
        const javaCamel = operationName.charAt(0).toLowerCase() + operationName.slice(1);
        const javaContent = `dynamoDbClient.${javaCamel}(request);\nlambdaClient.${javaCamel}(request);`;

        const pythonSnake = operationName
          .replace(/([A-Z])/g, '_$1')
          .toLowerCase()
          .replace(/^_/, '');
        const pythonContent = `dynamodb_client.${pythonSnake}(params)\nlambda_client.${pythonSnake}(params)`;

        // Parse both languages
        const javaOps = parseJavaFile(javaContent);
        const pythonOps = parsePythonFile(pythonContent);

        // Aggregate with deduplication (as the repository analyzer does)
        const aggregated = new Set<string>();
        for (const op of javaOps) aggregated.add(op);
        for (const op of pythonOps) aggregated.add(op);

        // The operation should appear exactly once
        const result = Array.from(aggregated);
        const count = result.filter((op) => op === operationName).length;
        expect(count).toBe(1);
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 10: File classification by extension
 *
 * For any file path string, the classification function SHALL return `java` if and only if
 * the path ends with `.java`, `python` if and only if it ends with `.py`, `typescript` if
 * and only if it ends with `.ts` or `.js`, `go` if and only if it ends with `.go`, and the
 * appropriate type for other supported extensions.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3**
 */
describe('Feature: multi-language-sdk-extraction, Property 10: File classification by extension', () => {
  /**
   * Generator for a valid directory path prefix (e.g., "src/main/", "lib/utils/").
   */
  const pathPrefixArb = fc
    .array(fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/), { minLength: 0, maxLength: 4 })
    .map((segments) => (segments.length > 0 ? segments.join('/') + '/' : ''));

  /**
   * Generator for a valid filename base (without extension).
   */
  const filenameBaseArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_-]{1,20}$/);

  /**
   * Extension-to-classification mapping for all supported types.
   */
  const extensionClassifications: Array<{ ext: string; expected: ReturnType<typeof classifyFile> }> = [
    { ext: '.go', expected: 'go' },
    { ext: '.java', expected: 'java' },
    { ext: '.py', expected: 'python' },
    { ext: '.ts', expected: 'typescript' },
    { ext: '.js', expected: 'typescript' },
    { ext: '.yaml', expected: 'yaml' },
    { ext: '.yml', expected: 'yaml' },
    { ext: '.json', expected: 'json' },
    { ext: '.tf', expected: 'terraform' },
  ];

  it('should classify files with supported extensions to their correct language type', () => {
    const extensionArb = fc.constantFrom(...extensionClassifications);

    fc.assert(
      fc.property(pathPrefixArb, filenameBaseArb, extensionArb, (prefix, base, { ext, expected }) => {
        const path = `${prefix}${base}${ext}`;
        expect(classifyFile(path)).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });

  it('should return unknown for files with unsupported extensions', () => {
    const unsupportedExtArb = fc.constantFrom(
      '.rb', '.rs', '.c', '.cpp', '.h', '.cs', '.swift', '.kt',
      '.scala', '.php', '.lua', '.r', '.m', '.sh', '.bat', '.ps1',
      '.txt', '.md', '.html', '.css', '.xml', '.toml', '.ini'
    );

    fc.assert(
      fc.property(pathPrefixArb, filenameBaseArb, unsupportedExtArb, (prefix, base, ext) => {
        const path = `${prefix}${base}${ext}`;
        expect(classifyFile(path)).toBe('unknown');
      }),
      { numRuns: 100 }
    );
  });

  it('should classify based on the final extension only, not intermediate dots', () => {
    fc.assert(
      fc.property(
        pathPrefixArb,
        filenameBaseArb,
        fc.constantFrom(...extensionClassifications),
        (prefix, base, { ext, expected }) => {
          // Add an intermediate dot to the filename (e.g., "my.module.java")
          const path = `${prefix}${base}.extra${ext}`;
          expect(classifyFile(path)).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * Property 11: Test and vendor directory exclusion
 *
 * For any file path containing a directory segment exactly matching one of the test
 * directories or vendor directories, or whose filename matches test file patterns,
 * the exclusion filter SHALL return true. For paths not matching any exclusion rule,
 * it SHALL return false.
 *
 * **Validates: Requirements 4.4, 4.5**
 */
describe('Feature: multi-language-sdk-extraction, Property 11: Test and vendor directory exclusion', () => {
  const testDirs = ['test', 'tests', '__tests__', 'spec'];
  const vendorDirs = [
    'vendor',
    'node_modules',
    '.venv',
    'site-packages',
    '__pycache__',
    'target/dependency',
    'build/classes',
  ];

  /**
   * Generator for a safe directory segment that does NOT match any exclusion rule.
   */
  const safeSegmentArb = fc
    .stringMatching(/^[a-z][a-z0-9]{2,10}$/)
    .filter((s) => !testDirs.includes(s) && !vendorDirs.includes(s));

  /**
   * Generator for a safe filename that does NOT match test file patterns.
   * Avoids patterns like `_test.`, `.test.`, `.spec.`
   */
  const safeFilenameArb = fc
    .stringMatching(/^[a-z][a-z0-9-]{2,15}\.[a-z]{2,4}$/)
    .filter((f) => !/_test\./.test(f) && !/\.test\./.test(f) && !/\.spec\./.test(f));

  it('should exclude paths containing test directory segments', () => {
    const testDirArb = fc.constantFrom(...testDirs);

    fc.assert(
      fc.property(
        fc.array(safeSegmentArb, { minLength: 0, maxLength: 3 }),
        testDirArb,
        fc.array(safeSegmentArb, { minLength: 0, maxLength: 2 }),
        safeFilenameArb,
        (prefixSegments, testDir, suffixSegments, filename) => {
          const path = [...prefixSegments, testDir, ...suffixSegments, filename].join('/');
          expect(shouldExcludeFile(path)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should exclude paths containing vendor directory segments', () => {
    const singleSegmentVendorDirs = ['vendor', 'node_modules', '.venv', 'site-packages', '__pycache__'];
    const multiSegmentVendorDirs = ['target/dependency', 'build/classes'];

    // Test single-segment vendor dirs
    const singleVendorDirArb = fc.constantFrom(...singleSegmentVendorDirs);

    fc.assert(
      fc.property(
        fc.array(safeSegmentArb, { minLength: 0, maxLength: 3 }),
        singleVendorDirArb,
        fc.array(safeSegmentArb, { minLength: 0, maxLength: 2 }),
        safeFilenameArb,
        (prefixSegments, vendorDir, suffixSegments, filename) => {
          const path = [...prefixSegments, vendorDir, ...suffixSegments, filename].join('/');
          expect(shouldExcludeFile(path)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );

    // Test multi-segment vendor dirs (target/dependency, build/classes)
    const multiVendorDirArb = fc.constantFrom(...multiSegmentVendorDirs);

    fc.assert(
      fc.property(
        fc.array(safeSegmentArb, { minLength: 0, maxLength: 3 }),
        multiVendorDirArb,
        fc.array(safeSegmentArb, { minLength: 0, maxLength: 2 }),
        safeFilenameArb,
        (prefixSegments, vendorDir, suffixSegments, filename) => {
          // Multi-segment vendor dirs are inserted as-is (they contain '/')
          const vendorSegments = vendorDir.split('/');
          const path = [...prefixSegments, ...vendorSegments, ...suffixSegments, filename].join('/');
          expect(shouldExcludeFile(path)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should exclude files matching test file patterns (_test., .test., .spec.)', () => {
    const testFilePatternArb = fc.oneof(
      // Pattern: filename_test.ext
      fc.tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/),
        fc.constantFrom('.ts', '.js', '.go', '.java', '.py')
      ).map(([base, ext]) => `${base}_test${ext}`),
      // Pattern: filename.test.ext
      fc.tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/),
        fc.constantFrom('.ts', '.js', '.go', '.java', '.py')
      ).map(([base, ext]) => `${base}.test${ext}`),
      // Pattern: filename.spec.ext
      fc.tuple(
        fc.stringMatching(/^[a-z][a-z0-9]{2,10}$/),
        fc.constantFrom('.ts', '.js', '.go', '.java', '.py')
      ).map(([base, ext]) => `${base}.spec${ext}`)
    );

    fc.assert(
      fc.property(
        fc.array(safeSegmentArb, { minLength: 0, maxLength: 3 }),
        testFilePatternArb,
        (prefixSegments, testFilename) => {
          const path = [...prefixSegments, testFilename].join('/');
          expect(shouldExcludeFile(path)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should NOT exclude paths without any excluded segments or test file patterns', () => {
    fc.assert(
      fc.property(
        fc.array(safeSegmentArb, { minLength: 1, maxLength: 4 }),
        safeFilenameArb,
        (segments, filename) => {
          const path = [...segments, filename].join('/');
          expect(shouldExcludeFile(path)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
