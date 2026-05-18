/**
 * Repository Analyzer
 *
 * Analyzes GitHub repositories to extract AWS resource types and API operations
 * from source files. Supports Go files (SDK client calls), Java (AWS SDK v2),
 * Python (boto3), TypeScript/JavaScript (AWS SDK v3), CloudFormation templates
 * (YAML/JSON), and Terraform files (HCL).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { CapabilitySet } from '../../../../shared/types/infrastructure-planning/plan-configuration';
import { parseResourceGoFile } from '../../../terraform-overlay/classic-resource-parser';
import { parseCfnTemplate } from './cfn-template-parser';
import { parseJavaFile } from './java-sdk-parser';
import { parsePythonFile } from './python-sdk-parser';
import { parseTerraformTemplate } from './terraform-template-parser';
import { parseTypeScriptFile } from './typescript-sdk-parser';

/**
 * Regex pattern to validate GitHub repository URLs.
 * Accepts: https://github.com/{owner}/{repo}
 * Owner and repo must contain valid GitHub identifier characters (alphanumeric, hyphens, underscores, dots).
 */
const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/?$/;

/**
 * Represents a file entry from the GitHub Trees API response.
 */
interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

/**
 * Response from the GitHub Trees API.
 */
interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

/**
 * Maximum number of concurrent file fetch requests to avoid GitHub API rate limiting.
 */
const MAX_CONCURRENCY = 15;

/**
 * Elapsed time cutoff in milliseconds (50 seconds), leaving a 10-second buffer
 * for response handling within the 60-second Lambda timeout.
 */
const TIMEOUT_CUTOFF_MS = 50_000;

/**
 * Language priority ordering for file processing.
 * Higher-priority languages are processed first to maximize value within timeout.
 */
type SdkLanguage = 'go' | 'java' | 'python' | 'typescript';

const LANGUAGE_PRIORITY: SdkLanguage[] = ['go', 'java', 'python', 'typescript'];

/**
 * Represents a file to be fetched and parsed, with its classified language type.
 */
interface ClassifiedFile {
  entry: GitHubTreeEntry;
  language: SdkLanguage | 'yaml' | 'json' | 'terraform';
}

/**
 * Result of concurrent file fetching with timeout handling.
 */
interface FetchResult {
  /** Number of files successfully processed */
  filesProcessed: number;
  /** Total number of files identified for processing */
  totalFilesIdentified: number;
  /** Whether the processing was cut short due to timeout */
  timedOut: boolean;
  /** Extracted API operations from SDK files */
  apiOperations: Set<string>;
  /** Extracted CloudFormation resource types */
  cfnResourceTypes: Set<string>;
  /** Extracted Terraform resource types */
  terraformResourceTypes: Set<string>;
}

/**
 * Validates a GitHub repository URL format.
 *
 * @param url - The URL to validate
 * @returns true if the URL matches `https://github.com/{owner}/{repo}` format
 */
export function isValidGitHubUrl(url: string): boolean {
  return GITHUB_URL_PATTERN.test(url);
}

/**
 * Extracts the owner and repository name from a GitHub URL.
 *
 * @param url - A valid GitHub repository URL
 * @returns An object with `owner` and `repo` fields
 * @throws Error if the URL is not a valid GitHub repository URL
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const match = url.match(GITHUB_URL_PATTERN);
  if (!match) {
    throw new Error(
      'Invalid GitHub repository URL format. Expected: https://github.com/{owner}/{repo}'
    );
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Classifies a file path by its extension to determine how it should be parsed.
 */
export function classifyFile(
  path: string,
): 'go' | 'java' | 'python' | 'typescript' | 'yaml' | 'json' | 'terraform' | 'unknown' {
  if (path.endsWith('.go')) return 'go';
  if (path.endsWith('.java')) return 'java';
  if (path.endsWith('.py')) return 'python';
  if (path.endsWith('.ts') || path.endsWith('.js')) return 'typescript';
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.tf')) return 'terraform';
  return 'unknown';
}

/**
 * Determines whether a file should be excluded from SDK parsing based on its path.
 *
 * Excludes files in test directories, vendor directories, and files matching
 * test file naming patterns.
 *
 * @param path - The file path to check
 * @returns true if the file should be excluded from processing
 */
export function shouldExcludeFile(path: string): boolean {
  const testDirs = ['test', 'tests', '__tests__', 'spec'];
  const singleSegmentVendorDirs = [
    'vendor',
    'node_modules',
    '.venv',
    'site-packages',
    '__pycache__',
  ];
  const multiSegmentVendorDirs = [
    'target/dependency',
    'build/classes',
  ];
  const testFilePatterns = [/_test\./, /\.test\./, /\.spec\./];

  const segments = path.split('/');

  // Check single-segment directory exclusions
  for (const segment of segments.slice(0, -1)) {
    if (testDirs.includes(segment) || singleSegmentVendorDirs.includes(segment)) return true;
  }

  // Check multi-segment vendor directory exclusions
  const dirPath = segments.slice(0, -1).join('/');
  for (const vendorDir of multiSegmentVendorDirs) {
    if (dirPath.includes(vendorDir)) return true;
  }

  // Check test file patterns
  const filename = segments[segments.length - 1];
  if (testFilePatterns.some(p => p.test(filename))) return true;

  return false;
}

/**
 * RepositoryAnalyzer analyzes GitHub repositories to extract AWS resource types
 * and API operations from source files.
 *
 * It uses the GitHub Trees API to list all files recursively, then fetches and
 * parses relevant files based on their extension:
 * - `.go` files: Extracts AWS SDK client method calls
 * - `.java` files: Extracts AWS SDK for Java v2 client method calls
 * - `.py` files: Extracts boto3 client and resource method calls
 * - `.ts`/`.js` files: Extracts AWS SDK v3 Command pattern and v2-style calls
 * - `.yaml`/`.json` files: Checks for CloudFormation Resources section
 * - `.tf` files: Extracts Terraform resource block types
 *
 * Files are fetched concurrently (max 15 requests) with a 50-second timeout cutoff.
 * Language priority ordering ensures highest-value files are processed first:
 * Go → Java → Python → TypeScript/JavaScript.
 */
export class RepositoryAnalyzer {
  /**
   * Analyzes a GitHub repository and extracts a CapabilitySet.
   *
   * @param repositoryUrl - The GitHub repository URL (https://github.com/{owner}/{repo})
   * @param pat - GitHub Personal Access Token for authentication
   * @returns A CapabilitySet containing all extracted resource types and API operations
   * @throws Error if the URL is invalid, the token is invalid, or the repository cannot be accessed
   */
  async analyze(repositoryUrl: string, pat: string): Promise<CapabilitySet> {
    // Validate URL format
    if (!isValidGitHubUrl(repositoryUrl)) {
      throw new Error(
        'Invalid GitHub repository URL format. Expected: https://github.com/{owner}/{repo}'
      );
    }

    const { owner, repo } = parseGitHubUrl(repositoryUrl);

    // Fetch the repository file tree
    const tree = await this.fetchRepositoryTree(owner, repo, pat);

    // Classify and filter files, then sort by language priority
    const classifiedFiles = this.classifyAndFilterFiles(tree);

    // Process files concurrently with timeout handling
    const fetchResult = await this.fetchAndProcessFiles(classifiedFiles, owner, repo, pat);

    // Build and return the CapabilitySet
    const capabilitySet: CapabilitySet = {
      cfnResourceTypes: Array.from(fetchResult.cfnResourceTypes).sort(),
      terraformResourceTypes: Array.from(fetchResult.terraformResourceTypes).sort(),
      apiOperations: Array.from(fetchResult.apiOperations).sort(),
      serviceNames: this.deriveServiceNames(Array.from(fetchResult.cfnResourceTypes)),
      terraformToCfnMapping: {},
    };

    // Add partial result metadata if timeout occurred
    if (fetchResult.timedOut) {
      capabilitySet.partialResult = {
        isPartial: true,
        filesProcessed: fetchResult.filesProcessed,
        totalFilesIdentified: fetchResult.totalFilesIdentified,
      };
    }

    return capabilitySet;
  }

  /**
   * Classifies files from the tree by extension, applies exclusion rules,
   * and sorts by language priority (Go → Java → Python → TS/JS, then CFN/TF).
   */
  private classifyAndFilterFiles(tree: GitHubTreeEntry[]): ClassifiedFile[] {
    const sdkFiles: ClassifiedFile[] = [];
    const infraFiles: ClassifiedFile[] = [];

    for (const entry of tree) {
      if (entry.type !== 'blob') continue;
      if (shouldExcludeFile(entry.path)) continue;

      const fileType = classifyFile(entry.path);
      if (fileType === 'unknown') continue;

      const classified: ClassifiedFile = { entry, language: fileType };

      if (fileType === 'go' || fileType === 'java' || fileType === 'python' || fileType === 'typescript') {
        sdkFiles.push(classified);
      } else {
        infraFiles.push(classified);
      }
    }

    // Sort SDK files by language priority
    sdkFiles.sort((a, b) => {
      const aIdx = LANGUAGE_PRIORITY.indexOf(a.language as SdkLanguage);
      const bIdx = LANGUAGE_PRIORITY.indexOf(b.language as SdkLanguage);
      return aIdx - bIdx;
    });

    // SDK files first (in priority order), then infra files
    return [...sdkFiles, ...infraFiles];
  }

  /**
   * Fetches and processes files concurrently with a maximum concurrency of 15
   * simultaneous requests and a 50-second elapsed time cutoff.
   *
   * When the timeout is reached, processing stops and results collected so far
   * are returned with the timedOut flag set.
   *
   * @param files - Classified files sorted by priority
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param pat - GitHub Personal Access Token
   * @returns FetchResult with extracted data and processing metadata
   */
  async fetchAndProcessFiles(
    files: ClassifiedFile[],
    owner: string,
    repo: string,
    pat: string
  ): Promise<FetchResult> {
    const startTime = Date.now();
    const totalFilesIdentified = files.length;
    let filesProcessed = 0;
    let timedOut = false;

    const apiOperations = new Set<string>();
    const cfnResourceTypes = new Set<string>();
    const terraformResourceTypes = new Set<string>();

    // Process files in batches with concurrency limit
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

      // Fetch and process batch concurrently
      const batchPromises = batch.map(async (classifiedFile) => {
        try {
          const content = await this.fetchFileContent(owner, repo, classifiedFile.entry.path, pat);
          return { classifiedFile, content };
        } catch {
          // Skip files that cannot be fetched
          return { classifiedFile, content: null };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      // Check timeout after batch completes
      if (Date.now() - startTime >= TIMEOUT_CUTOFF_MS) {
        // Process whatever results we got from this batch before stopping
        for (const result of batchResults) {
          if (result.content === null) {
            filesProcessed++;
            continue;
          }
          this.processFileContent(
            result.classifiedFile,
            result.content,
            apiOperations,
            cfnResourceTypes,
            terraformResourceTypes
          );
          filesProcessed++;
        }
        timedOut = true;
        break;
      }

      // Process batch results
      for (const result of batchResults) {
        if (result.content === null) {
          filesProcessed++;
          continue;
        }
        this.processFileContent(
          result.classifiedFile,
          result.content,
          apiOperations,
          cfnResourceTypes,
          terraformResourceTypes
        );
        filesProcessed++;
      }

      fileIndex = batchEnd;
    }

    return {
      filesProcessed,
      totalFilesIdentified,
      timedOut,
      apiOperations,
      cfnResourceTypes,
      terraformResourceTypes,
    };
  }

  /**
   * Processes a single file's content by routing it to the appropriate parser
   * based on its classified language type.
   */
  private processFileContent(
    classifiedFile: ClassifiedFile,
    content: string,
    apiOperations: Set<string>,
    cfnResourceTypes: Set<string>,
    terraformResourceTypes: Set<string>
  ): void {
    try {
      switch (classifiedFile.language) {
        case 'go': {
          const operations = parseResourceGoFile(content);
          for (const op of operations) {
            apiOperations.add(op);
          }
          break;
        }
        case 'java': {
          const operations = parseJavaFile(content);
          for (const op of operations) {
            apiOperations.add(op);
          }
          break;
        }
        case 'python': {
          const operations = parsePythonFile(content);
          for (const op of operations) {
            apiOperations.add(op);
          }
          break;
        }
        case 'typescript': {
          const operations = parseTypeScriptFile(content);
          for (const op of operations) {
            apiOperations.add(op);
          }
          break;
        }
        case 'yaml':
        case 'json': {
          if (this.looksLikeCfnTemplate(content)) {
            const types = parseCfnTemplate(content);
            for (const type of types) {
              cfnResourceTypes.add(type);
            }
          }
          break;
        }
        case 'terraform': {
          const types = parseTerraformTemplate(content);
          for (const type of types) {
            terraformResourceTypes.add(type);
          }
          break;
        }
      }
    } catch {
      // Skip files that cannot be parsed
    }
  }

  /**
   * Fetches the repository file tree using the GitHub Trees API (recursive).
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param pat - GitHub Personal Access Token
   * @returns Array of tree entries representing all files in the repository
   */
  private async fetchRepositoryTree(
    owner: string,
    repo: string,
    pat: string
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
      throw new Error('GitHub token is invalid or expired');
    }

    if (response.status === 404) {
      throw new Error(
        `Cannot access repository: https://github.com/${owner}/${repo}. The repository may not exist or the token may lack permissions.`
      );
    }

    if (!response.ok) {
      throw new Error(
        `GitHub API error: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as GitHubTreeResponse;
    return data.tree;
  }

  /**
   * Fetches the content of a single file from the repository.
   *
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param path - File path within the repository
   * @param pat - GitHub Personal Access Token
   * @returns The file content as a string
   */
  private async fetchFileContent(
    owner: string,
    repo: string,
    path: string,
    pat: string
  ): Promise<string> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github.v3.raw',
        'User-Agent': 'capability-insights-for-aws',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch file ${path}: ${response.status} ${response.statusText}`
      );
    }

    return response.text();
  }

  /**
   * Checks if a file content looks like a CloudFormation template by
   * checking for the presence of a "Resources" key.
   *
   * This is a lightweight check to avoid parsing every YAML/JSON file
   * as a CloudFormation template.
   */
  private looksLikeCfnTemplate(content: string): boolean {
    // Quick string check before attempting full parse
    return content.includes('"Resources"') || content.includes('Resources:');
  }

  /**
   * Derives service names from CloudFormation resource types.
   *
   * Extracts the service segment from `AWS::{ServiceName}::{ResourceType}`
   * and returns unique, sorted service names.
   */
  private deriveServiceNames(cfnResourceTypes: string[]): string[] {
    const serviceNames = new Set<string>();

    for (const type of cfnResourceTypes) {
      const parts = type.split('::');
      if (parts.length >= 2 && parts[0] === 'AWS') {
        serviceNames.add(parts[1]);
      }
    }

    return Array.from(serviceNames).sort();
  }
}
