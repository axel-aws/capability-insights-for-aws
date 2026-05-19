import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { corsHeaders } from '../types/api';
import { StatusCode } from '../constants/status-codes';
import { ErrorResponse } from '../constants/errors';
import { EnvironmentKey, getEnv } from '../constants/environment';
import { logger } from '../util/logger';
import { PlanStore } from '../services/infrastructure-planning/plan-store';
import { PlanProcessor, GitHubFetchError } from '../services/infrastructure-planning/plan-processor';
import { GitHubTokenStore } from '../services/github-token-store';
import { S3BucketClient } from '../services/s3-client';
import type {
  CreatePlanRequest,
  UpdatePlanRequest,
  ListPlansQuery,
  PlanSourceType,
} from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import { parseBody, mapPlanProcessingError } from '../util/route-helpers';
import type { TerraformOverlayData } from '@capability-insights/shared/types/terraform-overlay';

function getStore(): PlanStore {
  const tableName = getEnv(EnvironmentKey.PLAN_TABLE_NAME);
  const bucketName = getEnv(EnvironmentKey.WEBSITE_BUCKET_NAME);
  return new PlanStore(tableName, bucketName);
}

async function getOverlayData(): Promise<TerraformOverlayData> {
  const bucketName = getEnv(EnvironmentKey.WEBSITE_BUCKET_NAME);
  const s3Client = new S3BucketClient(bucketName);
  const raw = await s3Client.getObject('data/json/terraform_overlay.json');
  return JSON.parse(raw) as TerraformOverlayData;
}

async function getGitHubPat(): Promise<string> {
  const secretName = getEnv(EnvironmentKey.GITHUB_TOKEN_SECRET_NAME);
  const tokenStore = new GitHubTokenStore(secretName);
  const token = await tokenStore.getToken();
  if (!token) {
    throw new Error('GitHub token not configured. Add a token in Settings.');
  }
  return token;
}

function getProcessor(): PlanProcessor {
  const gitHubFetchFunctionName = process.env[EnvironmentKey.GITHUB_FETCH_FUNCTION_NAME];
  return new PlanProcessor({
    getOverlayData,
    getGitHubPat,
    gitHubFetchFunctionName,
  });
}

/** Validates the required fields for a CreatePlanRequest. */
function validateCreatePlanRequest(body: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const request = body as Record<string, unknown>;

  if (!request.planName || typeof request.planName !== 'string' || request.planName.trim().length === 0) {
    errors.push('planName is required and must be a non-empty string');
  }

  const validSourceTypes: PlanSourceType[] = ['cloudformation', 'terraform', 'github'];
  if (!request.sourceType || !validSourceTypes.includes(request.sourceType as PlanSourceType)) {
    errors.push('sourceType is required and must be one of: cloudformation, terraform, github');
  }

  const sourceType = request.sourceType as PlanSourceType;

  if (sourceType === 'cloudformation' || sourceType === 'terraform') {
    if (!request.templateContent || typeof request.templateContent !== 'string') {
      errors.push('templateContent is required for cloudformation/terraform source types');
    }
  }

  if (sourceType === 'github') {
    if (!request.repositoryUrl || typeof request.repositoryUrl !== 'string') {
      errors.push('repositoryUrl is required for github source type');
    }
  }

  if (request.labels !== undefined) {
    if (!Array.isArray(request.labels)) {
      errors.push('labels must be an array');
    } else {
      for (const label of request.labels) {
        if (!label || typeof label.key !== 'string' || typeof label.value !== 'string') {
          errors.push('Each label must have a string key and value');
          break;
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Validates the fields for an UpdatePlanRequest. */
function validateUpdatePlanRequest(body: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const request = body as Record<string, unknown>;

  if (request.planName !== undefined) {
    if (typeof request.planName !== 'string' || request.planName.trim().length === 0) {
      errors.push('planName must be a non-empty string');
    }
  }

  if (request.labels !== undefined) {
    if (!Array.isArray(request.labels)) {
      errors.push('labels must be an array');
    } else {
      for (const label of request.labels) {
        if (!label || typeof label.key !== 'string' || typeof label.value !== 'string') {
          errors.push('Each label must have a string key and value');
          break;
        }
      }
    }
  }

  // At least one field must be provided
  if (request.planName === undefined && request.labels === undefined) {
    errors.push('At least one of planName or labels must be provided');
  }

  return { valid: errors.length === 0, errors };
}

// --- Route Handlers ---

/**
 * POST /plans — Create and process a new infrastructure plan.
 */
export const createPlanRoute = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const body = parseBody(event);
  if (!body) {
    return {
      statusCode: StatusCode.BAD_REQUEST,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ValidationError', message: 'Request body is required' }),
    };
  }

  const validation = validateCreatePlanRequest(body);
  if (!validation.valid) {
    return {
      statusCode: StatusCode.BAD_REQUEST,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ValidationError', message: validation.errors.join('; ') }),
    };
  }

  const request = body as CreatePlanRequest;

  try {
    // Process the template/repository to extract capability set
    const processor = getProcessor();
    const capabilitySet = await processor.process(request);

    // Store the plan with its capability set
    const store = getStore();
    const plan = await store.createPlan(request, capabilitySet);

    return {
      statusCode: StatusCode.CREATED,
      headers: corsHeaders,
      body: JSON.stringify({ plan }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Handle GitHubFetchError with proper status code mapping
    if (error instanceof GitHubFetchError) {
      return {
        statusCode: error.statusCode,
        headers: corsHeaders,
        body: JSON.stringify({ error: error.errorType, message: error.message }),
      };
    }

    const mapped = mapPlanProcessingError(message);
    if (mapped) return mapped;

    logger.error('Failed to create plan', { error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /plans — List all plans with optional filters.
 */
export const listPlansRoute = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const query: ListPlansQuery = {};
  const params = event.queryStringParameters;

  if (params?.search) query.search = params.search;
  if (params?.sourceType) query.sourceType = params.sourceType as PlanSourceType;
  if (params?.labelKey) query.labelKey = params.labelKey;
  if (params?.labelValue) query.labelValue = params.labelValue;

  try {
    const store = getStore();
    const plans = await store.listPlans(query);
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ plans }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to list plans', { error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /plans/names — Get plan names for autocomplete.
 */
export const listPlanNamesRoute = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const store = getStore();
    const result = await store.listPlanNames();
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify(result),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to list plan names', { error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /plans/:planId — Get a single plan configuration.
 */
export const getPlanRoute = async (
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { planId } = params;

  try {
    const store = getStore();
    const plan = await store.getPlan(planId);
    if (!plan) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Plan "${planId}" not found` }),
      };
    }
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ plan }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get plan', { planId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * PUT /plans/:planId — Update plan metadata (name and/or labels).
 */
export const updatePlanRoute = async (
  event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { planId } = params;
  const body = parseBody(event);
  if (!body) {
    return {
      statusCode: StatusCode.BAD_REQUEST,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ValidationError', message: 'Request body is required' }),
    };
  }

  const validation = validateUpdatePlanRequest(body);
  if (!validation.valid) {
    return {
      statusCode: StatusCode.BAD_REQUEST,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'ValidationError', message: validation.errors.join('; ') }),
    };
  }

  const updates = body as UpdatePlanRequest;

  try {
    const store = getStore();
    const plan = await store.updatePlan(planId, updates);
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ plan }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('not found')) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Plan "${planId}" not found` }),
      };
    }

    if (message.includes('already exists')) {
      return {
        statusCode: StatusCode.CONFLICT,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Conflict', message }),
      };
    }

    logger.error('Failed to update plan', { planId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * DELETE /plans/:planId — Delete a plan and its capability set.
 */
export const deletePlanRoute = async (
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { planId } = params;

  try {
    const store = getStore();
    await store.deletePlan(planId);
    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ message: `Plan "${planId}" deleted` }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('not found')) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Plan "${planId}" not found` }),
      };
    }

    if (message.includes('partially deleted')) {
      return {
        statusCode: StatusCode.INTERNAL_SERVER_ERROR,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'PartialDelete', message }),
      };
    }

    logger.error('Failed to delete plan', { planId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * POST /plans/:planId/reprocess — Re-process the plan source and update the capability set.
 *
 * For GitHub-sourced plans: uses stored repositoryUrl from plan metadata (falls back to request body).
 * For CloudFormation/Terraform plans: requires templateContent in request body.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7
 */
export const reprocessPlanRoute = async (
  event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { planId } = params;

  try {
    const store = getStore();
    const plan = await store.getPlan(planId);
    if (!plan) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Plan "${planId}" not found` }),
      };
    }

    // Parse optional request body for templateContent or repositoryUrl
    const body = parseBody(event) as Record<string, unknown> | null;
    const bodyTemplateContent = body?.templateContent as string | undefined;
    const bodyRepositoryUrl = body?.repositoryUrl as string | undefined;

    // Reconstruct a CreatePlanRequest based on the plan's source type
    let reconstructedRequest: CreatePlanRequest;

    switch (plan.sourceType) {
      case 'github': {
        // Use stored repositoryUrl from plan metadata, fall back to request body
        const repositoryUrl = plan.repositoryUrl || bodyRepositoryUrl;
        if (!repositoryUrl) {
          return {
            statusCode: StatusCode.BAD_REQUEST,
            headers: corsHeaders,
            body: JSON.stringify({
              error: 'ValidationError',
              message: 'Repository URL is required for refreshing a GitHub-sourced plan. No repositoryUrl found in plan metadata or request body.',
            }),
          };
        }
        reconstructedRequest = {
          planName: plan.planName,
          sourceType: 'github',
          repositoryUrl,
        };
        break;
      }
      case 'cloudformation':
      case 'terraform': {
        // Require templateContent in request body for CFN/Terraform refreshes
        if (!bodyTemplateContent) {
          return {
            statusCode: StatusCode.BAD_REQUEST,
            headers: corsHeaders,
            body: JSON.stringify({
              error: 'ValidationError',
              message: `templateContent is required in request body for refreshing a ${plan.sourceType} plan`,
            }),
          };
        }
        reconstructedRequest = {
          planName: plan.planName,
          sourceType: plan.sourceType,
          templateContent: bodyTemplateContent,
        };
        break;
      }
      default:
        return {
          statusCode: StatusCode.BAD_REQUEST,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'ProcessingError',
            message: `Unsupported source type: ${plan.sourceType}`,
          }),
        };
    }

    // Process the source to produce a new capability set
    const processor = getProcessor();
    const capabilitySet = await processor.process(reconstructedRequest);

    // Validate that refresh produces non-zero capabilities (treat zero results as failure)
    const totalCapabilities =
      capabilitySet.cfnResourceTypes.length +
      capabilitySet.terraformResourceTypes.length +
      capabilitySet.apiOperations.length;

    if (totalCapabilities === 0) {
      return {
        statusCode: StatusCode.BAD_REQUEST,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'ProcessingError',
          message: 'Refresh produced zero capabilities. The source may be empty or contain no recognizable AWS resources.',
        }),
      };
    }

    // Update the capability set, lastRefreshedAt, and resource counts
    const updatedPlan = await store.updateCapabilitySet(planId, capabilitySet);

    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify({ plan: updatedPlan }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    // Handle GitHubFetchError with proper status code mapping
    if (error instanceof GitHubFetchError) {
      return {
        statusCode: error.statusCode,
        headers: corsHeaders,
        body: JSON.stringify({ error: error.errorType, message: error.message }),
      };
    }

    const mapped = mapPlanProcessingError(message);
    if (mapped) return mapped;

    logger.error('Failed to reprocess plan', { planId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};

/**
 * GET /plans/:planId/capability-set — Get the full capability set for a plan.
 */
export const getCapabilitySetRoute = async (
  _event: APIGatewayProxyEvent,
  params: Record<string, string>,
): Promise<APIGatewayProxyResult> => {
  const { planId } = params;

  try {
    const store = getStore();
    const plan = await store.getPlan(planId);
    if (!plan) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Plan "${planId}" not found` }),
      };
    }

    const capabilitySet = await store.getCapabilitySet(planId);
    if (!capabilitySet) {
      return {
        statusCode: StatusCode.NOT_FOUND,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'NotFound', message: `Capability set not found for plan "${planId}"` }),
      };
    }

    return {
      statusCode: StatusCode.OK,
      headers: corsHeaders,
      body: JSON.stringify(capabilitySet),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get capability set', { planId, error: message });
    return ErrorResponse.internalServerError(message);
  }
};
