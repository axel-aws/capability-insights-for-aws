/**
 * GitHub REST API client for fetching Terraform provider data.
 *
 * Uses the Git Trees API for efficient recursive tree fetching (single call),
 * raw.githubusercontent.com for file content (doesn't count against API rate limit),
 * and the Commits API for branch SHA retrieval.
 *
 * Supports optional GITHUB_TOKEN environment variable for higher rate limits
 * (5000 req/hour authenticated vs 60 req/hour unauthenticated).
 */

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

export interface GitHubClient {
  /** Get the tree (file listing) for a path in a repo */
  getTree(owner: string, repo: string, branch: string, path: string): Promise<TreeEntry[]>;

  /** Get raw file content */
  getFileContent(owner: string, repo: string, branch: string, path: string): Promise<string>;

  /** Get the latest commit SHA for a branch */
  getLatestCommitSha(owner: string, repo: string, branch: string): Promise<string>;

  /** List directory contents using the Contents API (non-recursive, up to 1000 entries) */
  listDirectory(owner: string, repo: string, branch: string, path: string): Promise<DirectoryEntry[]>;
}

export class GitHubRateLimitError extends Error {
  public readonly resetAt: Date;

  constructor(resetAt: Date) {
    const resetTime = resetAt.toISOString();
    super(`GitHub API rate limit exceeded. Resets at ${resetTime}`);
    this.name = 'GitHubRateLimitError';
    this.resetAt = resetAt;
  }
}

export class GitHubNotFoundError extends Error {
  constructor(resource: string) {
    super(`GitHub resource not found: ${resource}`);
    this.name = 'GitHubNotFoundError';
  }
}

export class GitHubNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(`GitHub API network error: ${message}`);
    this.name = 'GitHubNetworkError';
  }
}

/** Type for the fetch function to allow dependency injection for testing */
export type FetchFn = typeof globalThis.fetch;

/**
 * Handles GitHub API response errors, throwing typed errors for
 * rate limiting (403), not found (404), and other failures.
 */
async function handleResponseError(response: Response, resource: string): Promise<never> {
  if (response.status === 403) {
    const resetHeader = response.headers.get('x-ratelimit-reset');
    const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : new Date();
    throw new GitHubRateLimitError(resetAt);
  }

  if (response.status === 404) {
    throw new GitHubNotFoundError(resource);
  }

  const body = await response.text().catch(() => 'unknown error');
  throw new Error(`GitHub API error (${response.status}) for ${resource}: ${body}`);
}

/**
 * Creates a GitHubClient instance.
 *
 * @param fetchImpl - Optional fetch implementation for dependency injection (testing).
 *                    Defaults to globalThis.fetch.
 * @param token - Optional GitHub token. Defaults to GITHUB_TOKEN environment variable.
 */
export function createGitHubClient(fetchImpl?: FetchFn, token?: string): GitHubClient {
  const fetchFn: FetchFn = fetchImpl ?? globalThis.fetch;
  const githubToken = token ?? process.env.GITHUB_TOKEN;

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'capability-insights-terraform-overlay',
    };
    if (githubToken) {
      headers['Authorization'] = `Bearer ${githubToken}`;
    }
    return headers;
  }

  async function apiRequest(url: string, resource: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetchFn(url, { headers: buildHeaders() });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubNetworkError(message, error);
    }

    if (!response.ok) {
      await handleResponseError(response, resource);
    }

    return response;
  }

  return {
    async getLatestCommitSha(owner: string, repo: string, branch: string): Promise<string> {
      const url = `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`;
      const resource = `${owner}/${repo}@${branch}`;
      const response = await apiRequest(url, resource);
      const data = (await response.json()) as { sha: string };
      return data.sha;
    },

    async getTree(owner: string, repo: string, branch: string, path: string): Promise<TreeEntry[]> {
      // First get the commit SHA for the branch
      const commitSha = await this.getLatestCommitSha(owner, repo, branch);

      // Fetch the full recursive tree using the commit SHA
      const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`;
      const resource = `${owner}/${repo}/tree/${commitSha}`;
      const response = await apiRequest(url, resource);

      const data = (await response.json()) as {
        tree: Array<{ path: string; type: string; sha: string }>;
        truncated?: boolean;
      };

      // Normalize the path prefix for filtering (ensure no trailing slash for comparison)
      const prefix = path.endsWith('/') ? path : path + '/';

      // Filter entries that are under the specified path
      return data.tree
        .filter((entry) => entry.path.startsWith(prefix) || entry.path === path)
        .filter((entry) => entry.type === 'blob' || entry.type === 'tree')
        .map((entry) => ({
          path: entry.path,
          type: entry.type as 'blob' | 'tree',
          sha: entry.sha,
        }));
    },

    async listDirectory(owner: string, repo: string, branch: string, path: string): Promise<DirectoryEntry[]> {
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
      const resource = `${owner}/${repo}/contents/${path}@${branch}`;
      const response = await apiRequest(url, resource);

      const data = (await response.json()) as Array<{ name: string; path: string; type: string }>;

      if (!Array.isArray(data)) {
        throw new Error(`Expected directory listing for ${resource}, got a single file`);
      }

      return data.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type === 'dir' ? 'dir' as const : 'file' as const,
      }));
    },

    async getFileContent(owner: string, repo: string, branch: string, path: string): Promise<string> {
      // Use raw.githubusercontent.com — simpler and doesn't count against API rate limit
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      const resource = `${owner}/${repo}/${branch}/${path}`;

      let response: Response;
      try {
        response = await fetchFn(url, {
          headers: {
            'User-Agent': 'capability-insights-terraform-overlay',
            ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
          },
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new GitHubNetworkError(message, error);
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new GitHubNotFoundError(resource);
        }
        if (response.status === 403) {
          const resetHeader = response.headers.get('x-ratelimit-reset');
          const resetAt = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : new Date();
          throw new GitHubRateLimitError(resetAt);
        }
        const body = await response.text().catch(() => 'unknown error');
        throw new Error(`GitHub raw content error (${response.status}) for ${resource}: ${body}`);
      }

      return response.text();
    },
  };
}
