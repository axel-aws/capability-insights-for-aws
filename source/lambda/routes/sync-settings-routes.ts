import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { SyncSettingsStore } from '../services/sync-settings-store';
import { GitHubTokenStore } from '../services/github-token-store';
import { EnvironmentKey, getEnv } from '../constants/environment';
import { StatusCode } from '../constants/status-codes';
import { corsHeaders } from '../types/api';
import { logger } from '../util/logger';

function buildResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify(body),
  };
}

/**
 * GET /syncSettings
 * Returns the current sync settings (toggle state + hasToken boolean, never the raw token).
 */
export async function getSyncSettingsRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const tableName = getEnv(EnvironmentKey.POLICY_TABLE_NAME);
    const store = new SyncSettingsStore(tableName);
    const settings = await store.getSettings();

    // Attempt to check Secrets Manager for token presence.
    // If the secret name env var is missing or Secrets Manager is unreachable,
    // gracefully default to hasToken: false so the settings page still loads.
    let hasToken = false;
    try {
      const secretName = getEnv(EnvironmentKey.GITHUB_TOKEN_SECRET_NAME);
      const tokenStore = new GitHubTokenStore(secretName);
      hasToken = await tokenStore.hasToken();
    } catch (tokenError: unknown) {
      logger.warn('Could not check token presence in Secrets Manager, defaulting to hasToken=false', {
        error: String(tokenError),
      });
    }

    return buildResponse(StatusCode.OK, {
      terraformOverlayEnabled: settings.terraformOverlayEnabled,
      hasToken,
      dataSyncEnabled: settings.dataSyncEnabled,
      updatedAt: settings.updatedAt,
    });
  } catch (error: unknown) {
    logger.error('Failed to get sync settings', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Settings store unavailable' });
  }
}

/**
 * PUT /syncSettings
 * Validates request body, persists settings, and returns updated state.
 * Body: { terraformOverlayEnabled: boolean, githubToken?: string, dataSyncEnabled?: boolean }
 */
export async function putSyncSettingsRoute(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  let body: { terraformOverlayEnabled?: boolean; githubToken?: string; dataSyncEnabled?: boolean };

  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'Invalid JSON in request body' });
  }

  if (typeof body.terraformOverlayEnabled !== 'boolean') {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'terraformOverlayEnabled must be a boolean' });
  }

  // Validate dataSyncEnabled if provided
  if (body.dataSyncEnabled !== undefined && typeof body.dataSyncEnabled !== 'boolean') {
    return buildResponse(StatusCode.BAD_REQUEST, { error: 'dataSyncEnabled must be a boolean' });
  }

  // Validate token when enabling
  if (body.terraformOverlayEnabled && body.githubToken !== undefined) {
    if (body.githubToken !== body.githubToken.trim()) {
      return buildResponse(StatusCode.BAD_REQUEST, { error: 'GitHub token must not have leading or trailing whitespace' });
    }
  }

  try {
    const tableName = getEnv(EnvironmentKey.POLICY_TABLE_NAME);
    const secretName = getEnv(EnvironmentKey.GITHUB_TOKEN_SECRET_NAME);

    const store = new SyncSettingsStore(tableName);
    const tokenStore = new GitHubTokenStore(secretName);

    // If enabling with a token provided, store it in Secrets Manager
    if (body.terraformOverlayEnabled && body.githubToken) {
      await tokenStore.putToken(body.githubToken);
    }

    // If enabling without a token, verify one exists in Secrets Manager
    if (body.terraformOverlayEnabled && !body.githubToken) {
      const exists = await tokenStore.hasToken();
      if (!exists) {
        return buildResponse(StatusCode.BAD_REQUEST, {
          error: 'GitHub token is required when enabling Terraform overlay',
        });
      }
    }

    // If disabling, clear the token from Secrets Manager
    if (!body.terraformOverlayEnabled) {
      await tokenStore.deleteToken();
    }

    // Update DynamoDB (without token)
    const updated = await store.updateSettings({
      terraformOverlayEnabled: body.terraformOverlayEnabled,
      dataSyncEnabled: body.dataSyncEnabled,
    });

    const hasToken = await tokenStore.hasToken();
    return buildResponse(StatusCode.OK, {
      terraformOverlayEnabled: updated.terraformOverlayEnabled,
      hasToken,
      dataSyncEnabled: updated.dataSyncEnabled,
      updatedAt: updated.updatedAt,
    });
  } catch (error: unknown) {
    logger.error('Failed to update sync settings', { error: String(error) });
    return buildResponse(StatusCode.INTERNAL_SERVER_ERROR, { error: 'Settings store unavailable' });
  }
}
