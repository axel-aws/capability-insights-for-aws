import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';

/**
 * Property-based tests for data-fetch Lambda overlay token passthrough.
 *
 * Property 4: Token passthrough to overlay Lambda
 * **Validates: Requirements 7.2**
 *
 * For any non-empty token retrieved from Secrets Manager when overlay is enabled,
 * the invocation payload SHALL include that exact token in the `githubToken` field.
 */

// Mock the Lambda client
const lambdaMock = mockClient(LambdaClient);

// Mock the S3BucketClient
const mockGetObject = vi.fn();
const mockPutObject = vi.fn();
const mockListObjects = vi.fn();

vi.mock('./services/s3-client', () => ({
  S3BucketClient: vi.fn().mockImplementation(() => ({
    getObject: mockGetObject,
    putObject: mockPutObject,
    listObjects: mockListObjects,
  })),
}));

// Mock the SyncSettingsStore
const mockGetSettings = vi.fn();

vi.mock('./services/sync-settings-store', () => ({
  SyncSettingsStore: vi.fn().mockImplementation(() => ({
    getSettings: mockGetSettings,
  })),
}));

// Mock the GitHubTokenStore
const mockGetToken = vi.fn();

vi.mock('./services/github-token-store', () => ({
  GitHubTokenStore: vi.fn().mockImplementation(() => ({
    getToken: mockGetToken,
  })),
}));

// Mock the logger
vi.mock('./util/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Set environment variables before importing the handler
vi.stubEnv('SOURCE_ACCESS_POINT_ARN', 'arn:aws:s3:us-east-1:123456789012:accesspoint/test-ap');
vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');
vi.stubEnv('SOURCE_FOLDERS', 'folder1');
vi.stubEnv('POLICY_TABLE_NAME', 'test-policy-table');
vi.stubEnv('GITHUB_TOKEN_SECRET_NAME', 'test-github-pat-secret');
vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

// Import handler after env vars and mocks are set
const { handler } = await import('./data-fetch-lambda-main');

// --- Generators ---

/**
 * Generator for non-empty token strings representing GitHub PATs.
 * Tokens can contain any printable characters and must be non-empty.
 */
const nonEmptyTokenArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.length > 0);

// --- Property Tests ---

describe('Property 4: Token passthrough to overlay Lambda', () => {
  beforeEach(() => {
    lambdaMock.reset();
    mockGetObject.mockReset();
    mockPutObject.mockReset();
    mockListObjects.mockReset();
    mockGetSettings.mockReset();
    mockGetToken.mockReset();

    // Default: source folder has a valid manifest
    mockGetObject.mockImplementation((path: string) => {
      if (path.endsWith('manifest.json')) {
        return Promise.resolve('{}');
      }
      return Promise.resolve('[]');
    });

    // listObjects returns empty by default (no uploads)
    mockListObjects.mockResolvedValue([]);

    // putObject always succeeds
    mockPutObject.mockResolvedValue(undefined);

    // Default: overlay enabled
    mockGetSettings.mockResolvedValue({
      terraformOverlayEnabled: true,
      dataSyncEnabled: true,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('SOURCE_ACCESS_POINT_ARN', 'arn:aws:s3:us-east-1:123456789012:accesspoint/test-ap');
    vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');
    vi.stubEnv('SOURCE_FOLDERS', 'folder1');
    vi.stubEnv('POLICY_TABLE_NAME', 'test-policy-table');
    vi.stubEnv('GITHUB_TOKEN_SECRET_NAME', 'test-github-pat-secret');
    vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');
  });

  it('for any non-empty token, the overlay Lambda invocation payload contains that exact token', async () => {
    await fc.assert(
      fc.asyncProperty(nonEmptyTokenArb, async (token) => {
        lambdaMock.reset();
        mockGetToken.mockResolvedValue(token);

        // Overlay Lambda returns a successful response
        const overlayResponse = {
          statusCode: 200,
          awsccCount: 10,
          classicAwsCount: 5,
          classicApiMappingCount: 0,
        };

        lambdaMock.on(InvokeCommand).resolves({
          StatusCode: 200,
          Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
        });

        await handler();

        // Verify the Lambda was invoked exactly once
        const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
        expect(invokeCalls).toHaveLength(1);

        // Extract the payload and verify the token is passed through exactly
        const invokePayload = JSON.parse(invokeCalls[0].args[0].input.Payload as string);
        expect(invokePayload.githubToken).toBe(token);
      }),
      { numRuns: 100 },
    );
  });
});
