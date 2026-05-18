import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import type { RouteHandler } from './types/api';
import { corsHeaders } from './types/api';
import { HttpMethod } from './constants/http-methods';
import { StatusCode } from './constants/status-codes';
import { ErrorResponse } from './constants/errors';
import { logger } from './util/logger';
import { syncCapabilityDataRoute } from './routes/sync-capability-data-route';
import { listStacksRoute } from './routes/list-stacks-route';
import { stackResourcesRoute } from './routes/stack-resources-route';
import { handleAnalyze } from './routes/analyze-route';
import { getUsedCapabilities } from './routes/usage-route';
import {
  createPolicyRoute,
  listPoliciesRoute,
  getPolicyRoute,
  updatePolicyRoute,
  refreshPolicyRoute,
  previewPolicyRoute,
  templatePolicyRoute,
} from './routes/policy-routes';
import {
  getPolicyPartsRoute,
  getPolicyPartDetailRoute,
  deletePolicyPartRoute,
  cascadingDeletePolicyRoute,
} from './routes/policy-parts-routes';
import { getSyncSettingsRoute, putSyncSettingsRoute } from './routes/sync-settings-routes';
import {
  getDataInfoRoute,
  postDataUploadRoute,
  postMergePreviewRoute,
  postMergeCommitRoute,
} from './routes/data-utilities-routes';
import {
  createPlanRoute,
  listPlansRoute,
  listPlanNamesRoute,
  getPlanRoute,
  updatePlanRoute,
  deletePlanRoute,
  reprocessPlanRoute,
  getCapabilitySetRoute,
} from './routes/plan-routes';

// --- Exact match routes ---
const routes: Map<string, RouteHandler> = new Map();

function registerRoute(method: string, path: string, handler: RouteHandler) {
  routes.set(`${method} ${path}`, handler);
}

// --- Parameterized routes ---
export interface ParameterizedRoute {
  pattern: RegExp;
  paramNames: string[];
  handler: (event: APIGatewayProxyEvent, params: Record<string, string>) => Promise<APIGatewayProxyResult>;
}

const parameterizedRoutes: Map<string, ParameterizedRoute[]> = new Map();

function registerParameterizedRoute(
  method: string,
  pathTemplate: string,
  handler: (event: APIGatewayProxyEvent, params: Record<string, string>) => Promise<APIGatewayProxyResult>,
) {
  const paramNames: string[] = [];
  const regexStr = pathTemplate.replace(/:([^/]+)/g, (_match, paramName) => {
    paramNames.push(paramName);
    return '([^/]+)';
  });
  const pattern = new RegExp(`^${regexStr}$`);

  const route: ParameterizedRoute = { pattern, paramNames, handler };

  const existing = parameterizedRoutes.get(method) ?? [];
  existing.push(route);
  parameterizedRoutes.set(method, existing);
}

// --- Register routes ---
registerRoute(HttpMethod.POST, '/syncCapabilityData', syncCapabilityDataRoute);
registerRoute(HttpMethod.GET, '/stacks', listStacksRoute);

// Usage analysis: start analysis (POST) and poll status (GET)
registerRoute(HttpMethod.POST, '/analysis', handleAnalyze);
registerRoute(HttpMethod.GET, '/analysis', handleAnalyze);
// Account-aware filtering: returns services/APIs based on usage data
registerRoute(HttpMethod.GET, '/capabilities', getUsedCapabilities);

registerParameterizedRoute(HttpMethod.GET, '/stacks/:stackName/resources', stackResourcesRoute);

// Policy Enforcer routes
registerRoute(HttpMethod.POST, '/policies', createPolicyRoute);
registerRoute(HttpMethod.GET, '/policies', listPoliciesRoute);

registerParameterizedRoute(HttpMethod.GET, '/policies/:policyId', getPolicyRoute);
registerParameterizedRoute(HttpMethod.PUT, '/policies/:policyId', updatePolicyRoute);
registerParameterizedRoute(HttpMethod.DELETE, '/policies/:policyId', cascadingDeletePolicyRoute);
registerParameterizedRoute(HttpMethod.POST, '/policies/:policyId/refresh', refreshPolicyRoute);
registerParameterizedRoute(HttpMethod.GET, '/policies/:policyId/preview', previewPolicyRoute);
registerParameterizedRoute(HttpMethod.GET, '/policies/:policyId/template', templatePolicyRoute);

// Policy Parts routes
registerParameterizedRoute(HttpMethod.GET, '/policies/:policyId/parts', getPolicyPartsRoute);
registerParameterizedRoute(HttpMethod.GET, '/policies/:policyId/parts/:partIndex', getPolicyPartDetailRoute);
registerParameterizedRoute(HttpMethod.DELETE, '/policies/:policyId/parts/:partIndex', deletePolicyPartRoute);

// Sync Settings routes
registerRoute(HttpMethod.GET, '/syncSettings', getSyncSettingsRoute);
registerRoute(HttpMethod.PUT, '/syncSettings', putSyncSettingsRoute);

// Data Utilities routes
registerRoute(HttpMethod.GET, '/data/info', getDataInfoRoute);
registerRoute(HttpMethod.POST, '/data/upload', postDataUploadRoute);
registerRoute(HttpMethod.POST, '/data/merge/preview', postMergePreviewRoute);
registerRoute(HttpMethod.POST, '/data/merge/commit', postMergeCommitRoute);

// Infrastructure Planning routes
registerRoute(HttpMethod.POST, '/plans', createPlanRoute);
registerRoute(HttpMethod.GET, '/plans', listPlansRoute);
registerRoute(HttpMethod.GET, '/plans/names', listPlanNamesRoute);

registerParameterizedRoute(HttpMethod.GET, '/plans/:planId', getPlanRoute);
registerParameterizedRoute(HttpMethod.PUT, '/plans/:planId', updatePlanRoute);
registerParameterizedRoute(HttpMethod.DELETE, '/plans/:planId', deletePlanRoute);
registerParameterizedRoute(HttpMethod.POST, '/plans/:planId/reprocess', reprocessPlanRoute);
registerParameterizedRoute(HttpMethod.GET, '/plans/:planId/capability-set', getCapabilitySetRoute);

// --- Main handler ---
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const key = `${event.httpMethod} ${event.path}`;
  logger.info('Received event', {
    route: key,
    requestId: event.requestContext?.requestId,
  });

  try {
    // Handle OPTIONS requests for CORS
    if (event.httpMethod === HttpMethod.OPTIONS) {
      return {
        statusCode: StatusCode.OK,
        headers: corsHeaders,
        body: '',
      };
    }

    // First, check exact match routes
    const routeHandler = routes.get(key);
    if (routeHandler) {
      return await routeHandler(event);
    }

    // Fall back to parameterized route matching
    const methodRoutes = parameterizedRoutes.get(event.httpMethod);
    if (methodRoutes) {
      for (const route of methodRoutes) {
        const match = event.path.match(route.pattern);
        if (match) {
          const params: Record<string, string> = {};
          route.paramNames.forEach((name, index) => {
            params[name] = decodeURIComponent(match[index + 1]);
          });
          return await route.handler(event, params);
        }
      }
    }

    return ErrorResponse.notFound(`${key} not found`);
  } catch (e) {
    logger.error('Unhandled exception', { route: key, error: String(e) });
    return ErrorResponse.internalServerError(String(e));
  }
};
