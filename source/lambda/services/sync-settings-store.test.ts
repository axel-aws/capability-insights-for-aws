import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncSettingsStore, SYNC_SETTINGS_POLICY_ID } from './sync-settings-store';

/**
 * Unit tests for sync-settings-store.
 * Validates: Requirements 8.1, 8.2, 8.3
 */

// --- Mock DynamoDB DocumentClient ---
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-dynamodb', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-dynamodb')>('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: vi.fn().mockImplementation(() => ({})),
  };
});

vi.mock('@aws-sdk/lib-dynamodb', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/lib-dynamodb')>('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: vi.fn().mockReturnValue({ send: mockSend }),
    },
    PutCommand: actual.PutCommand,
    GetCommand: actual.GetCommand,
  };
});

describe('SyncSettingsStore', () => {
  let store: SyncSettingsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new SyncSettingsStore('test-policy-table');
  });

  describe('SYNC_SETTINGS_POLICY_ID', () => {
    it('has the expected constant value', () => {
      expect(SYNC_SETTINGS_POLICY_ID).toBe('SYNC_SETTINGS');
    });
  });

  describe('getSettings', () => {
    it('returns safe defaults when no record exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await store.getSettings();

      expect(result).toEqual({
        terraformOverlayEnabled: false,
        dataSyncEnabled: true,
        updatedAt: '',
      });
    });

    it('returns stored settings when record exists', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          policyId: SYNC_SETTINGS_POLICY_ID,
          terraformOverlayEnabled: true,
          dataSyncEnabled: false,
          updatedAt: '2024-06-01T00:00:00.000Z',
        },
      });

      const result = await store.getSettings();

      expect(result).toEqual({
        terraformOverlayEnabled: true,
        dataSyncEnabled: false,
        updatedAt: '2024-06-01T00:00:00.000Z',
      });
    });

    it('does not return a githubToken field', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          policyId: SYNC_SETTINGS_POLICY_ID,
          terraformOverlayEnabled: true,
          githubToken: 'ghp_legacy_token_in_db',
          dataSyncEnabled: true,
          updatedAt: '2024-06-01T00:00:00.000Z',
        },
      });

      const result = await store.getSettings();

      expect(result).not.toHaveProperty('githubToken');
      expect(Object.keys(result)).toEqual(['terraformOverlayEnabled', 'dataSyncEnabled', 'updatedAt']);
    });

    it('throws an error when DynamoDB is unreachable', async () => {
      mockSend.mockRejectedValueOnce(new Error('Service unavailable'));

      await expect(store.getSettings()).rejects.toThrow('Failed to read sync settings');
    });

    it('defaults dataSyncEnabled to true when field is missing from DynamoDB item', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          policyId: SYNC_SETTINGS_POLICY_ID,
          terraformOverlayEnabled: true,
          updatedAt: '2024-06-01T00:00:00.000Z',
        },
      });

      const result = await store.getSettings();

      expect(result.dataSyncEnabled).toBe(true);
    });
  });

  describe('updateSettings', () => {
    it('persists settings without githubToken when enabling', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await store.updateSettings({
        terraformOverlayEnabled: true,
      });

      expect(result.terraformOverlayEnabled).toBe(true);
      expect(result.dataSyncEnabled).toBe(true);
      expect(result.updatedAt).toBeDefined();
      expect(result).not.toHaveProperty('githubToken');

      // Verify the PutCommand was called without githubToken
      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.terraformOverlayEnabled).toBe(true);
      expect(putCall.input.Item.dataSyncEnabled).toBe(true);
      expect(putCall.input.Item.policyId).toBe(SYNC_SETTINGS_POLICY_ID);
      expect(putCall.input.Item).not.toHaveProperty('githubToken');
    });

    it('does not write githubToken to DynamoDB even if somehow passed', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await store.updateSettings({
        terraformOverlayEnabled: true,
        dataSyncEnabled: true,
      });

      // Verify the PutCommand item does not contain githubToken
      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item).not.toHaveProperty('githubToken');
      expect(result).not.toHaveProperty('githubToken');
    });

    it('persists settings when disabling overlay', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await store.updateSettings({
        terraformOverlayEnabled: false,
      });

      expect(result.terraformOverlayEnabled).toBe(false);
      expect(result.dataSyncEnabled).toBe(true);
      expect(result).not.toHaveProperty('githubToken');

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item).not.toHaveProperty('githubToken');
    });

    it('throws an error when DynamoDB write fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Throttled'));

      await expect(
        store.updateSettings({
          terraformOverlayEnabled: true,
        }),
      ).rejects.toThrow('Failed to update sync settings');
    });

    it('persists dataSyncEnabled as false when explicitly set', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await store.updateSettings({
        terraformOverlayEnabled: false,
        dataSyncEnabled: false,
      });

      expect(result.dataSyncEnabled).toBe(false);

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.dataSyncEnabled).toBe(false);
    });

    it('defaults dataSyncEnabled to true when not provided', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await store.updateSettings({
        terraformOverlayEnabled: false,
      });

      expect(result.dataSyncEnabled).toBe(true);

      const putCall = mockSend.mock.calls[0][0];
      expect(putCall.input.Item.dataSyncEnabled).toBe(true);
    });
  });
});
