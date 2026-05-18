import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';

/**
 * Unit tests for data-fetch Lambda overlay integration.
 * Validates: Requirements 7.1, 7.2, 7.3
 */

// Mock the Lambda client
const lambdaMock = mockClient(LambdaClient);

// Mock the S3BucketClient
const mockGetObject = vi.fn();
const mockPutObject = vi.fn();

vi.mock('./services/s3-client', () => ({
  S3BucketClient: vi.fn().mockImplementation(() => ({
    getObject: mockGetObject,
    putObject: mockPutObject,
  })),
}));

// Mock the SyncSettingsStore
const mockGetSettings = vi.fn();

vi.mock('./services/sync-settings-store', () => ({
  SyncSettingsStore: vi.fn().mockImplementation(() => ({
    getSettings: mockGetSettings,
  })),
}));

// Mock the GitHubTokenStore
const mockGetToken = vi.fn();

vi.mock('./services/github-token-store', () => ({
  GitHubTokenStore: vi.fn().mockImplementation(() => ({
    getToken: mockGetToken,
  })),
}));

// Mock the logger
vi.mock('./util/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Set environment variables before importing the handler
vi.stubEnv('SOURCE_ACCESS_POINT_ARN', 'arn:aws:s3:us-east-1:123456789012:accesspoint/test-ap');
vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');
vi.stubEnv('SOURCE_FOLDERS', 'folder1');
vi.stubEnv('POLICY_TABLE_NAME', 'test-policy-table');
vi.stubEnv('GITHUB_TOKEN_SECRET_NAME', 'test-github-pat-secret');

// Import handler after env vars and mocks are set
const { handler } = await import('./data-fetch-lambda-main');

describe('Data Fetch Lambda - Terraform Overlay Integration', () => {
  beforeEach(() => {
    lambdaMock.reset();
    mockGetObject.mockReset();
    mockPutObject.mockReset();
    mockGetSettings.mockReset();
    mockGetToken.mockReset();

    // Default: source folder has a valid manifest
    mockGetObject.mockImplementation((path: string) => {
      if (path.endsWith('manifest.json')) {
        return Promise.resolve('{}');
      }
      // Return valid JSON for data files
      return Promise.resolve('[]');
    });

    // putObject always succeeds by default
    mockPutObject.mockResolvedValue(undefined);

    // Default: sync settings enabled (for overlay tests)
    mockGetSettings.mockResolvedValue({
      terraformOverlayEnabled: true,
      dataSyncEnabled: true,
      updatedAt: '2024-01-01T00:00:00.000Z',
    });

    // Default: token available in Secrets Manager
    mockGetToken.mockResolvedValue('ghp_test-token-123');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Re-stub the required env vars for subsequent tests
    vi.stubEnv('SOURCE_ACCESS_POINT_ARN', 'arn:aws:s3:us-east-1:123456789012:accesspoint/test-ap');
    vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');
    vi.stubEnv('SOURCE_FOLDERS', 'folder1');
    vi.stubEnv('POLICY_TABLE_NAME', 'test-policy-table');
    vi.stubEnv('GITHUB_TOKEN_SECRET_NAME', 'test-github-pat-secret');
  });

  describe('overlay success path', () => {
    it('includes terraform overlay metadata in sync metadata when overlay Lambda succeeds', async () => {
      // Set the overlay function name env var
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      const overlayResponse = {
        statusCode: 200,
        awsccCount: 150,
        classicAwsCount: 300,
        classicApiMappingCount: 0,
      };

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
      });

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify Lambda was invoked with correct parameters
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(1);
      expect(invokeCalls[0].args[0].input.FunctionName).toBe('test-overlay-function');
      expect(invokeCalls[0].args[0].input.InvocationType).toBe('RequestResponse');

      const invokePayload = JSON.parse(invokeCalls[0].args[0].input.Payload as string);
      expect(invokePayload.dataBucketName).toBe('test-data-bucket');
      expect(invokePayload.githubToken).toBe('ghp_test-token-123');

      // Verify sync metadata includes terraform overlay info
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlay).toBeDefined();
      expect(metadata.terraformOverlay.awsccResourceCount).toBe(150);
      expect(metadata.terraformOverlay.classicAwsResourceCount).toBe(300);
      expect(metadata.terraformOverlay.generatedAt).toBeDefined();
    });

    it('includes terraformClassicApiMapping in sync metadata when classicApiMappingCount > 0', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      const overlayResponse = {
        statusCode: 200,
        awsccCount: 150,
        classicAwsCount: 72,
        classicApiMappingCount: 1200,
      };

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
      });

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify sync metadata includes both overlay and classic API mapping info
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlay).toBeDefined();
      expect(metadata.terraformOverlay.awsccResourceCount).toBe(150);
      expect(metadata.terraformOverlay.classicAwsResourceCount).toBe(72);

      expect(metadata.terraformClassicApiMapping).toBeDefined();
      expect(metadata.terraformClassicApiMapping.resourceCount).toBe(1200);
      expect(metadata.terraformClassicApiMapping.serviceCount).toBe(72);
      expect(metadata.terraformClassicApiMapping.generatedAt).toBeDefined();
    });

    it('does not include terraformClassicApiMapping when classicApiMappingCount is 0', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      const overlayResponse = {
        statusCode: 200,
        awsccCount: 150,
        classicAwsCount: 300,
        classicApiMappingCount: 0,
      };

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
      });

      const result = await handler();

      expect(result.statusCode).toBe(200);

      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlay).toBeDefined();
      expect(metadata.terraformClassicApiMapping).toBeUndefined();
    });

    it('includes non-fatal overlay errors in sync metadata when overlay succeeds with warnings', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      const overlayResponse = {
        statusCode: 200,
        awsccCount: 150,
        classicAwsCount: 72,
        classicApiMappingCount: 1100,
        errors: ['Classic API mapping failed: Some resource files could not be fetched'],
      };

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
      });

      const result = await handler();

      // Primary sync still succeeds
      expect(result.statusCode).toBe(200);

      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      // Overlay metadata is still present (overlay succeeded)
      expect(metadata.terraformOverlay).toBeDefined();
      // Classic API mapping metadata is still present (count > 0)
      expect(metadata.terraformClassicApiMapping).toBeDefined();
      expect(metadata.terraformClassicApiMapping.resourceCount).toBe(1100);
      // Non-fatal errors are recorded
      expect(metadata.errors).toBeDefined();
      expect(metadata.errors.some((e: string) => e.includes('Terraform overlay warning:'))).toBe(true);
      expect(metadata.errors.some((e: string) => e.includes('Some resource files could not be fetched'))).toBe(true);
    });
  });

  describe('overlay failure path', () => {
    it('records error in sync metadata when overlay Lambda invocation throws', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      lambdaMock.on(InvokeCommand).rejects(new Error('Lambda invocation timeout'));

      const result = await handler();

      // Primary sync still succeeds
      expect(result.statusCode).toBe(200);

      // Verify sync metadata includes the overlay error
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.errors).toBeDefined();
      expect(metadata.errors.length).toBeGreaterThan(0);
      expect(metadata.errors.some((e: string) => e.includes('Terraform overlay invocation failed'))).toBe(true);
      // Overlay metadata should NOT be present on failure
      expect(metadata.terraformOverlay).toBeUndefined();
      // Classic API mapping metadata should NOT be present on failure
      expect(metadata.terraformClassicApiMapping).toBeUndefined();
    });

    it('records error when overlay Lambda returns a FunctionError', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        FunctionError: 'Unhandled',
        Payload: new TextEncoder().encode(JSON.stringify({ errorMessage: 'Runtime error' })),
      });

      const result = await handler();

      // Primary sync still succeeds
      expect(result.statusCode).toBe(200);

      // Verify sync metadata includes the overlay error
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.errors).toBeDefined();
      expect(metadata.errors.some((e: string) => e.includes('Terraform overlay Lambda returned error'))).toBe(true);
      expect(metadata.terraformOverlay).toBeUndefined();
    });

    it('records error when overlay Lambda returns non-200 statusCode', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      const overlayResponse = {
        statusCode: 500,
        awsccCount: 0,
        classicAwsCount: 0,
        errors: ['AWSCC fetch failed: Network error', 'Classic AWS fetch failed: Rate limited'],
      };

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
      });

      const result = await handler();

      // Primary sync still succeeds
      expect(result.statusCode).toBe(200);

      // Verify sync metadata includes the overlay error
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.errors).toBeDefined();
      expect(metadata.errors.some((e: string) => e.includes('Terraform overlay Lambda failed with status 500'))).toBe(true);
      expect(metadata.terraformOverlay).toBeUndefined();
    });
  });

  describe('overlay not configured', () => {
    it('skips overlay invocation when TERRAFORM_OVERLAY_FUNCTION_NAME is not set', async () => {
      // Do NOT set TERRAFORM_OVERLAY_FUNCTION_NAME
      delete process.env['TERRAFORM_OVERLAY_FUNCTION_NAME'];

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify Lambda was NOT invoked
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(0);

      // Verify sync metadata does NOT include terraform overlay
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlay).toBeUndefined();
    });
  });

  describe('overlay settings integration', () => {
    /**
     * Validates: Requirements 4.1, 4.2
     * When terraformOverlayEnabled is true and githubToken is present,
     * the overlay Lambda is invoked with the token in the payload.
     */
    it('invokes overlay Lambda when enabled with token', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });

      mockGetToken.mockResolvedValue('ghp_settings-token-456');

      const overlayResponse = {
        statusCode: 200,
        awsccCount: 100,
        classicAwsCount: 50,
        classicApiMappingCount: 0,
      };

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
      });

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify Lambda WAS invoked
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(1);

      // Verify the token from Secrets Manager was passed in the payload
      const invokePayload = JSON.parse(invokeCalls[0].args[0].input.Payload as string);
      expect(invokePayload.githubToken).toBe('ghp_settings-token-456');
      expect(invokePayload.dataBucketName).toBe('test-data-bucket');
    });

    /**
     * Validates: Requirements 4.3
     * When terraformOverlayEnabled is false, the overlay Lambda is NOT invoked.
     */
    it('skips overlay when terraformOverlayEnabled is false', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: false,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify Lambda was NOT invoked
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(0);
    });

    /**
     * Validates: Requirements 4.3
     * When no settings record exists (getSettings returns defaults with
     * terraformOverlayEnabled: false), the overlay Lambda is NOT invoked.
     */
    it('skips overlay when no settings record exists (defaults)', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      // Simulate no record: returns safe defaults
      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: false,
        dataSyncEnabled: true,
        updatedAt: '',
      });

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify Lambda was NOT invoked
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(0);
    });

    /**
     * Validates: Requirements 4.4
     * When DynamoDB read fails (getSettings throws), the overlay Lambda
     * is NOT invoked (fail-safe to disabled) and the error is logged.
     */
    it('skips overlay on DynamoDB read failure (fail-safe)', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockRejectedValue(new Error('DynamoDB connection timeout'));

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify Lambda was NOT invoked
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(0);

      // Verify sync metadata does NOT include overlay metadata
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlay).toBeUndefined();
    });

    /**
     * Validates: Requirements 7.1
     * When overlay is skipped due to toggle being disabled, sync metadata
     * includes terraformOverlaySkipped: true.
     */
    it('sync metadata includes terraformOverlaySkipped when disabled', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: false,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify sync metadata includes terraformOverlaySkipped: true
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlaySkipped).toBe(true);
      expect(metadata.terraformOverlay).toBeUndefined();
    });

    /**
     * Validates: Requirements 7.1
     * When overlay is skipped due to DynamoDB failure, sync metadata
     * includes terraformOverlaySkipped: true.
     */
    it('sync metadata includes terraformOverlaySkipped on DynamoDB failure', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockRejectedValue(new Error('DynamoDB unavailable'));

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify sync metadata includes terraformOverlaySkipped: true
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlaySkipped).toBe(true);
    });
  });

  describe('Secrets Manager token retrieval', () => {
    /**
     * Validates: Requirement 7.1
     * When overlay is enabled, the data-fetch Lambda retrieves the GitHub PAT
     * from Secrets Manager using GitHubTokenStore.
     */
    it('retrieves token from Secrets Manager when overlay is enabled', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });

      mockGetToken.mockResolvedValue('ghp_secret-manager-token');

      const overlayResponse = {
        statusCode: 200,
        awsccCount: 50,
        classicAwsCount: 25,
        classicApiMappingCount: 0,
      };

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
      });

      await handler();

      // Verify GitHubTokenStore.getToken() was called
      expect(mockGetToken).toHaveBeenCalledTimes(1);
    });

    /**
     * Validates: Requirement 7.2
     * The retrieved token is passed to the Terraform Overlay Lambda
     * via the invocation payload githubToken field.
     */
    it('passes token correctly in overlay Lambda invocation payload', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });

      const expectedToken = 'ghp_my-secret-pat-from-secrets-manager';
      mockGetToken.mockResolvedValue(expectedToken);

      const overlayResponse = {
        statusCode: 200,
        awsccCount: 100,
        classicAwsCount: 50,
        classicApiMappingCount: 0,
      };

      lambdaMock.on(InvokeCommand).resolves({
        StatusCode: 200,
        Payload: new TextEncoder().encode(JSON.stringify(overlayResponse)),
      });

      await handler();

      // Verify the exact token from Secrets Manager is in the invocation payload
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(1);

      const invokePayload = JSON.parse(invokeCalls[0].args[0].input.Payload as string);
      expect(invokePayload.githubToken).toBe(expectedToken);
    });

    /**
     * Validates: Requirement 7.3
     * When Secrets Manager read fails (getToken throws), the overlay invocation
     * is skipped and the error is logged. The primary sync continues.
     */
    it('skips overlay and logs error when Secrets Manager read fails', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });

      mockGetToken.mockRejectedValue(new Error('Secrets Manager connection timeout'));

      const result = await handler();

      // Primary sync still succeeds
      expect(result.statusCode).toBe(200);

      // Verify Lambda was NOT invoked (overlay skipped)
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(0);

      // Verify sync metadata includes terraformOverlaySkipped: true
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlaySkipped).toBe(true);
      expect(metadata.terraformOverlay).toBeUndefined();
    });

    /**
     * Validates: Requirement 7.1, 7.3
     * When getToken returns undefined (no token stored), the overlay invocation
     * is skipped. The primary sync continues.
     */
    it('skips overlay when no token exists in Secrets Manager (getToken returns undefined)', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });

      mockGetToken.mockResolvedValue(undefined);

      const result = await handler();

      // Primary sync still succeeds
      expect(result.statusCode).toBe(200);

      // Verify Lambda was NOT invoked (overlay skipped due to missing token)
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(0);

      // Verify sync metadata includes terraformOverlaySkipped: true
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlaySkipped).toBe(true);
      expect(metadata.terraformOverlay).toBeUndefined();
    });

    /**
     * Validates: Requirement 7.2
     * Verifies that the token is NOT included in the payload when overlay is not invoked.
     */
    it('does not invoke overlay Lambda when token retrieval returns empty string', async () => {
      vi.stubEnv('TERRAFORM_OVERLAY_FUNCTION_NAME', 'test-overlay-function');

      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });

      // Empty string is falsy, so overlay should be skipped
      mockGetToken.mockResolvedValue('');

      const result = await handler();

      expect(result.statusCode).toBe(200);

      // Verify Lambda was NOT invoked
      const invokeCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(invokeCalls).toHaveLength(0);

      // Verify sync metadata includes terraformOverlaySkipped
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.terraformOverlaySkipped).toBe(true);
    });
  });
});

/**
 * Unit tests for conditional data sync behavior based on dataSyncEnabled toggle.
 * Validates: Requirements 2.1, 3.1
 */
describe('Data Fetch Lambda - Conditional Data Sync', () => {
  beforeEach(() => {
    lambdaMock.reset();
    mockGetObject.mockReset();
    mockPutObject.mockReset();
    mockGetSettings.mockReset();
    mockGetToken.mockReset();

    // Default: source folder has a valid manifest
    mockGetObject.mockImplementation((path: string) => {
      if (path.endsWith('manifest.json')) {
        return Promise.resolve('{}');
      }
      return Promise.resolve('[]');
    });

    mockPutObject.mockResolvedValue(undefined);

    // Default: no token in Secrets Manager for conditional sync tests
    mockGetToken.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('SOURCE_ACCESS_POINT_ARN', 'arn:aws:s3:us-east-1:123456789012:accesspoint/test-ap');
    vi.stubEnv('DATA_BUCKET_NAME', 'test-data-bucket');
    vi.stubEnv('SOURCE_FOLDERS', 'folder1');
    vi.stubEnv('POLICY_TABLE_NAME', 'test-policy-table');
    vi.stubEnv('GITHUB_TOKEN_SECRET_NAME', 'test-github-pat-secret');
  });

  describe('scheduled invocation with dataSyncEnabled=false', () => {
    it('skips S3 access point fetch and returns early with dataSyncSkipped metadata', async () => {
      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: true,
        dataSyncEnabled: false,
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Invoke without event (scheduled invocation)
      const result = await handler();

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Data sync skipped (disabled)');

      // Verify S3 getObject was NOT called (no fetch from access point)
      expect(mockGetObject).not.toHaveBeenCalled();

      // Verify sync metadata was written with dataSyncSkipped: true
      const putCalls = mockPutObject.mock.calls;
      const metadataCall = putCalls.find((call: string[]) => call[0] === 'data/sync-metadata.json');
      expect(metadataCall).toBeDefined();

      const metadata = JSON.parse(metadataCall![1]);
      expect(metadata.dataSyncSkipped).toBe(true);
      expect(metadata.lastSyncTime).toBeDefined();
    });

    it('skips S3 access point fetch when event has no source field', async () => {
      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: false,
        dataSyncEnabled: false,
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Invoke with empty event (scheduled invocation)
      const result = await handler({});

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('Data sync skipped (disabled)');
      expect(mockGetObject).not.toHaveBeenCalled();
    });
  });

  describe('manual invocation with dataSyncEnabled=false', () => {
    it('proceeds with full sync when source is manual regardless of toggle state', async () => {
      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: false,
        dataSyncEnabled: false,
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Invoke with manual source
      const result = await handler({ source: 'manual' });

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('ok');

      // Verify S3 getObject WAS called (fetch from access point proceeded)
      expect(mockGetObject).toHaveBeenCalled();
    });
  });

  describe('scheduled invocation with dataSyncEnabled=true', () => {
    it('proceeds with full sync when dataSyncEnabled is true', async () => {
      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: false,
        dataSyncEnabled: true,
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      // Invoke without event (scheduled invocation)
      const result = await handler();

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('ok');

      // Verify S3 getObject WAS called
      expect(mockGetObject).toHaveBeenCalled();
    });
  });

  describe('settings read failure on scheduled invocation', () => {
    it('proceeds with sync when DynamoDB read fails (fail-safe to enabled)', async () => {
      mockGetSettings.mockRejectedValue(new Error('DynamoDB timeout'));

      // Invoke without event (scheduled invocation)
      const result = await handler();

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('ok');

      // Verify S3 getObject WAS called (fail-safe proceeds with sync)
      expect(mockGetObject).toHaveBeenCalled();
    });
  });

  describe('manual invocation with dataSyncEnabled=true', () => {
    it('proceeds with full sync when source is manual and toggle is enabled', async () => {
      mockGetSettings.mockResolvedValue({
        terraformOverlayEnabled: false,
        dataSyncEnabled: true,
        updatedAt: '2024-01-01T00:00:00.000Z',
      });

      const result = await handler({ source: 'manual' });

      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).message).toBe('ok');

      // Verify S3 getObject WAS called
      expect(mockGetObject).toHaveBeenCalled();
    });
  });
});
