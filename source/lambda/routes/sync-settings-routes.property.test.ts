import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { StatusCode } from '../constants/status-codes';

/**
 * Property-based tests for sync-settings-routes.
 * Property 3: Raw token never leaked in API responses.
 *
 * **Validates: Requirements 5.3**
 */

// --- Mock SyncSettingsStore ---
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/sync-settings-store', () => ({
  SyncSettingsStore: vi.fn().mockImplementation(() => ({
    getSettings: mockGetSettings,
    updateSettings: mockUpdateSettings,
  })),
}));

// --- Mock GitHubTokenStore ---
const mockHasToken = vi.fn();
const mockPutToken = vi.fn();
const mockDeleteToken = vi.fn();
const mockGetToken = vi.fn();

vi.mock('../services/github-token-store', () => ({
  GitHubTokenStore: vi.fn().mockImplementation(() => ({
    hasToken: mockHasToken,
    putToken: mockPutToken,
    deleteToken: mockDeleteToken,
    getToken: mockGetToken,
  })),
}));

// --- Mock logger ---
vi.mock('../util/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// --- Mock environment ---
vi.mock('../constants/environment', () => ({
  EnvironmentKey: {
    POLICY_TABLE_NAME: 'POLICY_TABLE_NAME',
    GITHUB_TOKEN_SECRET_NAME: 'GITHUB_TOKEN_SECRET_NAME',
  },
  getEnv: vi.fn().mockReturnValue('mock-value'),
}));

// --- Import after mocks ---
import { getSyncSettingsRoute, putSyncSettingsRoute } from './sync-settings-routes';

// --- Helpers ---

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/syncSettings',
    body: null,
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: '',
    requestContext: {
      accountId: '123456789012',
      apiId: 'test',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
      path: '/syncSettings',
      stage: 'prod',
      requestId: 'test-id',
      requestTimeEpoch: 0,
      resourceId: '',
      resourcePath: '',
    },
    ...overrides,
  };
}

// --- Generators ---

/**
 * Generator for realistic PAT strings that could be stored in Secrets Manager.
 * Uses a prefix to ensure the token is distinctive and wouldn't naturally
 * appear in JSON field names or boolean values. Real GitHub PATs follow
 * patterns like "ghp_xxxx" or "github_pat_xxxx" with sufficient length.
 */
const realisticPatArb = fc
  .string({ minLength: 10, maxLength: 200 })
  .map((s) => `ghp_${s.replace(/\s/g, 'x')}`)
  .filter((s) => s.length >= 14);

// --- Property Tests ---

/**
 * Property 3: Raw token never leaked in API responses
 * **Validates: Requirements 5.3**
 *
 * For any stored PAT value, GET /syncSettings response SHALL NOT contain the raw token.
 * Only `hasToken` boolean appears in response.
 */
describe('Property 3: Raw token never leaked in API responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /syncSettings response never contains the raw token string for any stored PAT', async () => {
    await fc.assert(
      fc.asyncProperty(realisticPatArb, async (token) => {
        // Configure mocks: token is "stored" in Secrets Manager
        mockHasToken.mockResolvedValue(true);
        mockGetSettings.mockResolvedValue({
          terraformOverlayEnabled: true,
          dataSyncEnabled: true,
          updatedAt: '2024-06-01T00:00:00.000Z',
        });

        const event = makeEvent();
        const result = await getSyncSettingsRoute(event);

        // The response should be successful
        expect(result.statusCode).toBe(StatusCode.OK);

        // Parse the response body
        const body = JSON.parse(result.body);

        // The raw token string SHALL NOT appear anywhere in the response body
        expect(result.body).not.toContain(token);

        // The response SHALL contain hasToken as a boolean (true since token exists)
        expect(body.hasToken).toBe(true);
        expect(typeof body.hasToken).toBe('boolean');

        // The response SHALL NOT have a githubToken field
        expect(body.githubToken).toBeUndefined();

        // No value in the response object should equal the token
        for (const value of Object.values(body)) {
          expect(value).not.toBe(token);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('PUT /syncSettings response never contains the raw token string for any provided PAT', async () => {
    await fc.assert(
      fc.asyncProperty(realisticPatArb, async (token) => {
        // Configure mocks: putToken succeeds, hasToken returns true after store
        mockPutToken.mockResolvedValue(undefined);
        mockHasToken.mockResolvedValue(true);
        mockUpdateSettings.mockResolvedValue({
          terraformOverlayEnabled: true,
          dataSyncEnabled: true,
          updatedAt: '2024-06-01T12:00:00.000Z',
        });

        const event = makeEvent({
          httpMethod: 'PUT',
          body: JSON.stringify({
            terraformOverlayEnabled: true,
            githubToken: token,
          }),
        });

        const result = await putSyncSettingsRoute(event);

        // The response should be successful
        expect(result.statusCode).toBe(StatusCode.OK);

        // The raw token string SHALL NOT appear anywhere in the response body
        expect(result.body).not.toContain(token);

        // Parse the response body
        const body = JSON.parse(result.body);

        // The response SHALL contain hasToken as a boolean
        expect(body.hasToken).toBe(true);
        expect(typeof body.hasToken).toBe('boolean');

        // The response SHALL NOT have a githubToken field
        expect(body.githubToken).toBeUndefined();

        // No value in the response object should equal the token
        for (const value of Object.values(body)) {
          expect(value).not.toBe(token);
        }
      }),
      { numRuns: 100 },
    );
  });
});
