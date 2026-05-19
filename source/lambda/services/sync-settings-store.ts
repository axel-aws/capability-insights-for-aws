import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './dynamo-client';
import { logger } from '../util/logger';

export const SYNC_SETTINGS_POLICY_ID = 'SYNC_SETTINGS';

export interface SyncSettings {
  terraformOverlayEnabled: boolean;
  dataSyncEnabled: boolean;
  updatedAt: string;
}

export interface SyncSettingsResponse {
  terraformOverlayEnabled: boolean;
  hasToken: boolean;
  dataSyncEnabled: boolean;
  updatedAt: string;
}

export class SyncSettingsStore {
  constructor(private tableName: string) {}

  /** Read sync settings from DynamoDB. Returns safe defaults when no record exists. */
  async getSettings(): Promise<SyncSettings> {
    try {
      const result = await docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { policyId: SYNC_SETTINGS_POLICY_ID },
        }),
      );

      if (!result.Item) {
        return {
          terraformOverlayEnabled: false,
          dataSyncEnabled: true,
          updatedAt: '',
        };
      }

      return {
        terraformOverlayEnabled: result.Item.terraformOverlayEnabled ?? false,
        dataSyncEnabled: result.Item.dataSyncEnabled ?? true,
        updatedAt: result.Item.updatedAt ?? '',
      };
    } catch (error: unknown) {
      logger.error('Failed to read sync settings', { error: String(error) });
      throw new Error(`Failed to read sync settings: ${error}`);
    }
  }

  /** Validate and persist sync settings. */
  async updateSettings(update: {
    terraformOverlayEnabled: boolean;
    dataSyncEnabled?: boolean;
  }): Promise<SyncSettings> {
    const now = new Date().toISOString();

    const dataSyncEnabled = update.dataSyncEnabled ?? true;

    const item: Record<string, unknown> = {
      policyId: SYNC_SETTINGS_POLICY_ID,
      terraformOverlayEnabled: update.terraformOverlayEnabled,
      dataSyncEnabled,
      updatedAt: now,
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
        }),
      );

      logger.info('Updated sync settings', { terraformOverlayEnabled: update.terraformOverlayEnabled });

      return {
        terraformOverlayEnabled: update.terraformOverlayEnabled,
        dataSyncEnabled,
        updatedAt: now,
      };
    } catch (error: unknown) {
      logger.error('Failed to update sync settings', { error: String(error) });
      throw new Error(`Failed to update sync settings: ${error}`);
    }
  }
}
