import { describe, it, expect } from 'vitest';
import {
  createGitHubClient,
  GitHubRateLimitError,
  GitHubNotFoundError,
  GitHubNetworkError,
  type FetchFn,
} from './github-client';

/**
 * Helper to create a mock fetch function that returns a predefined Response.
 */
function mockFetch(response: Response): FetchFn {
  return async () => response;
}

/**
 * Helper to create a mock fetch that returns different responses based on URL patterns.
 */
function mockFetchByUrl(handlers: Array<{ pattern: string; response: Response }>): FetchFn {
  return async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const handler of handlers) {
      if (url.includes(handler.pattern)) {
        return handler.response;
      }
    }
    return new Response('Not found', { status: 404 });
  };
}

describe('GitHubClient', () => {
  describe('getLatestCommitSha', () => {
    it('returns SHA from mocked response', async () => {
      const expectedSha = 'abc123def456789';
      const fetchImpl = mockFetch(
        new Response(JSON.stringify({ sha: expectedSha }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createGitHubClient(fetchImpl);
      const sha = await client.getLatestCommitSha('hashicorp', 'terraform-provider-awscc', 'main');

      expect(sha).toBe(expectedSha);
    });

    it('throws GitHubRateLimitError on 403 response', async () => {
      const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
      const fetchImpl = mockFetch(
        new Response(JSON.stringify({ message: 'rate limit exceeded' }), {
          status: 403,
          headers: { 'x-ratelimit-reset': String(resetTimestamp) },
        }),
      );

      const client = createGitHubClient(fetchImpl);

      await expect(
        client.getLatestCommitSha('hashicorp', 'terraform-provider-awscc', 'main'),
      ).rejects.toThrow(GitHubRateLimitError);
    });
  });

  describe('getTree', () => {
    it('returns filtered tree entries from mocked recursive tree response', async () => {
      const commitSha = 'abc123';
      const treeData = {
        tree: [
          { path: 'internal/service/cloudformation/schemas/AWS_S3_Bucket.json', type: 'blob', sha: 'sha1' },
          { path: 'internal/service/cloudformation/schemas/AWS_EC2_Instance.json', type: 'blob', sha: 'sha2' },
          { path: 'internal/service/cloudformation/schemas', type: 'tree', sha: 'sha3' },
          { path: 'internal/other/file.go', type: 'blob', sha: 'sha4' },
          { path: 'README.md', type: 'blob', sha: 'sha5' },
        ],
        truncated: false,
      };

      const fetchImpl = mockFetchByUrl([
        {
          pattern: '/commits/',
          response: new Response(JSON.stringify({ sha: commitSha }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        },
        {
          pattern: '/git/trees/',
          response: new Response(JSON.stringify(treeData), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        },
      ]);

      const client = createGitHubClient(fetchImpl);
      const entries = await client.getTree(
        'hashicorp',
        'terraform-provider-awscc',
        'main',
        'internal/service/cloudformation/schemas',
      );

      // Should include entries under the path and the path itself
      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual({
        path: 'internal/service/cloudformation/schemas/AWS_S3_Bucket.json',
        type: 'blob',
        sha: 'sha1',
      });
      expect(entries).toContainEqual({
        path: 'internal/service/cloudformation/schemas/AWS_EC2_Instance.json',
        type: 'blob',
        sha: 'sha2',
      });
      expect(entries).toContainEqual({
        path: 'internal/service/cloudformation/schemas',
        type: 'tree',
        sha: 'sha3',
      });
      // Should NOT include entries outside the path
      expect(entries.find((e) => e.path === 'internal/other/file.go')).toBeUndefined();
      expect(entries.find((e) => e.path === 'README.md')).toBeUndefined();
    });

    it('throws GitHubNotFoundError on 404 response for tree', async () => {
      const commitSha = 'abc123';
      const fetchImpl = mockFetchByUrl([
        {
          pattern: '/commits/',
          response: new Response(JSON.stringify({ sha: commitSha }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        },
        {
          pattern: '/git/trees/',
          response: new Response(JSON.stringify({ message: 'Not Found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }),
        },
      ]);

      const client = createGitHubClient(fetchImpl);

      await expect(
        client.getTree('hashicorp', 'terraform-provider-awscc', 'main', 'nonexistent/path'),
      ).rejects.toThrow(GitHubNotFoundError);
    });
  });

  describe('listDirectory', () => {
    it('returns directory entries from Contents API response', async () => {
      const contentsData = [
        { name: 's3', path: 'internal/service/s3', type: 'dir' },
        { name: 'ec2', path: 'internal/service/ec2', type: 'dir' },
        { name: 'README.md', path: 'internal/service/README.md', type: 'file' },
      ];

      const fetchImpl = mockFetch(
        new Response(JSON.stringify(contentsData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createGitHubClient(fetchImpl);
      const entries = await client.listDirectory(
        'hashicorp',
        'terraform-provider-aws',
        'main',
        'internal/service',
      );

      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual({ name: 's3', path: 'internal/service/s3', type: 'dir' });
      expect(entries).toContainEqual({ name: 'ec2', path: 'internal/service/ec2', type: 'dir' });
      expect(entries).toContainEqual({ name: 'README.md', path: 'internal/service/README.md', type: 'file' });
    });

    it('throws GitHubNotFoundError on 404 response', async () => {
      const fetchImpl = mockFetch(
        new Response(JSON.stringify({ message: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createGitHubClient(fetchImpl);

      await expect(
        client.listDirectory('hashicorp', 'terraform-provider-aws', 'main', 'nonexistent/path'),
      ).rejects.toThrow(GitHubNotFoundError);
    });

    it('throws error when response is a single file instead of directory', async () => {
      // When you request contents of a file (not a directory), GitHub returns an object, not an array
      const fileData = { name: 'file.go', path: 'internal/service/file.go', type: 'file' };

      const fetchImpl = mockFetch(
        new Response(JSON.stringify(fileData), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createGitHubClient(fetchImpl);

      await expect(
        client.listDirectory('hashicorp', 'terraform-provider-aws', 'main', 'internal/service/file.go'),
      ).rejects.toThrow('Expected directory listing');
    });
  });

  describe('getFileContent', () => {
    it('returns raw file content from mocked response', async () => {
      const fileContent = `package s3\n\n// @SDKResource("aws_s3_bucket", name="Bucket", cfnType="AWS::S3::Bucket")\nfunc ResourceBucket() {}`;
      const fetchImpl = mockFetch(
        new Response(fileContent, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      const client = createGitHubClient(fetchImpl);
      const content = await client.getFileContent(
        'hashicorp',
        'terraform-provider-aws',
        'main',
        'internal/service/s3/bucket.go',
      );

      expect(content).toBe(fileContent);
    });

    it('throws GitHubNotFoundError on 404 response', async () => {
      const fetchImpl = mockFetch(
        new Response('Not Found', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      const client = createGitHubClient(fetchImpl);

      await expect(
        client.getFileContent('hashicorp', 'terraform-provider-aws', 'main', 'nonexistent.go'),
      ).rejects.toThrow(GitHubNotFoundError);
    });
  });

  describe('network failure', () => {
    it('throws GitHubNetworkError when fetch throws', async () => {
      const fetchImpl: FetchFn = async () => {
        throw new Error('ECONNREFUSED');
      };

      const client = createGitHubClient(fetchImpl);

      await expect(
        client.getLatestCommitSha('hashicorp', 'terraform-provider-awscc', 'main'),
      ).rejects.toThrow(GitHubNetworkError);
    });

    it('throws GitHubNetworkError for getFileContent when fetch throws', async () => {
      const fetchImpl: FetchFn = async () => {
        throw new TypeError('Failed to fetch');
      };

      const client = createGitHubClient(fetchImpl);

      await expect(
        client.getFileContent('hashicorp', 'terraform-provider-aws', 'main', 'file.go'),
      ).rejects.toThrow(GitHubNetworkError);
    });
  });

  describe('authentication', () => {
    it('includes token in headers when provided', async () => {
      let capturedHeaders: Record<string, string> = {};
      const fetchImpl: FetchFn = async (_url, init) => {
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return new Response(JSON.stringify({ sha: 'abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = createGitHubClient(fetchImpl, 'ghp_test_token_123');
      await client.getLatestCommitSha('hashicorp', 'terraform-provider-awscc', 'main');

      expect(capturedHeaders['Authorization']).toBe('Bearer ghp_test_token_123');
    });

    it('does not include Authorization header when no token is provided', async () => {
      let capturedHeaders: Record<string, string> = {};
      const fetchImpl: FetchFn = async (_url, init) => {
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        return new Response(JSON.stringify({ sha: 'abc123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      // Pass empty string as token to avoid picking up env var
      const client = createGitHubClient(fetchImpl, '');
      await client.getLatestCommitSha('hashicorp', 'terraform-provider-awscc', 'main');

      expect(capturedHeaders['Authorization']).toBeUndefined();
    });
  });
});
