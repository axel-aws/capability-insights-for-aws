import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GitHubFetchRequest, GitHubFetchResponse } from './github-fetch-lambda-main';

// Mock the repository-analyzer module
vi.mock('./services/infrastructure-planning/parsers/repository-analyzer', () => ({
  isValidGitHubUrl: vi.fn(),
  parseGitHubUrl: vi.fn(),
  classifyFile: vi.fn(),
  shouldExcludeFile: vi.fn(),
}));

import { isValidGitHubUrl, parseGitHubUrl, classifyFile, shouldExcludeFile } from './services/infrastructure-planning/parsers/repository-analyzer';
import { handler } from './github-fetch-lambda-main';

const mockIsValidGitHubUrl = vi.mocked(isValidGitHubUrl);
const mockParseGitHubUrl = vi.mocked(parseGitHubUrl);
const mockClassifyFile = vi.mocked(classifyFile);
const mockShouldExcludeFile = vi.mocked(shouldExcludeFile);

// Helper to create a mock fetch Response
function createMockResponse(options: {
  status?: number;
  statusText?: string;
  ok?: boolean;
  body?: string | object;
  headers?: Record<string, string>;
}): Response {
  const { status = 200, statusText = 'OK', ok = true, body = '', headers = {} } = options;
  const responseBody = typeof body === 'string' ? body : JSON.stringify(body);

  return {
    status,
    statusText,
    ok,
    headers: {
      get: (name: string) => headers[name] ?? null,
    },
    text: () => Promise.resolve(responseBody),
    json: () => Promise.resolve(typeof body === 'object' ? body : JSON.parse(responseBody)),
  } as unknown as Response;
}

describe('github-fetch-lambda-main', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Default mock implementations
    mockIsValidGitHubUrl.mockReturnValue(true);
    mockParseGitHubUrl.mockReturnValue({ owner: 'test-owner', repo: 'test-repo' });
    mockClassifyFile.mockReturnValue('typescript');
    mockShouldExcludeFile.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('input validation', () => {
    it('returns error when repositoryUrl is missing', async () => {
      const event = { repositoryUrl: '', pat: 'ghp_token123' } as GitHubFetchRequest;

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Missing required fields');
        expect(result.errorType).toBe('unknown');
      }
    });

    it('returns error when pat is missing', async () => {
      const event = { repositoryUrl: 'https://github.com/owner/repo', pat: '' } as GitHubFetchRequest;

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Missing required fields');
        expect(result.errorType).toBe('unknown');
      }
    });

    it('returns error when both fields are missing', async () => {
      const event = { repositoryUrl: '', pat: '' } as GitHubFetchRequest;

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('unknown');
      }
    });

    it('returns error for invalid GitHub URL', async () => {
      mockIsValidGitHubUrl.mockReturnValue(false);

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://gitlab.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid GitHub repository URL format');
        expect(result.errorType).toBe('unknown');
      }
    });

    it('calls isValidGitHubUrl with the provided URL', async () => {
      mockIsValidGitHubUrl.mockReturnValue(false);

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://example.com/not-github',
        pat: 'ghp_token123',
      };

      await handler(event);

      expect(mockIsValidGitHubUrl).toHaveBeenCalledWith('https://example.com/not-github');
    });
  });

  describe('GitHub API error handling', () => {
    it('returns auth error for 401 response', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 401, statusText: 'Unauthorized', ok: false })
      );

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_invalid_token',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('auth');
        expect(result.error).toContain('invalid or expired');
      }
    });

    it('returns not_found error for 404 response', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 404, statusText: 'Not Found', ok: false })
      );

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/nonexistent-repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('not_found');
        expect(result.error).toContain('Cannot access repository');
      }
    });

    it('returns rate_limit error for 403 with x-ratelimit-remaining: 0', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          status: 403,
          statusText: 'Forbidden',
          ok: false,
          headers: { 'x-ratelimit-remaining': '0' },
        })
      );

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('rate_limit');
        expect(result.error).toContain('rate limit');
      }
    });

    it('returns unknown error for other non-OK responses', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 500, statusText: 'Internal Server Error', ok: false })
      );

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errorType).toBe('unknown');
        expect(result.error).toContain('500');
      }
    });
  });

  describe('file classification and filtering', () => {
    function setupTreeResponse(files: Array<{ path: string; type?: string; size?: number }>) {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          body: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/git/trees/HEAD',
            tree: files.map((f) => ({
              path: f.path,
              mode: '100644',
              type: f.type ?? 'blob',
              sha: 'file-sha',
              size: f.size ?? 100,
              url: `https://api.github.com/repos/owner/repo/git/blobs/file-sha`,
            })),
            truncated: false,
          },
        })
      );
    }

    it('only fetches files with allowed extensions', async () => {
      setupTreeResponse([
        { path: 'src/main.ts' },
        { path: 'src/main.go' },
        { path: 'README.md' },
        { path: 'Makefile' },
        { path: 'infra/main.tf' },
        { path: 'config.yaml' },
        { path: 'data.json' },
        { path: 'app.py' },
        { path: 'App.java' },
        { path: 'script.js' },
        { path: 'template.yml' },
        { path: 'image.png' },
      ]);

      // Mock file content fetches to return empty content
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, body: '// content' }));

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        // Tree should contain all blob entries
        expect(result.tree.length).toBe(12);
        // Only files with allowed extensions should be fetched (9 allowed: .ts, .go, .tf, .yaml, .json, .py, .java, .js, .yml)
        // Minus excluded ones (README.md, Makefile, image.png don't have allowed extensions)
        expect(result.metadata.totalFilesIdentified).toBe(9);
      }
    });

    it('excludes files in test directories', async () => {
      mockShouldExcludeFile.mockImplementation((path: string) => {
        const segments = path.split('/');
        const testDirs = ['test', 'tests', '__tests__', 'spec'];
        for (const segment of segments.slice(0, -1)) {
          if (testDirs.includes(segment)) return true;
        }
        return false;
      });

      setupTreeResponse([
        { path: 'src/main.ts' },
        { path: 'test/main.test.ts' },
        { path: 'tests/integration.ts' },
        { path: '__tests__/unit.ts' },
        { path: 'spec/helper.ts' },
        { path: 'src/lib/utils.ts' },
      ]);

      mockFetch.mockResolvedValue(createMockResponse({ ok: true, body: '// content' }));

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        // Only src/main.ts and src/lib/utils.ts should pass exclusion filter
        expect(result.metadata.totalFilesIdentified).toBe(2);
      }
    });

    it('excludes files in vendor directories', async () => {
      mockShouldExcludeFile.mockImplementation((path: string) => {
        const segments = path.split('/');
        const vendorDirs = ['vendor', 'node_modules', '.venv', 'site-packages', '__pycache__'];
        for (const segment of segments.slice(0, -1)) {
          if (vendorDirs.includes(segment)) return true;
        }
        const dirPath = segments.slice(0, -1).join('/');
        if (dirPath.includes('target/dependency') || dirPath.includes('build/classes')) return true;
        return false;
      });

      setupTreeResponse([
        { path: 'src/main.go' },
        { path: 'vendor/github.com/aws/aws-sdk-go/service.go' },
        { path: 'node_modules/@aws-sdk/client-s3/index.js' },
        { path: '.venv/lib/boto3/client.py' },
        { path: 'target/dependency/aws-sdk.java' },
        { path: 'build/classes/com/example/App.java' },
      ]);

      mockFetch.mockResolvedValue(createMockResponse({ ok: true, body: '// content' }));

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        // Only src/main.go should pass
        expect(result.metadata.totalFilesIdentified).toBe(1);
      }
    });

    it('excludes files matching test file patterns', async () => {
      mockShouldExcludeFile.mockImplementation((path: string) => {
        const filename = path.split('/').pop() ?? '';
        const testFilePatterns = [/_test\./, /\.test\./, /\.spec\./];
        return testFilePatterns.some((p) => p.test(filename));
      });

      setupTreeResponse([
        { path: 'src/handler.ts' },
        { path: 'src/handler.test.ts' },
        { path: 'src/handler.spec.ts' },
        { path: 'src/handler_test.go' },
        { path: 'src/utils.ts' },
      ]);

      mockFetch.mockResolvedValue(createMockResponse({ ok: true, body: '// content' }));

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        // Only src/handler.ts and src/utils.ts should pass
        expect(result.metadata.totalFilesIdentified).toBe(2);
      }
    });
  });

  describe('file priority ordering', () => {
    it('prioritizes SDK files before infrastructure files', async () => {
      // Track the order of file content fetches
      const fetchOrder: string[] = [];

      mockClassifyFile.mockImplementation((path: string) => {
        if (path.endsWith('.go')) return 'go';
        if (path.endsWith('.java')) return 'java';
        if (path.endsWith('.py')) return 'python';
        if (path.endsWith('.ts') || path.endsWith('.js')) return 'typescript';
        if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
        if (path.endsWith('.json')) return 'json';
        if (path.endsWith('.tf')) return 'terraform';
        return 'unknown';
      });

      // Tree response
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          body: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/git/trees/HEAD',
            tree: [
              { path: 'infra/main.tf', mode: '100644', type: 'blob', sha: 's1', size: 100, url: '' },
              { path: 'template.yaml', mode: '100644', type: 'blob', sha: 's2', size: 100, url: '' },
              { path: 'src/main.go', mode: '100644', type: 'blob', sha: 's3', size: 100, url: '' },
              { path: 'src/App.java', mode: '100644', type: 'blob', sha: 's4', size: 100, url: '' },
              { path: 'src/app.py', mode: '100644', type: 'blob', sha: 's5', size: 100, url: '' },
              { path: 'src/index.ts', mode: '100644', type: 'blob', sha: 's6', size: 100, url: '' },
            ],
            truncated: false,
          },
        })
      );

      // File content fetches - track order
      mockFetch.mockImplementation(async (url: string) => {
        const pathMatch = url.match(/\/contents\/(.+)$/);
        if (pathMatch) {
          fetchOrder.push(pathMatch[1]);
        }
        return createMockResponse({ ok: true, body: '// content' });
      });

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      await handler(event);

      // Go files should come first, then Java, Python, TypeScript, then infra
      const goIndex = fetchOrder.indexOf('src/main.go');
      const javaIndex = fetchOrder.indexOf('src/App.java');
      const pyIndex = fetchOrder.indexOf('src/app.py');
      const tsIndex = fetchOrder.indexOf('src/index.ts');
      const tfIndex = fetchOrder.indexOf('infra/main.tf');
      const yamlIndex = fetchOrder.indexOf('template.yaml');

      // SDK files should come before infra files
      expect(goIndex).toBeLessThan(tfIndex);
      expect(goIndex).toBeLessThan(yamlIndex);
      expect(javaIndex).toBeLessThan(tfIndex);
      expect(pyIndex).toBeLessThan(tfIndex);
      expect(tsIndex).toBeLessThan(tfIndex);
    });
  });

  describe('timeout cutoff behavior', () => {
    it('stops fetching files when elapsed time exceeds cutoff', async () => {
      vi.useFakeTimers();
      let currentTime = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

      // Tree response with many files
      const treeFiles = Array.from({ length: 50 }, (_, i) => ({
        path: `src/file${i}.ts`,
        mode: '100644',
        type: 'blob',
        sha: `sha${i}`,
        size: 100,
        url: '',
      }));

      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          body: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/git/trees/HEAD',
            tree: treeFiles,
            truncated: false,
          },
        })
      );

      // Simulate time passing with each batch of file fetches
      mockFetch.mockImplementation(async () => {
        // Each batch takes 60 seconds (will exceed 100s cutoff after 2 batches)
        currentTime += 60_000;
        return createMockResponse({ ok: true, body: '// content' });
      });

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.metadata.timedOut).toBe(true);
        // Should have processed fewer files than total identified
        expect(result.metadata.filesProcessed).toBeLessThan(result.metadata.totalFilesIdentified);
      }
    });

    it('sets timedOut to false when all files are processed within cutoff', async () => {
      // Tree response with a small number of files
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          body: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/git/trees/HEAD',
            tree: [
              { path: 'src/main.ts', mode: '100644', type: 'blob', sha: 's1', size: 100, url: '' },
              { path: 'src/utils.ts', mode: '100644', type: 'blob', sha: 's2', size: 100, url: '' },
            ],
            truncated: false,
          },
        })
      );

      // File content fetches complete quickly
      mockFetch.mockResolvedValue(createMockResponse({ ok: true, body: '// content' }));

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.metadata.timedOut).toBe(false);
        expect(result.metadata.filesProcessed).toBe(result.metadata.totalFilesIdentified);
      }
    });
  });

  describe('success response contract', () => {
    it('returns correct success response structure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          body: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/git/trees/HEAD',
            tree: [
              { path: 'src/main.ts', mode: '100644', type: 'blob', sha: 's1', size: 250, url: '' },
              { path: 'docs', mode: '040000', type: 'tree', sha: 's2', url: '' },
            ],
            truncated: false,
          },
        })
      );

      // File content fetch
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ ok: true, body: 'const x = 1;' })
      );

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        // Validate success response schema
        expect(result).toHaveProperty('tree');
        expect(result).toHaveProperty('files');
        expect(result).toHaveProperty('metadata');
        expect(result.metadata).toHaveProperty('filesProcessed');
        expect(result.metadata).toHaveProperty('totalFilesIdentified');
        expect(result.metadata).toHaveProperty('timedOut');

        // Tree should only contain blob entries
        expect(result.tree).toEqual([
          { path: 'src/main.ts', type: 'blob', size: 250 },
        ]);

        // Files map should contain fetched content
        expect(result.files['src/main.ts']).toBe('const x = 1;');

        // Metadata should be correct
        expect(result.metadata.filesProcessed).toBe(1);
        expect(result.metadata.totalFilesIdentified).toBe(1);
        expect(result.metadata.timedOut).toBe(false);
      }
    });

    it('includes size in tree entries only when present', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          body: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/git/trees/HEAD',
            tree: [
              { path: 'src/main.ts', mode: '100644', type: 'blob', sha: 's1', size: 100, url: '' },
              { path: 'src/other.ts', mode: '100644', type: 'blob', sha: 's2', url: '' },
            ],
            truncated: false,
          },
        })
      );

      mockFetch.mockResolvedValue(createMockResponse({ ok: true, body: '// code' }));

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        const withSize = result.tree.find((t) => t.path === 'src/main.ts');
        const withoutSize = result.tree.find((t) => t.path === 'src/other.ts');

        expect(withSize?.size).toBe(100);
        expect(withoutSize?.size).toBeUndefined();
      }
    });

    it('handles files that fail to fetch gracefully', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({
          ok: true,
          body: {
            sha: 'abc123',
            url: 'https://api.github.com/repos/owner/repo/git/trees/HEAD',
            tree: [
              { path: 'src/main.ts', mode: '100644', type: 'blob', sha: 's1', size: 100, url: '' },
              { path: 'src/broken.ts', mode: '100644', type: 'blob', sha: 's2', size: 100, url: '' },
            ],
            truncated: false,
          },
        })
      );

      // First file succeeds, second fails
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ ok: true, body: '// good content' }))
        .mockResolvedValueOnce(createMockResponse({ ok: false, status: 500, statusText: 'Error' }));

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should still succeed overall
        expect(result.files['src/main.ts']).toBe('// good content');
        // Broken file should not be in the files map
        expect(result.files['src/broken.ts']).toBeUndefined();
        // Both files were processed (attempted)
        expect(result.metadata.filesProcessed).toBe(2);
      }
    });
  });

  describe('error response contract', () => {
    it('returns correct error response structure for auth errors', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 401, statusText: 'Unauthorized', ok: false })
      );

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_bad_token',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(result).toHaveProperty('errorType');
        expect(typeof result.error).toBe('string');
        expect(['auth', 'not_found', 'rate_limit', 'timeout', 'unknown']).toContain(result.errorType);
      }
    });

    it('returns correct error response structure for validation errors', async () => {
      mockIsValidGitHubUrl.mockReturnValue(false);

      const event: GitHubFetchRequest = {
        repositoryUrl: 'not-a-url',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result).toHaveProperty('error');
        expect(result).toHaveProperty('errorType');
        expect(typeof result.error).toBe('string');
        expect(result.error.length).toBeGreaterThan(0);
      }
    });

    it('error response errorType is one of the defined values', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse({ status: 404, statusText: 'Not Found', ok: false })
      );

      const event: GitHubFetchRequest = {
        repositoryUrl: 'https://github.com/owner/repo',
        pat: 'ghp_token123',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      if (!result.success) {
        const validErrorTypes = ['auth', 'not_found', 'rate_limit', 'timeout', 'unknown'];
        expect(validErrorTypes).toContain(result.errorType);
      }
    });
  });
});
