import type { Region } from '@capability-insights/shared/types/capability/region';
import type { Product } from '@capability-insights/shared/types/capability/product';
import type { ApiService } from '@capability-insights/shared/types/capability/api';
import type { CfnResource } from '@capability-insights/shared/types/capability/cfn';
import type { SyncMetadata } from '@capability-insights/shared/types/sync-metadata';
import type { StackResourcesResponse } from '@capability-insights/shared/types/capability/stack';
import type { TerraformOverlayData } from '@capability-insights/shared/types/terraform-overlay';
import { s3Client } from './s3-client';

export interface SyncSettingsResponse {
  terraformOverlayEnabled: boolean;
  dataSyncEnabled: boolean;
  hasToken: boolean;
  updatedAt: string;
}

export interface DataFileInfo {
  name: string;
  lastModified: string | null;
  sizeBytes: number | null;
}

export interface DataFilesInfo {
  files: DataFileInfo[];
}

export interface MergePreview {
  mergeId: string;
  fileName: string;
  additions: number;
  updates: number;
  unchanged: number;
  totalAfterMerge: number;
}

export enum DataFormat {
  JSON = 'json',
  CSV = 'csv',
}

export enum DataFile {
  REGIONS = 'regions',
  PRODUCTS = 'products',
  APIS = 'apis',
  CFN_RESOURCES = 'cfn_resources',
}

export interface ExportUrls {
  json: string;
  csv: string;
}

export class CapabilityInsightsClient {
  private cachedBaseUrl: string | null = null;

  private getDataUrl(name: DataFile, format: DataFormat): string {
    return `/data/${format}/${name}.${format}`;
  }

  private async getApiBaseUrl(): Promise<string> {
    if (this.cachedBaseUrl) return this.cachedBaseUrl;
    const config = await s3Client.fetchJson<{ apiBaseUrl: string }>('/api-config.json');
    this.cachedBaseUrl = config.apiBaseUrl;
    return this.cachedBaseUrl;
  }

  exportUrls(name: DataFile): ExportUrls {
    return {
      json: this.getDataUrl(name, DataFormat.JSON),
      csv: this.getDataUrl(name, DataFormat.CSV),
    };
  }

  async syncCapabilityData(): Promise<void> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/syncCapabilityData`, { method: 'POST' });
    if (!res.ok) throw new Error(`Sync request failed: ${res.status}`);
  }

  async listRegions(): Promise<Region[]> {
    return s3Client.fetchJson(this.getDataUrl(DataFile.REGIONS, DataFormat.JSON));
  }

  async listProducts(): Promise<Product[]> {
    return s3Client.fetchJson(this.getDataUrl(DataFile.PRODUCTS, DataFormat.JSON));
  }

  async listApiOperations(): Promise<ApiService[]> {
    return s3Client.fetchJson(this.getDataUrl(DataFile.APIS, DataFormat.JSON));
  }

  async listCfnResources(): Promise<CfnResource[]> {
    return s3Client.fetchJson(this.getDataUrl(DataFile.CFN_RESOURCES, DataFormat.JSON));
  }

  async getLastSyncTime(): Promise<SyncMetadata | null> {
    return await s3Client.fetchJson<SyncMetadata>('/data/sync-metadata.json');
  }

  async listTerraformOverlay(): Promise<TerraformOverlayData | null> {
    try {
      return await s3Client.fetchJson<TerraformOverlayData>('/data/json/terraform_overlay.json');
    } catch {
      return null;
    }
  }

  async listStacks(): Promise<string[]> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/stacks`);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to list stacks: ${res.status}`);
    }
    const data = await res.json();
    return data.stacks;
  }

  async getStackResourceTypes(stackName: string): Promise<StackResourcesResponse> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/stacks/${encodeURIComponent(stackName)}/resources`);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.message ?? `Failed to get stack resources: ${res.status}`);
    }
    return res.json();
  }

  async getSyncSettings(): Promise<SyncSettingsResponse> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/syncSettings`);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? `Failed to get sync settings: ${res.status}`);
    }
    return res.json();
  }

  async updateSyncSettings(settings: {
    terraformOverlayEnabled: boolean;
    dataSyncEnabled?: boolean;
    githubToken?: string;
  }): Promise<SyncSettingsResponse> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/syncSettings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? `Failed to update sync settings: ${res.status}`);
    }
    return res.json();
  }

  async getDataFilesInfo(): Promise<DataFilesInfo> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/data/info`);
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? `Failed to get data files info: ${res.status}`);
    }
    return res.json();
  }

  async uploadDataFile(
    fileName: DataFile,
    content: string,
  ): Promise<{ success: boolean; lastModified: string }> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/data/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, content }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? `Failed to upload data file: ${res.status}`);
    }
    return res.json();
  }

  async previewMerge(fileName: DataFile, content: string): Promise<MergePreview> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/data/merge/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, content }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? `Failed to preview merge: ${res.status}`);
    }
    return res.json();
  }

  async commitMerge(
    fileName: DataFile,
    mergeId: string,
  ): Promise<{ success: boolean; itemCount: number }> {
    const baseUrl = await this.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/data/merge/commit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, mergeId }),
    });
    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error ?? `Failed to commit merge: ${res.status}`);
    }
    return res.json();
  }
}

export const capabilityInsightsClient = new CapabilityInsightsClient();
