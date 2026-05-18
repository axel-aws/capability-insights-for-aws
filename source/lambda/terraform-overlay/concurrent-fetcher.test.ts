import { describe, it, expect, vi } from 'vitest';
import { fetchFilesConcurrently } from './concurrent-fetcher';

describe('fetchFilesConcurrently', () => {
  it('returns empty array for empty input', async () => {
    const fetchFn = vi.fn();
    const results = await fetchFilesConcurrently([], fetchFn);

    expect(results).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns all results when all fetches succeed', async () => {
    const fetchFn = vi.fn(async (path: string) => `content of ${path}`);
    const paths = ['file1.go', 'file2.go', 'file3.go'];

    const results = await fetchFilesConcurrently(paths, fetchFn);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ path: 'file1.go', result: 'content of file1.go' });
    expect(results[1]).toEqual({ path: 'file2.go', result: 'content of file2.go' });
    expect(results[2]).toEqual({ path: 'file3.go', result: 'content of file3.go' });
  });

  it('handles partial failures without aborting the batch', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fetchFn = vi.fn(async (path: string) => {
      if (path === 'bad-file.go') {
        throw new Error('Network timeout');
      }
      return `content of ${path}`;
    });

    const paths = ['good1.go', 'bad-file.go', 'good2.go'];
    const results = await fetchFilesConcurrently(paths, fetchFn);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ path: 'good1.go', result: 'content of good1.go' });
    expect(results[1]).toEqual({ path: 'bad-file.go', result: null, error: 'Network timeout' });
    expect(results[2]).toEqual({ path: 'good2.go', result: 'content of good2.go' });

    expect(warnSpy).toHaveBeenCalledWith('Failed to fetch "bad-file.go": Network timeout');
    warnSpy.mockRestore();
  });

  it('respects concurrency limit', async () => {
    let activeConcurrency = 0;
    let maxObservedConcurrency = 0;

    const fetchFn = vi.fn(async (path: string) => {
      activeConcurrency++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeConcurrency--;
      return `content of ${path}`;
    });

    const paths = Array.from({ length: 30 }, (_, i) => `file${i}.go`);
    const concurrency = 5;

    const results = await fetchFilesConcurrently(paths, fetchFn, concurrency);

    expect(results).toHaveLength(30);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(concurrency);
    expect(maxObservedConcurrency).toBeGreaterThan(1); // Verify actual parallelism occurred
  });

  it('uses default concurrency of 15', async () => {
    let activeConcurrency = 0;
    let maxObservedConcurrency = 0;

    const fetchFn = vi.fn(async (path: string) => {
      activeConcurrency++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, activeConcurrency);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeConcurrency--;
      return `content of ${path}`;
    });

    const paths = Array.from({ length: 50 }, (_, i) => `file${i}.go`);

    await fetchFilesConcurrently(paths, fetchFn);

    expect(maxObservedConcurrency).toBeLessThanOrEqual(15);
    expect(maxObservedConcurrency).toBeGreaterThan(1);
  });

  it('preserves result order matching input paths', async () => {
    // Use varying delays to ensure order is preserved regardless of completion order
    const fetchFn = vi.fn(async (path: string) => {
      const delay = path === 'slow.go' ? 50 : 5;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return `content of ${path}`;
    });

    const paths = ['slow.go', 'fast1.go', 'fast2.go'];
    const results = await fetchFilesConcurrently(paths, fetchFn);

    expect(results[0].path).toBe('slow.go');
    expect(results[1].path).toBe('fast1.go');
    expect(results[2].path).toBe('fast2.go');
  });

  it('handles non-Error thrown values', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const fetchFn = vi.fn(async (path: string) => {
      if (path === 'weird.go') {
        throw 'string error'; // eslint-disable-line no-throw-literal
      }
      return `content of ${path}`;
    });

    const paths = ['good.go', 'weird.go'];
    const results = await fetchFilesConcurrently(paths, fetchFn);

    expect(results[1]).toEqual({ path: 'weird.go', result: null, error: 'string error' });
    warnSpy.mockRestore();
  });

  it('works with generic type parameter', async () => {
    interface ParsedFile {
      name: string;
      lines: number;
    }

    const fetchFn = vi.fn(async (path: string): Promise<ParsedFile> => ({
      name: path,
      lines: path.length * 10,
    }));

    const paths = ['short.go', 'longer-file.go'];
    const results = await fetchFilesConcurrently<ParsedFile>(paths, fetchFn);

    expect(results[0].result).toEqual({ name: 'short.go', lines: 80 });
    expect(results[1].result).toEqual({ name: 'longer-file.go', lines: 140 });
  });
});
