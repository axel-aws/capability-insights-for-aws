export interface SyncMetadata {
  lastSyncTime?: string; // ISO 8601, only set on success
  errors?: string[]; // set when sync fails
  dataSyncSkipped?: boolean; // true when scheduled sync was skipped due to dataSyncEnabled being false
  terraformOverlay?: {
    generatedAt: string;
    awsccResourceCount: number;
    classicAwsResourceCount: number;
  };
  terraformClassicApiMapping?: {
    generatedAt: string;
    resourceCount: number;
    serviceCount: number;
  };
  terraformOverlaySkipped?: boolean; // true when overlay was skipped due to toggle being disabled
}
