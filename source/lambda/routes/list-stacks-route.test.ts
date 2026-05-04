import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyResult } from 'aws-lambda';
import { corsHeaders } from '../types/api';
import { StatusCode } from '../constants/status-codes';

const { mockListActiveStacks } = vi.hoisted(() => ({
  mockListActiveStacks: vi.fn(),
}));

vi.mock('../services/cloudformation-client', () => ({
  CloudFormationServiceClient: vi.fn().mockImplementation(() => ({
    listActiveStacks: mockListActiveStacks,
  })),
}));

describe('listStacksRoute', () => {
  let listStacksRoute: () => Promise<APIGatewayProxyResult>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('./list-stacks-route');
    listStacksRoute = mod.listStacksRoute;
  });

  it('returns 200 with stack names on success', async () => {
    const stackNames = ['stack-alpha', 'stack-beta', 'stack-gamma'];
    mockListActiveStacks.mockResolvedValueOnce(stackNames);

    const result = await listStacksRoute();

    expect(result.statusCode).toBe(StatusCode.OK);
    expect(JSON.parse(result.body)).toEqual({ stacks: stackNames });
    expect(result.headers).toEqual(corsHeaders);
  });

  it('returns 200 with empty stacks array when no stacks exist', async () => {
    mockListActiveStacks.mockResolvedValueOnce([]);

    const result = await listStacksRoute();

    expect(result.statusCode).toBe(StatusCode.OK);
    expect(JSON.parse(result.body)).toEqual({ stacks: [] });
    expect(result.headers).toEqual(corsHeaders);
  });

  it('returns 500 with error message when listActiveStacks fails', async () => {
    mockListActiveStacks.mockRejectedValueOnce(new Error('Failed to list active stacks: Access denied'));

    const result = await listStacksRoute();

    expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toContain('Failed to list active stacks');
    expect(result.headers).toEqual(corsHeaders);
  });

  it('returns 500 with error details for unexpected errors', async () => {
    mockListActiveStacks.mockRejectedValueOnce('unexpected string error');

    const result = await listStacksRoute();

    expect(result.statusCode).toBe(StatusCode.INTERNAL_SERVER_ERROR);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Internal Server Error');
    expect(result.headers).toEqual(corsHeaders);
  });
});
