import type { Region } from '@capability-insights/shared/types/capability/region';
import type { Product } from '@capability-insights/shared/types/capability/product';
import type { ApiService } from '@capability-insights/shared/types/capability/api';
import type { CfnResource } from '@capability-insights/shared/types/capability/cfn';
import type { SyncMetadata } from '@capability-insights/shared/types/sync-metadata';
import type { StackResourcesResponse } from '@capability-insights/shared/types/capability/stack';
import type { TerraformOverlayData } from '@capability-insights/shared/types/terraform-overlay';
import { s3Client } from './s3-client';
import { BaseApiClient } from './base-api-client';

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

export interface PresignedUrlResponse {
  uploadId: string;
  presignedUrl: string;
  s3Key: string;
}

export interface UploadCompleteResponse {
  success: boolean;
  uploadId: string;
  uploadedAt: string;
  mergeResult: { additions: number; updates: number; unchanged: number; total: number };
}

export interface UploadRecord {
  uploadId: string;
  fileName: string;
  s3Key: string;
  uploadedAt: string;
  itemCount: number;
  description: string;
}

export interface UploadsListResponse {
  uploads: UploadRecord[];
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

export class CapabilityInsightsClient extends BaseApiClient {
  private getDataUrl(name: DataFile, format: DataFormat): string {
    return `/data/${format}/${name}.${format}`;
  }

  exportUrls(name: DataFile): ExportUrls {
    return {
      json: this.getDataUrl(name, DataFormat.JSON),
      csv: this.getDataUrl(name, DataFormat.CSV),
    };
  }

  async syncCapabilityData(): Promise<void> {
    await this.post('/syncCapabilityData', {});
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
    const data = await this.get<{ stacks: string[] }>('/stacks');
    return data.stacks;
  }

  async getStackResourceTypes(stackName: string): Promise<StackResourcesResponse> {
    return this.get<StackResourcesResponse>(`/stacks/${encodeURIComponent(stackName)}/resources`);
  }

  async getSyncSettings(): Promise<SyncSettingsResponse> {
    return this.get<SyncSettingsResponse>('/syncSettings');
  }

  async updateSyncSettings(settings: {
    terraformOverlayEnabled: boolean;
    dataSyncEnabled?: boolean;
    githubToken?: string;
  }): Promise<SyncSettingsResponse> {
    return this.put<SyncSettingsResponse>('/syncSettings', settings);
  }

  async getDataFilesInfo(): Promise<DataFilesInfo> {
    return this.get<DataFilesInfo>('/data/info');
  }

  async getPresignedUrl(fileName: DataFile, label: string): Promise<PresignedUrlResponse> {
    return this.post<PresignedUrlResponse>('/data/uploads/presigned', { fileName, label });
  }

  async completeUpload(uploadId: string, fileName: DataFile, s3Key: string, description?: string): Promise<UploadCompleteResponse> {
    return this.post<UploadCompleteResponse>('/data/uploads/complete', { uploadId, fileName, s3Key, description });
  }

  async listUploads(fileName?: DataFile): Promise<UploadsListResponse> {
    const query = fileName ? `?fileName=${fileName}` : '';
    return this.get<UploadsListResponse>(`/data/uploads${query}`);
  }

  async deleteUpload(uploadId: string): Promise<{ success: boolean }> {
    return this.del<{ success: boolean }>(`/data/uploads/${uploadId}`);
  }
}

export const capabilityInsightsClient = new CapabilityInsightsClient();
