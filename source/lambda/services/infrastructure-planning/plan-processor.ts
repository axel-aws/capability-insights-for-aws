/**
 * Plan Processor
 *
 * Orchestrates the processing pipeline for Infrastructure Plans.
 * Routes to the appropriate parser based on source type and produces
 * a CapabilitySet containing extracted resource types, API operations,
 * service names, and terraform-to-CFN mappings.
 *
 * Processing pipelines:
 * 1. CloudFormation: decode base64 → parse with CFN parser → derive service names
 * 2. Terraform: decode base64 → parse with TF parser → map to CFN types → derive service names
 * 3. GitHub: invoke GitHubFetchLambda → parse returned file contents locally → aggregate
 *
 * Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import {
  CapabilitySet,
  CreatePlanRequest,
} from '../../../shared/types/infrastructure-planning/plan-configuration';
import { TerraformOverlayData } from '../../../shared/types/terraform-overlay';
import { parseCfnTemplate } from './parsers/cfn-template-parser';
import { parseTerraformTemplate } from './parsers/terraform-template-parser';
import { parseResourceGoFile } from '../../terraform-overlay/classic-resource-parser';
import { parseJavaFile } from './parsers/java-sdk-parser';
import { parsePythonFile } from './parsers/python-sdk-parser';
import { parseTypeScriptFile } from './parsers/typescript-sdk-parser';
import { classifyFile } from './parsers/repository-analyzer';
import { TerraformMapper } from './terraform-mapper';
import type {
  GitHubFetchRequest,
  GitHubFetchResponse,
  GitHubFetchSuccessResponse,
  GitHubFetchErrorResponse,
} from '../../github-fetch-lambda-main';

/** Maximum template size in bytes (1MB). Validated before base64 decoding. */
const MAX_TEMPLATE_SIZE_BYTES = 1_048_576;

/**
 * Function signature for invoking the GitHubFetchLambda.
 * Accepts a request payload and returns the parsed response.
 */
export type InvokeGitHubFetchFn = (request: GitHubFetchRequest) => Promise<GitHubFetchResponse>;

/**
 * Options for constructing a PlanProcessor.
 */
export interface PlanProcessorOptions {
  /** Function to retrieve the terraform overlay data from S3. */
  getOverlayData: () => Promise<TerraformOverlayData>;
  /** Function to retrieve the GitHub PAT from sync settings. */
  getGitHubPat: () => Promise<string>;
  /**
   * Function to invoke the GitHubFetchLambda.
   * If not provided, a default implementation using AWS SDK Lambda InvokeCommand is used.
   */
  invokeGitHubFetch?: InvokeGitHubFetchFn;
  /**
   * The GitHubFetchLambda function name (read from GITHUB_FETCH_FUNCTION_NAME env var).
   * Required if invokeGitHubFetch is not provided.
   */
  gitHubFetchFunctionName?: string;
}

/**
 * Error HTTP status codes mapped from GitHubFetchLambda error types.
 */
const ERROR_TYPE_TO_STATUS: Record<GitHubFetchErrorResponse['errorType'], number> = {
  auth: 401,
  not_found: 404,
  rate_limit: 429,
  timeout: 504,
  unknown: 500,
};

/**
 * Error messages mapped from GitHubFetchLambda error types.
 */
const ERROR_TYPE_TO_MESSAGE: Record<GitHubFetchErrorResponse['errorType'], string> = {
  auth: 'GitHub token is invalid or expired',
  not_found: 'Cannot access repository',
  rate_limit: 'GitHub API rate limit exceeded',
  timeout: 'GitHub request timed out',
  unknown: 'An error occurred while fetching repository data',
};

/**
 * PlanProcessor orchestrates the processing of Infrastructure Plan requests.
 *
 * It routes to the appropriate parser based on the source type and produces
 * a unified CapabilitySet containing all extracted data.
 */
export class PlanProcessor {
  private readonly terraformMapper: TerraformMapper;
  private readonly getOverlayData: () => Promise<TerraformOverlayData>;
  private readonly getGitHubPat: () => Promise<string>;
  private readonly invokeGitHubFetch: InvokeGitHubFetchFn;

  constructor(options: PlanProcessorOptions) {
    this.terraformMapper = new TerraformMapper();
    this.getOverlayData = options.getOverlayData;
    this.getGitHubPat = options.getGitHubPat;

    if (options.invokeGitHubFetch) {
      this.invokeGitHubFetch = options.invokeGitHubFetch;
    } else {
      // Default implementation using AWS SDK Lambda InvokeCommand
      const functionName = options.gitHubFetchFunctionName || process.env.GITHUB_FETCH_FUNCTION_NAME;
      if (!functionName) {
        // Provide a stub that throws if actually called without configuration
        this.invokeGitHubFetch = async () => {
          throw new Error(
            'GitHubFetchLambda function name not configured. Set GITHUB_FETCH_FUNCTION_NAME environment variable.'
          );
        };
      } else {
        this.invokeGitHubFetch = createDefaultInvokeGitHubFetch(functionName);
      }
    }
  }

  /**
   * Processes a CreatePlanRequest and produces a CapabilitySet.
   *
   * @param request - The plan creation request containing source type and content
   * @returns A CapabilitySet with extracted resource types, API operations, and service names
   * @throws Error if template content is missing, too large, or cannot be parsed
   */
  async process(request: CreatePlanRequest): Promise<CapabilitySet> {
    switch (request.sourceType) {
      case 'cloudformation':
        return this.processCloudFormation(request);
      case 'terraform':
        return this.processTerraform(request);
      case 'github':
        return this.processGitHub(request);
      default:
        throw new Error(
          `Unsupported source type: ${request.sourceType as string}`
        );
    }
  }

  /**
   * Processes a CloudFormation template.
   *
   * Pipeline: validate size → decode base64 → parse → derive service names
   */
  private processCloudFormation(request: CreatePlanRequest): CapabilitySet {
    const content = this.decodeTemplateContent(request.templateContent);
    const cfnResourceTypes = parseCfnTemplate(content);
    const serviceNames = this.deriveServiceNames(cfnResourceTypes);

    return {
      cfnResourceTypes,
      terraformResourceTypes: [],
      apiOperations: [],
      serviceNames,
      terraformToCfnMapping: {},
    };
  }

  /**
   * Processes a Terraform template.
   *
   * Pipeline: validate size → decode base64 → parse TF → map to CFN → derive service names
   */
  private async processTerraform(
    request: CreatePlanRequest
  ): Promise<CapabilitySet> {
    const content = this.decodeTemplateContent(request.templateContent);
    const terraformResourceTypes = parseTerraformTemplate(content);

    // Load overlay data and map terraform types to CFN types
    const overlayData = await this.getOverlayData();
    const { cfnTypes, mapping } = this.terraformMapper.mapToCfn(
      terraformResourceTypes,
      overlayData
    );

    const serviceNames = this.deriveServiceNames(cfnTypes);

    return {
      cfnResourceTypes: cfnTypes.sort(),
      terraformResourceTypes,
      apiOperations: [],
      serviceNames,
      terraformToCfnMapping: mapping,
    };
  }

  /**
   * Processes a GitHub repository by invoking the GitHubFetchLambda.
   *
   * Pipeline:
   * 1. Validate repository URL
   * 2. Retrieve GitHub PAT
   * 3. Invoke GitHubFetchLambda with URL and PAT
   * 4. Parse the response
   * 5. Pass returned file contents to local parsers (Go, Java, Python, TypeScript, CFN, Terraform)
   * 6. Aggregate results into a CapabilitySet
   *
   * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
   */
  private async processGitHub(
    request: CreatePlanRequest
  ): Promise<CapabilitySet> {
    if (!request.repositoryUrl) {
      throw new Error(
        'Repository URL is required for GitHub source type'
      );
    }

    const pat = await this.getGitHubPat();

    // Invoke the GitHubFetchLambda
    let response: GitHubFetchResponse;
    try {
      response = await this.invokeGitHubFetch({
        repositoryUrl: request.repositoryUrl,
        pat,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to invoke GitHubFetchLambda: ${message}`);
    }

    // Handle error responses from the GitHubFetchLambda
    if (!response.success) {
      const errorResponse = response as GitHubFetchErrorResponse;
      const errorType = errorResponse.errorType;
      const baseMessage = ERROR_TYPE_TO_MESSAGE[errorType] || ERROR_TYPE_TO_MESSAGE.unknown;
      const detailMessage = errorResponse.error || baseMessage;

      // Throw with a message that includes the error type context for upstream error mapping
      const statusCode = ERROR_TYPE_TO_STATUS[errorType];
      throw new GitHubFetchError(detailMessage, errorType, statusCode);
    }

    // Parse the success response and process file contents locally
    const successResponse = response as GitHubFetchSuccessResponse;
    return this.processGitHubFiles(successResponse);
  }

  /**
   * Processes file contents returned by the GitHubFetchLambda using local parsers.
   *
   * Routes each file to the appropriate parser based on its extension/classification:
   * - .go files → parseResourceGoFile (extracts API operations)
   * - .java files → parseJavaFile (extracts API operations)
   * - .py files → parsePythonFile (extracts API operations)
   * - .ts/.js files → parseTypeScriptFile (extracts API operations)
   * - .yaml/.json files → parseCfnTemplate (if they look like CFN templates)
   * - .tf files → parseTerraformTemplate (extracts Terraform resource types)
   */
  private processGitHubFiles(response: GitHubFetchSuccessResponse): CapabilitySet {
    const apiOperations = new Set<string>();
    const cfnResourceTypes = new Set<string>();
    const terraformResourceTypes = new Set<string>();

    for (const [filePath, content] of Object.entries(response.files)) {
      try {
        const fileType = classifyFile(filePath);

        switch (fileType) {
          case 'go': {
            const operations = parseResourceGoFile(content);
            for (const op of operations) {
              apiOperations.add(op);
            }
            break;
          }
          case 'java': {
            const operations = parseJavaFile(content);
            for (const op of operations) {
              apiOperations.add(op);
            }
            break;
          }
          case 'python': {
            const operations = parsePythonFile(content);
            for (const op of operations) {
              apiOperations.add(op);
            }
            break;
          }
          case 'typescript': {
            const operations = parseTypeScriptFile(content);
            for (const op of operations) {
              apiOperations.add(op);
            }
            break;
          }
          case 'yaml':
          case 'json': {
            if (this.looksLikeCfnTemplate(content)) {
              const types = parseCfnTemplate(content);
              for (const type of types) {
                cfnResourceTypes.add(type);
              }
            }
            break;
          }
          case 'terraform': {
            const types = parseTerraformTemplate(content);
            for (const type of types) {
              terraformResourceTypes.add(type);
            }
            break;
          }
        }
      } catch {
        // Skip files that cannot be parsed — continue processing remaining files
      }
    }

    const cfnTypesArray = Array.from(cfnResourceTypes).sort();
    const serviceNames = this.deriveServiceNames(cfnTypesArray);

    const capabilitySet: CapabilitySet = {
      cfnResourceTypes: cfnTypesArray,
      terraformResourceTypes: Array.from(terraformResourceTypes).sort(),
      apiOperations: Array.from(apiOperations).sort(),
      serviceNames,
      terraformToCfnMapping: {},
    };

    // Add partial result metadata if the fetch timed out
    if (response.metadata.timedOut) {
      capabilitySet.partialResult = {
        isPartial: true,
        filesProcessed: response.metadata.filesProcessed,
        totalFilesIdentified: response.metadata.totalFilesIdentified,
      };
    }

    return capabilitySet;
  }

  /**
   * Checks if file content looks like a CloudFormation template by
   * checking for the presence of a "Resources" key.
   */
  private looksLikeCfnTemplate(content: string): boolean {
    return content.includes('"Resources"') || content.includes('Resources:');
  }

  /**
   * Validates template size and decodes base64-encoded template content.
   *
   * @param templateContent - The base64-encoded template content
   * @returns The decoded template content as a UTF-8 string
   * @throws Error if templateContent is missing or exceeds 1MB
   */
  private decodeTemplateContent(templateContent: string | undefined): string {
    if (!templateContent) {
      throw new Error(
        'Template content is required for cloudformation/terraform source types'
      );
    }

    // Validate size BEFORE decoding (check the base64 string length as a proxy for encoded size)
    const encodedBytes = Buffer.byteLength(templateContent, 'utf8');
    if (encodedBytes > MAX_TEMPLATE_SIZE_BYTES) {
      throw new Error('Template exceeds maximum size of 1MB');
    }

    // Decode base64 content
    const decoded = Buffer.from(templateContent, 'base64').toString('utf8');
    return decoded;
  }

  /**
   * Derives service names from CloudFormation resource types.
   *
   * Extracts the service segment from `AWS::{ServiceName}::{ResourceType}` format
   * and returns unique, sorted service names.
   *
   * @param cfnResourceTypes - Array of CloudFormation resource type identifiers
   * @returns Sorted array of unique service names
   */
  private deriveServiceNames(cfnResourceTypes: string[]): string[] {
    const serviceNames = new Set<string>();

    for (const type of cfnResourceTypes) {
      const parts = type.split('::');
      if (parts.length >= 2 && parts[0] === 'AWS') {
        serviceNames.add(parts[1]);
      }
    }

    return Array.from(serviceNames).sort();
  }
}

/**
 * Custom error class for GitHubFetchLambda errors.
 * Carries the error type and corresponding HTTP status code for upstream error mapping.
 */
export class GitHubFetchError extends Error {
  readonly errorType: GitHubFetchErrorResponse['errorType'];
  readonly statusCode: number;

  constructor(message: string, errorType: GitHubFetchErrorResponse['errorType'], statusCode: number) {
    super(message);
    this.name = 'GitHubFetchError';
    this.errorType = errorType;
    this.statusCode = statusCode;
  }
}

/**
 * Creates the default InvokeGitHubFetch function using AWS SDK Lambda InvokeCommand.
 *
 * @param functionName - The GitHubFetchLambda function name
 * @returns A function that invokes the GitHubFetchLambda and returns the parsed response
 */
function createDefaultInvokeGitHubFetch(functionName: string): InvokeGitHubFetchFn {
  const lambdaClient = new LambdaClient({});

  return async (request: GitHubFetchRequest): Promise<GitHubFetchResponse> => {
    const invokeResponse = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(request)),
      })
    );

    // Handle Lambda invocation-level errors (e.g., function not found, permission denied)
    if (invokeResponse.FunctionError) {
      const payloadString = invokeResponse.Payload
        ? new TextDecoder().decode(invokeResponse.Payload)
        : 'Unknown error';
      throw new Error(
        `GitHubFetchLambda execution failed: ${payloadString}`
      );
    }

    // Parse the response payload
    const payloadString = invokeResponse.Payload
      ? new TextDecoder().decode(invokeResponse.Payload)
      : null;

    if (!payloadString) {
      throw new Error('GitHubFetchLambda returned empty response');
    }

    try {
      return JSON.parse(payloadString) as GitHubFetchResponse;
    } catch {
      throw new Error(
        `Failed to parse GitHubFetchLambda response: ${payloadString.slice(0, 200)}`
      );
    }
  };
}
