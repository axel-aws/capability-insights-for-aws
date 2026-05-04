import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CloudFormationServiceClient } from '../services/cloudformation-client';
import { S3BucketClient } from '../services/s3-client';
import { corsHeaders } from '../types/api';
import { StatusCode } from '../constants/status-codes';
import { ErrorResponse } from '../constants/errors';
import { EnvironmentKey, getEnv } from '../constants/environment';
import { logger } from '../util/logger';
import {
  parseResourceType,
  deduplicateResourceTypePairs,
  buildPropertyMapping,
  extractPropertyValues,
} from '../util/cfn-resource-parser';
import type { CfnResource } from '@capability-insights/shared/types/capability/cfn';
import type { ResourceTypePair, PropertyMatch } from '@capability-insights/shared/types/capability/stack';

const cloudFormationClient = new CloudFormationServiceClient();

function isStackNotFoundError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = (error as Error & { name: string }).name;
    return name === 'ValidationError' && error.message.includes('does not exist');
  }
  return false;
}

export const stackResourcesRoute = async (
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const stackName = params.stackName;

  if (!stackName) {
    return ErrorResponse.badRequest('Stack name is required');
  }

  let resourceTypePairs: ResourceTypePair[];
  try {
    const resourceTypes = await cloudFormationClient.listStackResourceTypes(stackName);
    const parsed = resourceTypes
      .map((type) => parseResourceType(type))
      .filter((pair): pair is ResourceTypePair => pair !== null);
    resourceTypePairs = deduplicateResourceTypePairs(parsed);
  } catch (e) {
    if (isStackNotFoundError(e)) {
      return ErrorResponse.notFound(`Stack '${stackName}' not found`);
    }
    logger.error('Failed to list stack resources', { stackName, error: String(e) });
    return ErrorResponse.internalServerError(String(e));
  }

  let propertyMatches: PropertyMatch[] = [];
  const warnings: string[] = [];

  // Read cfn_resources.json from S3 to build property mapping
  let propertyMapping: ReturnType<typeof buildPropertyMapping> | null = null;
  try {
    const bucketName = getEnv(EnvironmentKey.WEBSITE_BUCKET_NAME);
    const s3Client = new S3BucketClient(bucketName);
    const cfnResourcesJson = await Promise.race([
      s3Client.getObject('data/json/cfn_resources.json'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('S3 read timed out after 5s')), 5000)),
    ]);
    const cfnResources: CfnResource[] = JSON.parse(cfnResourcesJson);
    propertyMapping = buildPropertyMapping(cfnResources);
  } catch (e) {
    logger.warn('Failed to read cfn_resources.json from S3', { error: String(e) });
    warnings.push(`Could not read capability data: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Get template and extract property values if we have a property mapping
  if (propertyMapping) {
    try {
      const templateBody = await cloudFormationClient.getTemplate(stackName);
      propertyMatches = extractPropertyValues(templateBody, propertyMapping);
    } catch (e) {
      logger.warn('Failed to get template', { stackName, error: String(e) });
      warnings.push(`Could not retrieve template: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const response: Record<string, unknown> = {
    resourceTypePairs,
    propertyMatches,
  };

  if (warnings.length > 0) {
    response.warning = warnings.join('; ');
  }

  return {
    statusCode: StatusCode.OK,
    headers: corsHeaders,
    body: JSON.stringify(response),
  };
};
