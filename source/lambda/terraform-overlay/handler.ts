import { createGitHubClient, type GitHubClient, type DirectoryEntry } from './github-client';
import { parseAwsccSchemaContent } from './awscc-parser';
import { fetchFilesConcurrently } from './concurrent-fetcher';
import { assembleOverlayData, writeOverlayToS3 } from './mapping-writer';
import { parseServicePackageGen } from './classic-service-package-parser';
import { parseResourceGoFile } from './classic-resource-parser';
import { assembleClassicApiMapping, type ResourceApiMapping } from './classic-api-mapping-assembler';
import { writeClassicApiMappingToS3 } from './classic-api-mapping-writer';
import type { AwsccMapping, ClassicAwsMapping } from '../../shared/types/terraform-overlay';

export interface OverlayLambdaEvent {
  dataBucketName: string;
  githubToken?: string;
}

export interface OverlayLambdaResponse {
  statusCode: number;
  awsccCount: number;
  classicAwsCount: number;
  classicApiMappingCount: number;
  errors?: string[];
}

/** Configuration for the GitHub repositories */
const AWSCC_OWNER = 'hashicorp';
const AWSCC_REPO = 'terraform-provider-awscc';
const AWSCC_BRANCH = 'main';
const AWSCC_SCHEMAS_PATH = 'internal/service/cloudformation/schemas';

const CLASSIC_AWS_OWNER = 'hashicorp';
const CLASSIC_AWS_REPO = 'terraform-provider-aws';
const CLASSIC_AWS_BRANCH = 'main';
const CLASSIC_AWS_INTERNAL_SERVICE_PATH = 'internal/service';

/**
 * Converts a camelCase factory function name to a snake_case filename.
 *
 * Example: "resourceBucket" → "resource_bucket"
 * Example: "resourceS3BucketPolicy" → "resource_s3_bucket_policy"
 *
 * The resulting filename is used to locate the Go source file for a resource.
 */
export function factoryNameToFilename(factoryName: string): string {
  // Insert underscore before each uppercase letter, then lowercase everything
  return factoryName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, ''); // Remove leading underscore if first char was uppercase
}

/**
 * Derives classic AWS provider mappings from AWSCC mappings.
 *
 * For each AWSCC mapping (e.g., awscc_s3_bucket → AWS::S3::Bucket),
 * generates the corresponding classic AWS mapping (aws_s3_bucket → AWS::S3::Bucket)
 * by replacing the "awscc_" prefix with "aws_".
 *
 * This avoids fetching thousands of Go files from GitHub (which causes Lambda timeouts)
 * and provides reliable CFN type mappings for all resources that exist in both providers.
 * The classic AWS and AWSCC providers share the same underlying resource naming for
 * resources that have CloudFormation equivalents.
 */
export function deriveClassicAwsFromAwscc(awsccMappings: AwsccMapping[]): ClassicAwsMapping[] {
  return awsccMappings.map((m) => ({
    terraformType: 'aws_' + m.terraformType.slice(6), // awscc_s3_bucket → aws_s3_bucket
    cfnType: m.cfnType,
  }));
}

/**
 * Fetches AWSCC provider data from GitHub and parses schema file contents into mappings.
 * Returns the mappings array and the commit SHA used.
 *
 * Uses the Git Trees API (single recursive call) to discover JSON files, then
 * fetches each file's content concurrently and extracts the authoritative `typeName`
 * field from inside the JSON schema.
 */
async function fetchAwsccMappings(client: GitHubClient): Promise<{ mappings: AwsccMapping[]; commitSha: string }> {
  const commitSha = await client.getLatestCommitSha(AWSCC_OWNER, AWSCC_REPO, AWSCC_BRANCH);
  const tree = await client.getTree(AWSCC_OWNER, AWSCC_REPO, AWSCC_BRANCH, AWSCC_SCHEMAS_PATH);

  const jsonBlobs = tree.filter((entry) => entry.type === 'blob' && entry.path.endsWith('.json'));
  const paths = jsonBlobs.map((blob) => blob.path);

  // Fetch all JSON file contents concurrently
  const fetchResults = await fetchFilesConcurrently<string>(
    paths,
    (path) => client.getFileContent(AWSCC_OWNER, AWSCC_REPO, AWSCC_BRANCH, path),
  );

  // Parse each file's content to extract the typeName field
  const mappings: AwsccMapping[] = [];
  for (const fetchResult of fetchResults) {
    if (fetchResult.result === null) {
      continue;
    }
    const mapping = parseAwsccSchemaContent(fetchResult.result);
    if (mapping) {
      mappings.push(mapping);
    }
  }

  return { mappings, commitSha };
}

/**
 * Lambda handler entry point for the Terraform Overlay function.
 *
 * Orchestrates:
 * 1. Fetch AWSCC provider tree → fetch JSON file contents → extract typeName fields
 * 2. Derive classic AWS mappings from AWSCC data (zero API calls)
 * 3. Assemble overlay data
 * 4. Write to S3
 * 5. Fetch classic AWS provider tree → parse service_package_gen.go files → parse resource Go files
 * 6. Assemble classic API mapping data
 * 7. Write classic API mapping to S3
 *
 * Total GitHub API calls: 2 (getLatestCommitSha + getTree recursive) for AWSCC
 *   + 2 (getLatestCommitSha + listDirectory) for classic AWS
 *   + N file content fetches (via raw.githubusercontent.com, no rate limit)
 *
 * Classic API mapping failures do NOT affect AWSCC overlay output.
 */
export async function handler(event: OverlayLambdaEvent): Promise<OverlayLambdaResponse> {
  const { dataBucketName } = event;
  const errors: string[] = [];

  console.log(`Starting Terraform overlay generation for bucket: ${dataBucketName}`);

  // Prefer token from invocation payload, fall back to env var for backward compatibility
  const token = event.githubToken || process.env.GITHUB_TOKEN;
  const client = createGitHubClient(undefined, token);

  let awsccMappings: AwsccMapping[] = [];
  let classicAwsMappings: ClassicAwsMapping[] = [];
  let awsccCommitSha = 'unknown';

  // Fetch AWSCC provider data (the only GitHub fetch needed for overlay)
  try {
    const awsccResult = await fetchAwsccMappings(client);
    awsccMappings = awsccResult.mappings;
    awsccCommitSha = awsccResult.commitSha;
    console.log(`AWSCC: fetched ${awsccMappings.length} mappings (commit: ${awsccCommitSha.slice(0, 7)})`);
  } catch (error) {
    const message = `AWSCC fetch failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    errors.push(message);
  }

  // If AWSCC fetch failed, we have nothing to work with
  if (awsccMappings.length === 0 && errors.length > 0) {
    console.error('AWSCC fetch failed. Retaining existing mapping file.');
    return {
      statusCode: 500,
      awsccCount: 0,
      classicAwsCount: 0,
      classicApiMappingCount: 0,
      errors,
    };
  }

  // Derive classic AWS mappings from AWSCC data (no additional API calls)
  classicAwsMappings = deriveClassicAwsFromAwscc(awsccMappings);
  console.log(`Classic AWS: derived ${classicAwsMappings.length} mappings from AWSCC data`);

  // Assemble overlay data
  const overlayData = assembleOverlayData({
    awsccMappings,
    classicAwsMappings,
    awsccCommitSha,
    classicAwsCommitSha: awsccCommitSha, // Same source for both
  });

  // Write to S3
  try {
    await writeOverlayToS3({
      data: overlayData,
      bucketName: dataBucketName,
    });
    console.log(`Successfully wrote overlay to S3 bucket: ${dataBucketName}`);
  } catch (error) {
    const message = `S3 write failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    errors.push(message);

    return {
      statusCode: 500,
      awsccCount: awsccMappings.length,
      classicAwsCount: classicAwsMappings.length,
      classicApiMappingCount: 0,
      errors,
    };
  }

  // --- Classic API Mapping Extraction ---
  // This runs independently of the AWSCC overlay. Failures here do NOT affect the overlay output.
  let classicApiMappingCount = 0;
  try {
    classicApiMappingCount = await fetchAndWriteClassicApiMapping(client, dataBucketName);
    console.log(`Classic API mapping: wrote ${classicApiMappingCount} resource mappings`);
  } catch (error) {
    const message = `Classic API mapping failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(message);
    errors.push(message);
  }

  return {
    statusCode: 200,
    awsccCount: awsccMappings.length,
    classicAwsCount: classicAwsMappings.length,
    classicApiMappingCount,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

/**
 * Fetches classic AWS provider data from GitHub, parses service packages and
 * resource Go files, assembles the mapping, and writes it to S3.
 *
 * Steps:
 * 1. List service directories under internal/service/ using the Contents API
 * 2. For each service directory, fetch its service_package_gen.go file
 * 3. Parse each to get resource TypeNames per service package
 * 4. For each resource, locate its Go source file and fetch content
 * 5. Parse each resource file for SDK client method calls
 * 6. Assemble ClassicApiMappingData and write to S3
 *
 * Uses the Contents API instead of recursive tree to avoid GitHub's tree
 * truncation limit (~100k entries) which caused most services to be missed.
 *
 * Returns the number of resources in the final mapping.
 */
async function fetchAndWriteClassicApiMapping(client: GitHubClient, bucketName: string): Promise<number> {
  // Step 1: Get the commit SHA and list service directories
  const commitSha = await client.getLatestCommitSha(CLASSIC_AWS_OWNER, CLASSIC_AWS_REPO, CLASSIC_AWS_BRANCH);
  const serviceDirectories = await client.listDirectory(
    CLASSIC_AWS_OWNER, CLASSIC_AWS_REPO, CLASSIC_AWS_BRANCH, CLASSIC_AWS_INTERNAL_SERVICE_PATH,
  );

  // Step 2: Derive service_package_gen.go paths from directory listing
  const servicePackagePaths: { path: string; serviceName: string }[] = serviceDirectories
    .filter((entry) => entry.type === 'dir')
    .map((entry) => ({
      path: `${entry.path}/service_package_gen.go`,
      serviceName: entry.name,
    }));

  console.log(`Classic AWS: found ${servicePackagePaths.length} service directories (commit: ${commitSha.slice(0, 7)})`);

  if (servicePackagePaths.length === 0) {
    throw new Error('No service directories found in terraform-provider-aws internal/service/');
  }

  // Step 3: Fetch all service_package_gen.go files concurrently
  const servicePackageResults = await fetchFilesConcurrently<string>(
    servicePackagePaths.map((sp) => sp.path),
    (path) => client.getFileContent(CLASSIC_AWS_OWNER, CLASSIC_AWS_REPO, CLASSIC_AWS_BRANCH, path),
  );

  // Step 4: Parse each service_package_gen.go to get resource TypeNames and factory names.
  // Build a map of factoryName → { typeName, serviceName } for matching against actual files.
  const factoryToResource = new Map<string, { typeName: string; serviceName: string }>();

  for (let i = 0; i < servicePackageResults.length; i++) {
    const fetchResult = servicePackageResults[i];
    if (fetchResult.result === null) {
      console.warn(`Skipping service package (fetch failed): ${fetchResult.path}`);
      continue;
    }

    const serviceName = servicePackagePaths[i].serviceName;
    const resources = parseServicePackageGen(fetchResult.result);

    for (const resource of resources) {
      factoryToResource.set(resource.factoryName, {
        typeName: resource.typeName,
        serviceName,
      });
    }
  }

  console.log(`Classic AWS: parsed ${factoryToResource.size} resource factory functions`);

  // Step 5: List actual Go files in each service directory and fetch resource files.
  // This avoids fragile filename derivation — we read what's actually on disk.
  const serviceNames = [...new Set(servicePackagePaths.map((sp) => sp.serviceName))];
  const serviceFileLists = await fetchFilesConcurrently<DirectoryEntry[]>(
    serviceNames.map((name) => `${CLASSIC_AWS_INTERNAL_SERVICE_PATH}/${name}`),
    (path) => client.listDirectory(CLASSIC_AWS_OWNER, CLASSIC_AWS_REPO, CLASSIC_AWS_BRANCH, path),
  );

  // Collect all Go source files (skip tests and generated files)
  const resourceGoFilePaths: string[] = [];
  const resourceGoFileServiceName: string[] = [];

  for (let i = 0; i < serviceFileLists.length; i++) {
    const listResult = serviceFileLists[i];
    if (listResult.result === null) continue;

    const serviceName = serviceNames[i];
    for (const entry of listResult.result) {
      if (entry.type !== 'file') continue;
      if (!entry.name.endsWith('.go')) continue;
      if (entry.name.endsWith('_test.go')) continue;
      if (entry.name === 'service_package_gen.go') continue;
      if (entry.name.startsWith('exports_')) continue;
      resourceGoFilePaths.push(entry.path);
      resourceGoFileServiceName.push(serviceName);
    }
  }

  console.log(`Classic AWS: identified ${resourceGoFilePaths.length} resource Go files to fetch`);

  // Step 6: Fetch all resource Go files concurrently
  const resourceGoFileResults = await fetchFilesConcurrently<string>(
    resourceGoFilePaths,
    (path) => client.getFileContent(CLASSIC_AWS_OWNER, CLASSIC_AWS_REPO, CLASSIC_AWS_BRANCH, path),
  );

  // Step 7: Parse each resource file for SDK client method calls.
  // Match files to TypeNames by searching for factory function declarations.
  const serviceResources = new Map<string, ResourceApiMapping[]>();

  for (let i = 0; i < resourceGoFileResults.length; i++) {
    const fetchResult = resourceGoFileResults[i];
    if (fetchResult.result === null) continue;

    const serviceName = resourceGoFileServiceName[i];
    const content = fetchResult.result;
    const apiOperations = parseResourceGoFile(content);

    // Find which resource this file belongs to by matching factory function declarations
    // Look for "func factoryName(" pattern in the file content
    let matchedTypeName: string | null = null;
    for (const [factoryName, meta] of factoryToResource) {
      if (meta.serviceName !== serviceName) continue;
      // Match function declaration: "func factoryName(" or "func factoryName()"
      if (content.includes(`func ${factoryName}(`)) {
        matchedTypeName = meta.typeName;
        break;
      }
    }

    if (!matchedTypeName) continue; // File doesn't contain a known factory function
    if (apiOperations.length === 0) continue; // No API operations found

    const mapping: ResourceApiMapping = {
      terraformType: matchedTypeName,
      sdkService: serviceName,
      apiOperations,
    };

    const existing = serviceResources.get(serviceName) ?? [];
    existing.push(mapping);
    serviceResources.set(serviceName, existing);
  }

  // Step 7: Assemble and write to S3
  const classicApiMappingData = assembleClassicApiMapping({
    serviceResources,
    commitSha,
  });

  console.log(
    `Classic API mapping: assembled ${classicApiMappingData.metadata.resourceCount} resources across ${classicApiMappingData.metadata.serviceCount} services`,
  );

  await writeClassicApiMappingToS3({
    data: classicApiMappingData,
    bucketName,
  });

  return classicApiMappingData.metadata.resourceCount;
}
