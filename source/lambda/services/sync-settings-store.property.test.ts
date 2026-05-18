import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { SyncSettingsStore, SYNC_SETTINGS_POLICY_ID } from './sync-settings-store';

/**
 * Property-based tests for SyncSettingsStore DynamoDB schema correctness.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3**
 *
 * Property 5: DynamoDB schema correctness
 * For any call to updateSettings/getSettings, the DynamoDB item SHALL NOT contain
 * a githubToken field. The item SHALL contain policyId, terraformOverlayEnabled,
 * dataSyncEnabled, and updatedAt fields.
 */

// --- In-memory DynamoDB mock ---
let capturedPutItems: Record<string, unknown>[] = [];
let inMemoryStore: Record<string, Record<string, unknown>> = {};

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

/**
 * Sets up the in-memory DynamoDB mock to simulate Get/Put operations
 * and capture items written via PutCommand.
 */
function setupInMemoryMock(): void {
  inMemoryStore = {};
  capturedPutItems = [];

  mockSend.mockImplementation((command: { input: Record<string, unknown>; constructor: { name: string } }) => {
    const commandName = command.constructor.name;

    if (commandName === 'PutCommand') {
      const item = (command.input as { Item: Record<string, unknown> }).Item;
      const key = item.policyId as string;
      inMemoryStore[key] = { ...item };
      capturedPutItems.push({ ...item });
      return Promise.resolve({});
    }

    if (commandName === 'GetCommand') {
      const key = ((command.input as { Key: Record<string, string> }).Key).policyId;
      const item = inMemoryStore[key];
      return Promise.resolve({ Item: item ?? undefined });
    }

    return Promise.reject(new Error(`Unexpected command: ${commandName}`));
  });
}

// --- Property Tests ---

describe('Property 5: DynamoDB schema correctness', () => {
  let store: SyncSettingsStore;

  beforeEach(() => {
    vi.clearAllMocks();
    setupInMemoryMock();
    store = new SyncSettingsStore('test-policy-table');
  });

  /**
   * **Validates: Requirements 8.1, 8.3**
   *
   * For any boolean values of terraformOverlayEnabled and dataSyncEnabled,
   * the DynamoDB item written by updateSettings SHALL contain policyId,
   * terraformOverlayEnabled, dataSyncEnabled, and updatedAt fields,
   * and SHALL NOT contain a githubToken field.
   */
  it('updateSettings never writes a githubToken field to DynamoDB', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        async (terraformOverlayEnabled, dataSyncEnabled) => {
          // Reset captured items for each iteration
          capturedPutItems = [];
          inMemoryStore = {};

          await store.updateSettings({
            terraformOverlayEnabled,
            dataSyncEnabled,
          });

          // Verify exactly one PutCommand was issued
          expect(capturedPutItems).toHaveLength(1);

          const writtenItem = capturedPutItems[0];

          // SHALL contain required fields
          expect(writtenItem).toHaveProperty('policyId', SYNC_SETTINGS_POLICY_ID);
          expect(writtenItem).toHaveProperty('terraformOverlayEnabled', terraformOverlayEnabled);
          expect(writtenItem).toHaveProperty('dataSyncEnabled', dataSyncEnabled);
          expect(writtenItem).toHaveProperty('updatedAt');
          expect(typeof writtenItem.updatedAt).toBe('string');
          expect((writtenItem.updatedAt as string).length).toBeGreaterThan(0);

          // SHALL NOT contain githubToken
          expect(writtenItem).not.toHaveProperty('githubToken');
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.2, 8.3**
   *
   * For any stored settings (without githubToken), getSettings SHALL return
   * an object with terraformOverlayEnabled, dataSyncEnabled, and updatedAt,
   * and SHALL NOT include a githubToken property.
   */
  it('getSettings response never contains a githubToken field', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        async (terraformOverlayEnabled, dataSyncEnabled) => {
          // Reset store for each iteration
          inMemoryStore = {};

          // First store settings via updateSettings
          await store.updateSettings({
            terraformOverlayEnabled,
            dataSyncEnabled,
          });

          // Then read them back
          const settings = await store.getSettings();

          // SHALL contain required fields
          expect(settings).toHaveProperty('terraformOverlayEnabled', terraformOverlayEnabled);
          expect(settings).toHaveProperty('dataSyncEnabled', dataSyncEnabled);
          expect(settings).toHaveProperty('updatedAt');
          expect(typeof settings.updatedAt).toBe('string');

          // SHALL NOT contain githubToken
          expect(settings).not.toHaveProperty('githubToken');

          // Verify no extra keys leak through
          const keys = Object.keys(settings);
          expect(keys).toContain('terraformOverlayEnabled');
          expect(keys).toContain('dataSyncEnabled');
          expect(keys).toContain('updatedAt');
          expect(keys).not.toContain('githubToken');
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.2**
   *
   * Even if a DynamoDB item contains a legacy githubToken field (from before migration),
   * getSettings SHALL NOT return it in the response.
   */
  it('getSettings does not return githubToken even if present in DynamoDB item', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 80 }),
        async (terraformOverlayEnabled, dataSyncEnabled, legacyToken) => {
          // Simulate a legacy DynamoDB item that still has githubToken
          inMemoryStore = {
            [SYNC_SETTINGS_POLICY_ID]: {
              policyId: SYNC_SETTINGS_POLICY_ID,
              terraformOverlayEnabled,
              dataSyncEnabled,
              updatedAt: '2024-01-01T00:00:00.000Z',
              githubToken: legacyToken,
            },
          };

          const settings = await store.getSettings();

          // SHALL NOT contain githubToken even if it exists in the raw DynamoDB item
          expect(settings).not.toHaveProperty('githubToken');

          // SHALL still return the other fields correctly
          expect(settings.terraformOverlayEnabled).toBe(terraformOverlayEnabled);
          expect(settings.dataSyncEnabled).toBe(dataSyncEnabled);
          expect(settings.updatedAt).toBe('2024-01-01T00:00:00.000Z');
        },
      ),
      { numRuns: 100 },
    );
  });
});
