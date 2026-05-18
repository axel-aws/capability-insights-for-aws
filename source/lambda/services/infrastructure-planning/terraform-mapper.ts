import { TerraformOverlayData } from '../../../shared/types/terraform-overlay';

/**
 * Result of mapping Terraform resource types to CloudFormation equivalents.
 */
export interface TerraformMappingResult {
  /** CloudFormation resource types that were successfully mapped. */
  cfnTypes: string[];
  /** Mapping of terraform type → CFN type for types that have a mapping. */
  mapping: Record<string, string>;
}

/**
 * Maps Terraform resource types to their CloudFormation equivalents.
 *
 * - For `awscc_*` types: converts via naming convention
 *   (e.g., `awscc_s3_bucket` → `AWS::S3::Bucket`)
 * - For `aws_*` types: looks up in overlay data's `classicAws` mappings
 * - Unmapped types are retained without a CFN equivalent
 */
export class TerraformMapper {
  /**
   * Maps an array of Terraform resource types to CloudFormation types.
   *
   * @param terraformTypes - Array of Terraform resource type identifiers
   * @param overlayData - The terraform overlay data containing classic AWS mappings
   * @returns An object with `cfnTypes` (successfully mapped CFN types) and
   *          `mapping` (terraform type → CFN type for all mapped types)
   */
  mapToCfn(
    terraformTypes: string[],
    overlayData: TerraformOverlayData
  ): TerraformMappingResult {
    const cfnTypes: string[] = [];
    const mapping: Record<string, string> = {};

    // Build a lookup map from the overlay's classicAws array for O(1) access
    const classicAwsLookup = new Map<string, string | null>();
    for (const entry of overlayData.classicAws) {
      classicAwsLookup.set(entry.terraformType, entry.cfnType);
    }

    for (const tfType of terraformTypes) {
      if (tfType.startsWith('awscc_')) {
        const cfnType = this.convertAwsccToCfn(tfType);
        cfnTypes.push(cfnType);
        mapping[tfType] = cfnType;
      } else if (tfType.startsWith('aws_')) {
        const cfnType = classicAwsLookup.get(tfType);
        if (cfnType) {
          cfnTypes.push(cfnType);
          mapping[tfType] = cfnType;
        }
        // Unmapped types (cfnType is null or not found) are retained without CFN equivalent
      }
    }

    return { cfnTypes, mapping };
  }

  /**
   * Converts an AWSCC Terraform type to its CloudFormation equivalent using naming convention.
   *
   * Convention:
   * 1. Remove the `awscc_` prefix
   * 2. Split on `_`
   * 3. Capitalize each segment
   * 4. Join with `::`
   * 5. Prefix with `AWS::`
   *
   * Example: `awscc_s3_bucket` → `AWS::S3::Bucket`
   */
  private convertAwsccToCfn(awsccType: string): string {
    const withoutPrefix = awsccType.slice('awscc_'.length);
    const segments = withoutPrefix.split('_');
    const capitalized = segments.map(
      (segment) => segment.charAt(0).toUpperCase() + segment.slice(1)
    );
    return `AWS::${capitalized.join('::')}`;
  }
}
