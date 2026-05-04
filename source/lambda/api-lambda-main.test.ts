import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { corsHeaders } from './types/api';
import { StatusCode } from './constants/status-codes';

// --- Mock route handlers ---
const { mockListStacksRoute, mockStackResourcesRoute, mockSyncCapabilityDataRoute } = vi.hoisted(() => ({
  mockListStacksRoute: vi.fn(),
  mockStackResourcesRoute: vi.fn(),
  mockSyncCapabilityDataRoute: vi.fn(),
}));

vi.mock('./routes/list-stacks-route', () => ({
  listStacksRoute: mockListStacksRoute,
}));

vi.mock('./routes/stack-resources-route', () => ({
  stackResourcesRoute: mockStackResourcesRoute,
}));

vi.mock('./routes/sync-capability-data-route', () => ({
  syncCapabilityDataRoute: mockSyncCapabilityDataRoute,
}));

vi.mock('./util/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('./constants/environment', () => ({
  EnvironmentKey: { DATA_FETCH_LAMBDA_NAME: 'DATA_FETCH_LAMBDA_NAME' },
  getEnv: vi.fn().mockReturnValue('mock-value'),
}));

function createMockEvent(httpMethod: string, path: string): APIGatewayProxyEvent {
  return {
    httpMethod,
    path,
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
      requestId: 'test-request-id',
      accountId: '',
      apiId: '',
      authorizer: null,
      protocol: '',
      httpMethod,
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '',
        user: null,
        userAgent: null,
        userArn: null,
      },
      path,
      stage: '',
      requestTimeEpoch: 0,
      resourceId: '',
      resourcePath: '',
    },
  };
}

describe('api-lambda-main handler', () => {
  let handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./api-lambda-main');
    handler = mod.handler;
  });

  describe('exact route matching', () => {
    it('GET /stacks calls listStacksRoute', async () => {
      const mockResponse: APIGatewayProxyResult = {
        statusCode: StatusCode.OK,
        headers: corsHeaders,
        body: JSON.stringify({ stacks: ['my-stack'] }),
      };
      mockListStacksRoute.mockResolvedValueOnce(mockResponse);

      const event = createMockEvent('GET', '/stacks');
      const result = await handler(event);

      expect(mockListStacksRoute).toHaveBeenCalledOnce();
      expect(mockListStacksRoute).toHaveBeenCalledWith(event);
      expect(result.statusCode).toBe(StatusCode.OK);
      expect(JSON.parse(result.body)).toEqual({ stacks: ['my-stack'] });
    });

    it('POST /syncCapabilityData calls syncCapabilityDataRoute', async () => {
      const mockResponse: APIGatewayProxyResult = {
        statusCode: StatusCode.OK,
        headers: corsHeaders,
        body: JSON.stringify({ message: 'Data sync triggered' }),
      };
      mockSyncCapabilityDataRoute.mockResolvedValueOnce(mockResponse);

      const event = createMockEvent('POST', '/syncCapabilityData');
      const result = await handler(event);

      expect(mockSyncCapabilityDataRoute).toHaveBeenCalledOnce();
      expect(mockSyncCapabilityDataRoute).toHaveBeenCalledWith(event);
      expect(result.statusCode).toBe(StatusCode.OK);
      expect(JSON.parse(result.body)).toEqual({ message: 'Data sync triggered' });
    });
  });

  describe('parameterized route matching', () => {
    it('GET /stacks/my-stack/resources calls stackResourcesRoute with params', async () => {
      const mockResponse: APIGatewayProxyResult = {
        statusCode: StatusCode.OK,
        headers: corsHeaders,
        body: JSON.stringify({ resourceTypePairs: [], propertyMatches: [] }),
      };
      mockStackResourcesRoute.mockResolvedValueOnce(mockResponse);

      const event = createMockEvent('GET', '/stacks/my-stack/resources');
      const result = await handler(event);

      expect(mockStackResourcesRoute).toHaveBeenCalledOnce();
      expect(mockStackResourcesRoute).toHaveBeenCalledWith(event, { stackName: 'my-stack' });
      expect(result.statusCode).toBe(StatusCode.OK);
    });

    it('extracts URL-encoded stack names correctly', async () => {
      const mockResponse: APIGatewayProxyResult = {
        statusCode: StatusCode.OK,
        headers: corsHeaders,
        body: JSON.stringify({ resourceTypePairs: [], propertyMatches: [] }),
      };
      mockStackResourcesRoute.mockResolvedValueOnce(mockResponse);

      const event = createMockEvent('GET', '/stacks/my%20stack/resources');
      const result = await handler(event);

      expect(mockStackResourcesRoute).toHaveBeenCalledOnce();
      expect(mockStackResourcesRoute).toHaveBeenCalledWith(event, { stackName: 'my stack' });
      expect(result.statusCode).toBe(StatusCode.OK);
    });
  });

  describe('404 for unknown routes', () => {
    it('GET /unknown returns 404', async () => {
      const event = createMockEvent('GET', '/unknown');
      const result = await handler(event);

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Not Found');
      expect(body.message).toContain('not found');
    });

    it('GET /stacks/my-stack returns 404 (incomplete parameterized path)', async () => {
      const event = createMockEvent('GET', '/stacks/my-stack');
      const result = await handler(event);

      expect(result.statusCode).toBe(StatusCode.NOT_FOUND);
    });
  });

  describe('OPTIONS requests return CORS headers', () => {
    it('OPTIONS /stacks returns 200 with CORS headers', async () => {
      const event = createMockEvent('OPTIONS', '/stacks');
      const result = await handler(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      expect(result.headers).toEqual(corsHeaders);
      expect(result.body).toBe('');
      // Route handlers should NOT be called for OPTIONS
      expect(mockListStacksRoute).not.toHaveBeenCalled();
    });

    it('OPTIONS /stacks/my-stack/resources returns 200 with CORS headers', async () => {
      const event = createMockEvent('OPTIONS', '/stacks/my-stack/resources');
      const result = await handler(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      expect(result.headers).toEqual(corsHeaders);
      expect(result.body).toBe('');
      expect(mockStackResourcesRoute).not.toHaveBeenCalled();
    });

    it('OPTIONS /unknown returns 200 with CORS headers', async () => {
      const event = createMockEvent('OPTIONS', '/unknown');
      const result = await handler(event);

      expect(result.statusCode).toBe(StatusCode.OK);
      expect(result.headers).toEqual(corsHeaders);
      expect(result.body).toBe('');
    });
  });
});
