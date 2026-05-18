import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Property-based tests for data-utilities-routes upload file name validation.
 * Uses fast-check to verify that only allowed file names are accepted.
 */

// --- Mocks ---

const mockPutObject = vi.fn().mockResolvedValue(undefined);
const mockGetObject = vi.fn().mockResolvedValue('[]');

vi.mock('../services/s3-client', () => ({
  S3BucketClient: vi.fn().mockImplementation(() => ({
    putObject: mockPutObject,
    getObject: mockGetObject,
  })),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      LastModified: new Date('2024-01-01T00:00:00Z'),
      ContentLength: 100,
    }),
  })),
  HeadObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

// --- Import after mocks ---

import { ALLOWED_DATA_FILES, postDataUploadRoute, postMergePreviewRoute } from './data-utilities-routes';

// --- Helpers ---

function makeUploadEvent(fileName: string, content: string): APIGatewayProxyEvent {
  return {
    body: JSON.stringify({ fileName, content }),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/data/upload',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
  };
}

// --- Property Tests ---

/**
 * Feature: external-sync-settings, Property 4: Upload file name validation
 * Validates: Requirements 8.2
 *
 * For any string that is not one of the allowed DataFile names
 * (regions, products, apis, cfn_resources), an upload request with that file name
 * SHALL be rejected with a 400 error. For any string from the allowed set,
 * the upload SHALL be accepted.
 */
describe('Feature: external-sync-settings, Property 4: Upload file name validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_BUCKET_NAME = 'test-bucket';
  });

  it('rejects any file name not in the allowed set with 400', async () => {
    // Generator: arbitrary strings that are NOT in the allowed set
    const disallowedFileNameArb = fc
      .string({ minLength: 0, maxLength: 100 })
      .filter(s => !ALLOWED_DATA_FILES.includes(s as (typeof ALLOWED_DATA_FILES)[number]));

    await fc.assert(
      fc.asyncProperty(disallowedFileNameArb, async (fileName) => {
        const event = makeUploadEvent(fileName, '[]');
        const result = await postDataUploadRoute(event);

        expect(result.statusCode).toBe(400);
        const body = JSON.parse(result.body);
        expect(body.error).toBe('Invalid file name. Allowed: regions, products, apis, cfn_resources');
      }),
      { numRuns: 100 },
    );
  });

  it('accepts any file name from the allowed set (does not return 400 for file name)', async () => {
    // Generator: pick from the allowed set
    const allowedFileNameArb = fc.constantFrom(...ALLOWED_DATA_FILES);

    await fc.assert(
      fc.asyncProperty(allowedFileNameArb, async (fileName) => {
        const event = makeUploadEvent(fileName, '[]');
        const result = await postDataUploadRoute(event);

        // Should NOT be a 400 for file name validation
        // With valid JSON array content "[]", it should succeed (200)
        expect(result.statusCode).not.toBe(400);
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: external-sync-settings, Property 5: Upload JSON array validation
 * Validates: Requirements 8.3
 *
 * For any string that is not valid JSON or is valid JSON but not an array,
 * an upload request with that content SHALL be rejected with a 400 error.
 * For any valid JSON array string, the upload SHALL be accepted.
 */
describe('Feature: external-sync-settings, Property 5: Upload JSON array validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_BUCKET_NAME = 'test-bucket';
  });

  it('rejects content that is not a valid JSON array with 400', async () => {
    // Generator: strings that are either not valid JSON at all,
    // or valid JSON but not arrays (objects, strings, numbers, booleans, null)
    const nonJsonArrayArb = fc.oneof(
      // Not valid JSON at all - arbitrary strings that won't parse
      fc.string({ minLength: 1, maxLength: 200 }).filter(s => {
        try {
          JSON.parse(s);
          return false;
        } catch {
          return true;
        }
      }),
      // Valid JSON but not an array: objects
      fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue()).map(obj => JSON.stringify(obj)),
      // Valid JSON but not an array: strings
      fc.string().map(s => JSON.stringify(s)),
      // Valid JSON but not an array: numbers
      fc.oneof(fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true })).map(n => JSON.stringify(n)),
      // Valid JSON but not an array: booleans
      fc.boolean().map(b => JSON.stringify(b)),
      // Valid JSON but not an array: null
      fc.constant('null'),
    );

    await fc.assert(
      fc.asyncProperty(nonJsonArrayArb, async (content) => {
        const event = makeUploadEvent('regions', content);
        const result = await postDataUploadRoute(event);

        expect(result.statusCode).toBe(400);
        const body = JSON.parse(result.body);
        expect(body.error).toBe('Content must be a valid JSON array');
      }),
      { numRuns: 100 },
    );
  });

  it('accepts content that is a valid JSON array (does not return 400 for content)', async () => {
    // Generator: valid JSON arrays of arbitrary JSON values
    const jsonArrayArb = fc.array(fc.jsonValue()).map(arr => JSON.stringify(arr));

    await fc.assert(
      fc.asyncProperty(jsonArrayArb, async (content) => {
        const event = makeUploadEvent('regions', content);
        const result = await postDataUploadRoute(event);

        // Should NOT be a 400 error — with a valid file name and valid JSON array,
        // the request should be accepted (200 success)
        expect(result.statusCode).not.toBe(400);
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: external-sync-settings, Property 6: Merge preview accuracy
 * Validates: Requirements 9.1
 *
 * For any existing dataset (a JSON array of items with unique Region IDs) and any uploaded dataset,
 * the merge preview SHALL report: additions = count of uploaded item IDs not present in existing,
 * updates = count of uploaded item IDs present in existing, and totalAfterMerge = existing.length + additions.
 */
describe('Feature: external-sync-settings, Property 6: Merge preview accuracy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATA_BUCKET_NAME = 'test-bucket';
  });

  function makeMergePreviewEvent(fileName: string, content: string): APIGatewayProxyEvent {
    return {
      body: JSON.stringify({ fileName, content }),
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/data/merge/preview',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      requestContext: {} as APIGatewayProxyEvent['requestContext'],
      resource: '',
    };
  }

  it('correctly computes additions, updates, and totalAfterMerge for regions', async () => {
    // Generator: unique arrays of region objects for existing and uploaded datasets
    const regionArb = fc.uniqueArray(
      fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
      { minLength: 0, maxLength: 20 },
    ).map(regions => regions.map(r => ({ Region: r })));

    await fc.assert(
      fc.asyncProperty(regionArb, regionArb, async (existingRegions, uploadedRegions) => {
        // Mock S3 getObject to return the existing dataset
        mockGetObject.mockResolvedValue(JSON.stringify(existingRegions));

        const content = JSON.stringify(uploadedRegions);
        const event = makeMergePreviewEvent('regions', content);
        const result = await postMergePreviewRoute(event);

        expect(result.statusCode).toBe(200);
        const body = JSON.parse(result.body);

        // Compute expected values
        const existingIds = new Set(existingRegions.map(r => r.Region));
        const uploadedIds = uploadedRegions.map(r => r.Region);

        const expectedAdditions = uploadedIds.filter(id => !existingIds.has(id)).length;
        const expectedUpdates = uploadedIds.filter(id => existingIds.has(id)).length;
        const expectedTotalAfterMerge = existingRegions.length + expectedAdditions;

        expect(body.additions).toBe(expectedAdditions);
        expect(body.updates).toBe(expectedUpdates);
        expect(body.totalAfterMerge).toBe(expectedTotalAfterMerge);
      }),
      { numRuns: 100 },
    );
  });
});


/**
 * Feature: external-sync-settings, Property 7: Merge additive invariant
 * Validates: Requirements 9.2
 *
 * For any existing dataset and any uploaded dataset, after performing the merge:
 * (1) every item ID from the original dataset SHALL still be present in the result,
 * (2) every item ID from the uploaded dataset SHALL be present in the result, and
 * (3) the result length SHALL be greater than or equal to the original dataset length.
 */

import { mergeJson } from '../data-fetch/merge/merge-json';

describe('Feature: external-sync-settings, Property 7: Merge additive invariant', () => {
  it('preserves all original IDs, includes all uploaded IDs, and result length >= original length', () => {
    // Generator: arrays of region objects with unique Region fields
    const regionArrayArb = fc.uniqueArray(
      fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
      { minLength: 0, maxLength: 20 },
    ).map(regions => regions.map(r => ({ Region: r })));

    fc.assert(
      fc.property(regionArrayArb, regionArrayArb, (existingRegions, uploadedRegions) => {
        const existingJson = JSON.stringify(existingRegions);
        const uploadedJson = JSON.stringify(uploadedRegions);

        // Perform merge using the identity function for regions
        const getId = (r: { Region: string }) => r.Region;
        const mergedStr = mergeJson<{ Region: string }>([existingJson, uploadedJson], getId);
        const merged = JSON.parse(mergedStr) as { Region: string }[];

        const mergedIds = new Set(merged.map(r => r.Region));

        // (1) Every original Region ID is still present in the merged result
        for (const item of existingRegions) {
          expect(mergedIds.has(item.Region)).toBe(true);
        }

        // (2) Every uploaded Region ID is present in the merged result
        for (const item of uploadedRegions) {
          expect(mergedIds.has(item.Region)).toBe(true);
        }

        // (3) The merged result length >= the original dataset length
        expect(merged.length).toBeGreaterThanOrEqual(existingRegions.length);
      }),
      { numRuns: 100 },
    );
  });
});
