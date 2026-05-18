import type { RegionCode } from '../capability/region';
import type { AvailabilityStatus } from './availability-status';

export enum RegionalAvailabilityType {
  SERVICE = 'Service',
  FEATURE = 'Feature',
  SDK_SERVICE = 'SDK Service',
  OPERATION = 'Operation',
  RESOURCE_TYPE = 'Resource Type',
  PROPERTY = 'Property',
  CONFIGURATION = 'Configuration',
}

export interface RegionalAvailability {
  id: string;
  parentId: string | null;
  name: string;
  regionalAvailabilityType: RegionalAvailabilityType;
  homepageUrl?: string;
  regionDates?: Record<RegionCode, string>;
  regionalAvailability?: Record<RegionCode, AvailabilityStatus>;
}

export interface ApiAvailability extends RegionalAvailability {
  sdkServiceName?: string;
  productName?: string;
}

export interface CfnAvailability extends RegionalAvailability {
  serviceName?: string;
  /** Original CFN type name, preserved when the display name is translated to Terraform conventions. */
  cfnName?: string;
}

export interface ProductAvailability extends RegionalAvailability {
  productType: string;
}
