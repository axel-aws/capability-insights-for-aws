/**
 * Classic API mapping assembler.
 *
 * Combines parsed service package data and resource API operations into
 * the final `ClassicApiMappingData` structure. This is a pure function
 * that takes the intermediate parsed results and produces the output
 * format written to S3 for frontend consumption.
 */

import type {
  ClassicApiMappingData,
  ClassicApiMappingMetadata,
  ClassicApiResourceMapping,
} from '../../shared/types/terraform-classic-api-mapping';

export interface ResourceApiMapping {
  /** Terraform resource type name, e.g., "aws_s3_bucket" */
  terraformType: string;
  /** SDK service name, e.g., "S3" */
  sdkService: string;
  /** List of API operation names, e.g., ["CreateBucket", "PutBucketPolicy"] */
  apiOperations: string[];
}

export interface AssembleClassicApiMappingParams {
  /** Map of service name → array of resource API mappings */
  serviceResources: Map<string, ResourceApiMapping[]>;
  /** Git commit SHA of the terraform-provider-aws repository */
  commitSha: string;
}

/**
 * Derives the registry path from a Terraform type name by stripping the `aws_` prefix.
 *
 * Example: "aws_s3_bucket" → "s3_bucket"
 *
 * If the type does not start with `aws_`, the full type name is returned as-is.
 */
export function deriveRegistryPath(terraformType: string): string {
  const prefix = 'aws_';
  if (terraformType.startsWith(prefix)) {
    return terraformType.slice(prefix.length);
  }
  return terraformType;
}

/**
 * Assemble the final ClassicApiMappingData from parsed service packages
 * and resource files.
 *
 * For each resource in the serviceResources map, creates a
 * ClassicApiResourceMapping with:
 * - terraformType from the input
 * - sdkService from the input
 * - requiredApis from apiOperations
 * - registryPath derived by stripping the `aws_` prefix from terraformType
 *
 * Populates metadata with generatedAt (ISO timestamp), providerCommitSha,
 * resourceCount, and serviceCount.
 */
export function assembleClassicApiMapping(params: AssembleClassicApiMappingParams): ClassicApiMappingData {
  const { serviceResources, commitSha } = params;

  const resources: ClassicApiResourceMapping[] = [];
  const serviceNames = new Set<string>();

  for (const [, resourceMappings] of serviceResources) {
    for (const mapping of resourceMappings) {
      serviceNames.add(mapping.sdkService);

      resources.push({
        terraformType: mapping.terraformType,
        sdkService: mapping.sdkService,
        requiredApis: mapping.apiOperations,
        registryPath: deriveRegistryPath(mapping.terraformType),
      });
    }
  }

  const metadata: ClassicApiMappingMetadata = {
    generatedAt: new Date().toISOString(),
    providerCommitSha: commitSha,
    resourceCount: resources.length,
    serviceCount: serviceNames.size,
  };

  return {
    metadata,
    resources,
  };
}
