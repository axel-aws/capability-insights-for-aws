/**
 * Concurrent file fetcher utility.
 *
 * Fetches multiple files in parallel with a configurable concurrency limit
 * using a semaphore/pool pattern. Individual failures are logged as warnings
 * without aborting the batch — partial results are returned for all paths.
 */

/** Default maximum number of concurrent fetch operations */
const DEFAULT_CONCURRENCY = 15;

export interface FetchResult<T> {
  path: string;
  result: T | null;
  error?: string;
}

/**
 * Fetch multiple files concurrently with a concurrency limit.
 *
 * Uses a semaphore/pool pattern to ensure no more than `concurrency`
 * fetch operations run simultaneously. Each path is processed independently —
 * individual failures are logged as warnings and do not abort the batch.
 *
 * Results are returned in the same order as the input paths array.
 *
 * @param paths - Array of file paths to fetch
 * @param fetchFn - Function to fetch and parse a single file
 * @param concurrency - Maximum concurrent requests (default: 15)
 */
export async function fetchFilesConcurrently<T>(
  paths: string[],
  fetchFn: (path: string) => Promise<T>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<FetchResult<T>[]> {
  if (paths.length === 0) {
    return [];
  }

  const results: FetchResult<T>[] = new Array(paths.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < paths.length) {
      const index = nextIndex;
      nextIndex++;

      const path = paths[index];
      try {
        const result = await fetchFn(path);
        results[index] = { path, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to fetch "${path}": ${message}`);
        results[index] = { path, result: null, error: message };
      }
    }
  }

  // Spawn workers up to the concurrency limit (or path count, whichever is smaller)
  const workerCount = Math.min(concurrency, paths.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return results;
}
