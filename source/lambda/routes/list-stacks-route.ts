import type { APIGatewayProxyResult } from 'aws-lambda';
import { CloudFormationServiceClient } from '../services/cloudformation-client';
import { corsHeaders } from '../types/api';
import { StatusCode } from '../constants/status-codes';
import { ErrorResponse } from '../constants/errors';
import { logger } from '../util/logger';

const cloudFormationClient = new CloudFormationServiceClient();

export const listStacksRoute = async (): Promise<APIGatewayProxyResult> => {
  try {
    const stacks = await cloudFormationClient.listActiveStacks();

    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ stacks }),
    };
  } catch (e) {
    logger.error('Failed to list stacks', { error: String(e) });
    return ErrorResponse.internalServerError(String(e));
  }
};
