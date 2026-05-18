/**
 * GitHubFetchLambda — Entry point and handler
 *
 * A lightweight Lambda function deployed OUTSIDE the VPC (with internet access)
 * that fetches repository tree listings and file contents from the GitHub API
 * on behalf of the API Lambda (which runs in a VPC private subnet).
 *
 * Follows the TerraformOverlayLambda pattern.
 *
 * Runtime: nodejs24.x | Memory: 512 MB | Timeout: 120 seconds
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3
 */

import {
  isValidGitHubUrl,
  parseGitHubUrl,
  classifyFile,
  shouldExcludeFile,
} from './services/infrastructure-planning/parsers/repository-analyzer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Invocation payload accepted by this Lambda. */
export interface GitHubFetchRequest {
  repositoryUrl: string;
  pat: string;
}

/** A single entry from the GitHub Trees API response. */
interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

/** GitHub Trees API response shape. */
interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

/** Simplified tree entry returned in the success response. */
export interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

/** Success response from this Lambda. */
export interface GitHubFetchSuccessResponse {
  success: true;
  tree: TreeEntry[];
  files: Record<string, string>;
  metadata: {
    filesProcessed: number;
    totalFilesIdentified: number;
    timedOut: boolean;
  };
}

/** Error response from this Lambda. */
export interface GitHubFetchErrorResponse {
  success: false;
  error: string;
  errorType: 'auth' | 'not_found' | 'rate_limit' | 'timeout' | 'unknown';
}

/** Union response type. */
export type GitHubFetchResponse = GitHubFetchSuccessResponse | GitHubFetchErrorResponse;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of concurrent file fetch requests. */
const MAX_CONCURRENCY = 15;

/** Elapsed time cutoff in milliseconds (100 seconds), leaving a 20-second buffer
 *  for response handling within the 120-second Lambda timeout. */
const TIMEOUT_CUTOFF_MS = 100_000;

/** Allowed file extensions for fetching. */
const ALLOWED_EXTENSIONS = new Set(['.go', '.java', '.py', '.ts', '.js', '.yaml', '.yml', '.json', '.tf']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines whether a file path has an allowed extension.
 */
function hasAllowedExtension(path: string): boolean {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return false;
  return ALLOWED_EXTENSIONS.has(path.slice(lastDot));
}

/**
 * Returns a numeric priority for SDK language ordering.
 * Go (0) → Java (1) → Python (2) → TypeScript (3) → infra (4)
 */
function getFilePriority(path: string): number {
  const fileType = classifyFile(path);
  switch (fileType) {
    case 'go': return 0;
    case 'java': return 1;
    case 'python': return 2;
    case 'typescript': return 3;
    default: return 4;
  }
}

/**
 * Fetches a single file's raw content from the GitHub Contents API.
 */
async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  pat: string,
): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'capability-insights-for-aws',
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Fetches the repository tree using the GitHub Trees API (recursive).
 * Throws typed errors for 401 and 404 responses.
 */
async function fetchRepositoryTree(
  owner: string,
  repo: string,
  pat: string,
): Promise<GitHubTreeEntry[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'capability-insights-for-aws',
    },
  });

  if (response.status === 401) {
    const error = new Error('GitHub token is invalid or expired');
    (error as Error & { errorType: string }).errorType = 'auth';
    throw error;
  }

  if (response.status === 404) {
    const error = new Error(
      `Cannot access repository: https://github.com/${owner}/${repo}. The repository may not exist or the token may lack permissions.`
    );
    (error as Error & { errorType: string }).errorType = 'not_found';
    throw error;
  }

  if (response.status === 403) {
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    if (rateLimitRemaining === '0') {
      const error = new Error('GitHub API rate limit exceeded');
      (error as Error & { errorType: string }).errorType = 'rate_limit';
      throw error;
    }
  }

  if (!response.ok) {
    const error = new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    (error as Error & { errorType: string }).errorType = 'unknown';
    throw error;
  }

  const data = (await response.json()) as GitHubTreeResponse;
  return data.tree;
}

/**
 * Processes files concurrently with a maximum concurrency of MAX_CONCURRENCY
 * and a TIMEOUT_CUTOFF_MS elapsed time cutoff.
 */
async function fetchFilesConcurrently(
  files: string[],
  owner: string,
  repo: string,
  pat: string,
  startTime: number,
): Promise<{ filesMap: Record<string, string>; filesProcessed: number; timedOut: boolean }> {
  const filesMap: Record<string, string> = {};
  let filesProcessed = 0;
  let timedOut = false;
  let fileIndex = 0;

  while (fileIndex < files.length) {
    // Check timeout before starting a new batch
    if (Date.now() - startTime >= TIMEOUT_CUTOFF_MS) {
      timedOut = true;
      break;
    }

    // Determine batch size (up to MAX_CONCURRENCY)
    const batchEnd = Math.min(fileIndex + MAX_CONCURRENCY, files.length);
    const batch = files.slice(fileIndex, batchEnd);

    // Fetch batch concurrently
    const batchPromises = batch.map(async (filePath) => {
      const content = await fetchFileContent(owner, repo, filePath, pat);
      return { filePath, content };
    });

    const batchResults = await Promise.all(batchPromises);

    // Check timeout after batch completes
    if (Date.now() - startTime >= TIMEOUT_CUTOFF_MS) {
      // Still collect results from this batch before stopping
      for (const result of batchResults) {
        filesProcessed++;
        if (result.content !== null) {
          filesMap[result.filePath] = result.content;
        }
      }
      timedOut = true;
      break;
    }

    // Process batch results
    for (const result of batchResults) {
      filesProcessed++;
      if (result.content !== null) {
        filesMap[result.filePath] = result.content;
      }
    }

    fileIndex = batchEnd;
  }

  return { filesMap, filesProcessed, timedOut };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Lambda handler entry point for the GitHubFetchLambda.
 *
 * Accepts a payload with `repositoryUrl` and `pat`, fetches the repository tree
 * and relevant file contents from GitHub, and returns them to the caller.
 */
export async function handler(event: GitHubFetchRequest): Promise<GitHubFetchResponse> {
  const startTime = Date.now();

  try {
    // Validate input
    if (!event.repositoryUrl || !event.pat) {
      return {
        success: false,
        error: 'Missing required fields: repositoryUrl and pat',
        errorType: 'unknown',
      };
    }

    // Validate GitHub URL format
    if (!isValidGitHubUrl(event.repositoryUrl)) {
      return {
        success: false,
        error: 'Invalid GitHub repository URL format. Expected: https://github.com/{owner}/{repo}',
        errorType: 'unknown',
      };
    }

    const { owner, repo } = parseGitHubUrl(event.repositoryUrl);

    // Fetch the repository file tree
    const rawTree = await fetchRepositoryTree(owner, repo, event.pat);

    // Build the simplified tree for the response (all blob entries)
    const tree: TreeEntry[] = rawTree
      .filter((entry) => entry.type === 'blob')
      .map((entry) => ({
        path: entry.path,
        type: entry.type,
        ...(entry.size !== undefined ? { size: entry.size } : {}),
      }));

    // Classify and filter files
    const relevantFiles: string[] = rawTree
      .filter((entry) => {
        if (entry.type !== 'blob') return false;
        if (!hasAllowedExtension(entry.path)) return false;
        if (shouldExcludeFile(entry.path)) return false;
        return true;
      })
      .map((entry) => entry.path);

    const totalFilesIdentified = relevantFiles.length;

    // Sort by priority: SDK files (Go → Java → Python → TypeScript) before infra files
    relevantFiles.sort((a, b) => getFilePriority(a) - getFilePriority(b));

    // Fetch file contents concurrently with timeout
    const { filesMap, filesProcessed, timedOut } = await fetchFilesConcurrently(
      relevantFiles,
      owner,
      repo,
      event.pat,
      startTime,
    );

    return {
      success: true,
      tree,
      files: filesMap,
      metadata: {
        filesProcessed,
        totalFilesIdentified,
        timedOut,
      },
    };
  } catch (error: unknown) {
    // Handle typed errors from fetchRepositoryTree
    const err = error as Error & { errorType?: string };
    const errorType = err.errorType as GitHubFetchErrorResponse['errorType'] | undefined;

    if (errorType) {
      return {
        success: false,
        error: err.message,
        errorType,
      };
    }

    // Check if it's a timeout-related error
    if (Date.now() - startTime >= TIMEOUT_CUTOFF_MS) {
      return {
        success: false,
        error: 'Processing timed out while fetching repository data',
        errorType: 'timeout',
      };
    }

    // Unknown error
    return {
      success: false,
      error: err.message || 'An unknown error occurred',
      errorType: 'unknown',
    };
  }
}
