import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { StatusCode } from '../constants/status-codes';

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

import { getSyncSettingsRoute, putSyncSettingsRoute } from './sync-settings-routes';

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

describe('sync-settings-routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /syncSettings (getSyncSettingsRoute)', () => {
    it('returns 200 with hasToken=true when token exists in Secrets Manager', async () => {
      mockGetSettings.mockResolvedValueOnce({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });
      mockHasToken.mockResolvedValueOnce(true);

      const event = makeEvent();
      const result = await getSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.terraformOverlayEnabled).toBe(true);
      expect(body.hasToken).toBe(true);
      expect(body.dataSyncEnabled).toBe(true);
      expect(body.updatedAt).toBe('2024-06-01T00:00:00.000Z');
      // Token value must never be exposed
      expect(body.githubToken).toBeUndefined();
      expect(mockHasToken).toHaveBeenCalledTimes(1);
    });

    it('returns 200 with hasToken=false when no token in Secrets Manager', async () => {
      mockGetSettings.mockResolvedValueOnce({
        terraformOverlayEnabled: false,
        dataSyncEnabled: true,
        updatedAt: '',
      });
      mockHasToken.mockResolvedValueOnce(false);

      const event = makeEvent();
      const result = await getSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.terraformOverlayEnabled).toBe(false);
      expect(body.hasToken).toBe(false);
      expect(body.dataSyncEnabled).toBe(true);
      expect(body.updatedAt).toBe('');
    });

    it('returns 500 when DynamoDB store throws', async () => {
      mockGetSettings.mockRejectedValueOnce(new Error('DynamoDB unreachable'));

      const event = makeEvent();
      const result = await getSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Settings store unavailable');
    });

    it('returns 200 with hasToken=false when Secrets Manager fails on hasToken (graceful fallback)', async () => {
      mockGetSettings.mockResolvedValueOnce({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });
      mockHasToken.mockRejectedValueOnce(new Error('Secrets Manager unavailable'));

      const event = makeEvent();
      const result = await getSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.hasToken).toBe(false);
      expect(body.terraformOverlayEnabled).toBe(true);
      expect(body.dataSyncEnabled).toBe(true);
    });
  });

  describe('PUT /syncSettings (putSyncSettingsRoute)', () => {
    it('stores token in Secrets Manager when provided with overlay enabled', async () => {
      mockPutToken.mockResolvedValueOnce(undefined);
      mockHasToken.mockResolvedValueOnce(true);
      mockUpdateSettings.mockResolvedValueOnce({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T12:00:00.000Z',
      });

      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: true,
          githubToken: 'ghp_validtoken',
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      expect(mockPutToken).toHaveBeenCalledWith('ghp_validtoken');
      const body = JSON.parse(result.body);
      expect(body.terraformOverlayEnabled).toBe(true);
      expect(body.hasToken).toBe(true);
      expect(body.dataSyncEnabled).toBe(true);
      expect(body.updatedAt).toBe('2024-06-01T12:00:00.000Z');
      // Token value must never be exposed in response
      expect(body.githubToken).toBeUndefined();
      expect(result.body).not.toContain('ghp_validtoken');
    });

    it('returns 400 when enabling without token and no existing token in Secrets Manager', async () => {
      mockHasToken.mockResolvedValueOnce(false);

      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: true,
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('token is required');
      expect(mockHasToken).toHaveBeenCalledTimes(1);
      expect(mockUpdateSettings).not.toHaveBeenCalled();
    });

    it('allows enabling without token when existing token exists in Secrets Manager', async () => {
      mockHasToken.mockResolvedValue(true);
      mockUpdateSettings.mockResolvedValueOnce({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T12:00:00.000Z',
      });

      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: true,
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      expect(mockPutToken).not.toHaveBeenCalled();
      expect(mockHasToken).toHaveBeenCalled();
      const body = JSON.parse(result.body);
      expect(body.terraformOverlayEnabled).toBe(true);
      expect(body.hasToken).toBe(true);
    });

    it('deletes token from Secrets Manager when disabling overlay', async () => {
      mockDeleteToken.mockResolvedValueOnce(undefined);
      mockHasToken.mockResolvedValueOnce(false);
      mockUpdateSettings.mockResolvedValueOnce({
        terraformOverlayEnabled: false,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T12:00:00.000Z',
      });

      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: false,
          dataSyncEnabled: true,
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      expect(mockDeleteToken).toHaveBeenCalledTimes(1);
      const body = JSON.parse(result.body);
      expect(body.terraformOverlayEnabled).toBe(false);
      expect(body.hasToken).toBe(false);
    });

    it('returns 500 when Secrets Manager putToken fails', async () => {
      mockPutToken.mockRejectedValueOnce(new Error('Secrets Manager write failed'));

      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: true,
          githubToken: 'ghp_validtoken',
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Settings store unavailable');
    });

    it('returns 500 when Secrets Manager deleteToken fails', async () => {
      mockDeleteToken.mockRejectedValueOnce(new Error('Secrets Manager delete failed'));

      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: false,
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Settings store unavailable');
    });

    it('returns 400 when token has leading/trailing whitespace', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: true,
          githubToken: '  ghp_token_with_spaces  ',
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('whitespace');
    });

    it('returns 400 when body is invalid JSON', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        body: 'not valid json{{{',
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('Invalid JSON');
    });

    it('returns 400 when terraformOverlayEnabled is not a boolean', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: 'yes',
          githubToken: 'ghp_token',
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('terraformOverlayEnabled must be a boolean');
    });

    it('returns 400 when dataSyncEnabled is not a boolean', async () => {
      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: false,
          dataSyncEnabled: 'yes',
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.BAD_REQUEST);
      const body = JSON.parse(result.body);
      expect(body.error).toContain('dataSyncEnabled must be a boolean');
    });

    it('passes dataSyncEnabled to store when provided', async () => {
      mockDeleteToken.mockResolvedValueOnce(undefined);
      mockHasToken.mockResolvedValueOnce(false);
      mockUpdateSettings.mockResolvedValueOnce({
        terraformOverlayEnabled: false,
        dataSyncEnabled: false,
        updatedAt: '2024-06-01T12:00:00.000Z',
      });

      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: false,
          dataSyncEnabled: false,
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      const body = JSON.parse(result.body);
      expect(body.dataSyncEnabled).toBe(false);
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        terraformOverlayEnabled: false,
        dataSyncEnabled: false,
      });
    });

    it('returns 500 when DynamoDB store throws on update', async () => {
      mockPutToken.mockResolvedValueOnce(undefined);
      mockUpdateSettings.mockRejectedValueOnce(new Error('DynamoDB unreachable'));

      const event = makeEvent({
        httpMethod: 'PUT',
        body: JSON.stringify({
          terraformOverlayEnabled: true,
          githubToken: 'ghp_validtoken',
        }),
      });

      const result = await putSyncSettingsRoute(event);

      expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Settings store unavailable');
    });
  });
});
