import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { corsHeaders } from '../types/api';

/**
 * Safely parse the JSON body of an API Gateway event.
 * Returns null if the body is missing or not valid JSON.
 */
export function parseBody(event: APIGatewayProxyEvent): unknown {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return null;
  }
}

/**
 * Build a standard JSON response with CORS headers.
 */
export function buildResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

import { StatusCode } from '../constants/status-codes';

/**
 * Maps plan processing error messages to appropriate HTTP responses.
 * Used by createPlanRoute and reprocessPlanRoute to avoid duplicating
 * the same error classification logic.
 */
export function mapPlanProcessingError(message: string): APIGatewayProxyResult | null {
  if (message.includes('already exists')) {
    return buildResponse(StatusCode.CONFLICT, { error: 'Conflict', message });
  }

  if (
    message.includes('Failed to parse') ||
    message.includes('No AWS resources found') ||
    message.includes('Template exceeds maximum size') ||
    message.includes('Template content is required') ||
    message.includes('content is empty') ||
    message.includes('Repository URL is required') ||
    message.includes('Invalid GitHub repository URL') ||
    message.includes('GitHub token not configured') ||
    message.includes('GitHubFetchLambda function name not configured')
  ) {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'ProcessingError', message });
  }

  if (message.includes('GitHub token is invalid or expired')) {
    return buildResponse(StatusCode.UNAUTHORIZED, { error: 'Unauthorized', message });
  }

  if (message.includes('Cannot access repository')) {
    return buildResponse(StatusCode.NOT_FOUND, { error: 'NotFound', message });
  }

  if (message.includes('Failed to invoke GitHubFetchLambda')) {
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'LambdaInvocationError', message });
  }

  return null;
}
