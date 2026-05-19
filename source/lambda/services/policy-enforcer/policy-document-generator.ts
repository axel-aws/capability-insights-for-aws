import type { ApiService } from '@capability-insights/shared/types/capability/api';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { AvailabilityStatus } from '../../../shared/types/availability/availability-status';
import { toIamAction } from './iam-action-mapping';

export interface PolicyDocumentOptions {
  catalogData: ApiService[];
  configuration: PolicyConfiguration;
  policyName: string;
  generationTimestamp: string;
}

export interface GeneratedPolicy {
  documents: PolicyDocument[];
  totalSize: number;
  splitRequired: boolean;
  blanketDenyServiceCount: number;
  partialDenyActionCount: number;
  fullyAvailableServiceCount: number;
  error?: string;
}

export interface PolicyDocument {
  Version: '2012-10-17';
  Statement: PolicyStatement[];
}

export interface PolicyStatement {
  Sid: string;
  Effect: 'Deny';
  NotAction?: string[];
  Action?: string[];
  Resource: '*';
}

/**
 * Classification result for a single service.
 */
interface ServiceClassification {
  /** IAM prefix for this service (e.g., "s3", "ec2") */
  iamPrefix: string;
  /** Total number of APIs in this service */
  totalAPIs: number;
  /** Number of APIs available in ALL selected regions */
  availableAPIs: number;
  /** Number of APIs NOT available in all selected regions */
  unavailableAPIs: number;
  /** The specific IAM actions that are available */
  availableActions: string[];
  /** The specific IAM actions that are unavailable */
  unavailableActions: string[];
}

const IAM_SIZE_LIMIT = 6144;
const SCP_SIZE_LIMIT = 5120;

/**
 * Classifies each service in the catalog based on regional availability.
 *
 * For each service:
 * - Computes totalAPIs (total APIs for that service)
 * - Computes availableAPIs (APIs available in ALL selected regions)
 * - Computes unavailableAPIs = totalAPIs - availableAPIs
 *
 * Uses intersection semantics: an API is "available" only if it has
 * AvailabilityStatus.AVAILABLE in ALL selected regions.
 */
function classifyServices(
  catalogData: ApiService[],
  regions: string[],
  mode: 'intersection' | 'union',
  exceptions: { action: string }[],
): ServiceClassification[] {
  const exceptionSet = new Set(exceptions.map(e => e.action));
  const classifications: ServiceClassification[] = [];

  for (const service of catalogData) {
    if (service.apis.length === 0) continue;

    // Determine IAM prefix from the first API's homepage
    const firstHomepage = service.apis[0]?.homepage;
    const sampleAction = toIamAction(service.sdkServiceName, 'X', firstHomepage);
    const iamPrefix = sampleAction.split(':')[0];

    let availableCount = 0;
    const unavailableActions: string[] = [];
    const availableActions: string[] = [];

    for (const operation of service.apis) {
      const iamAction = toIamAction(service.sdkServiceName, operation.apiAction, operation.homepage);

      let isAvailable: boolean;
      if (mode === 'intersection') {
        isAvailable = regions.every(
          (region) => operation.regionalAvailability[region] === AvailabilityStatus.AVAILABLE
        );
      } else {
        isAvailable = regions.some(
          (region) => operation.regionalAvailability[region] === AvailabilityStatus.AVAILABLE
        );
      }

      // If the action is in exceptions, treat it as available (don't deny it)
      if (exceptionSet.has(iamAction)) {
        isAvailable = true;
      }

      if (isAvailable) {
        availableCount++;
        availableActions.push(iamAction);
      } else {
        unavailableActions.push(iamAction);
      }
    }

    classifications.push({
      iamPrefix,
      totalAPIs: service.apis.length,
      availableAPIs: availableCount,
      unavailableAPIs: service.apis.length - availableCount,
      availableActions,
      unavailableActions,
    });
  }

  return classifications;
}

/**
 * Builds a blanket deny document with NotAction wildcards.
 */
function buildBlanketDenyDocument(notActions: string[], sid: string): PolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: sid,
        Effect: 'Deny',
        NotAction: notActions,
        Resource: '*',
      },
    ],
  };
}

/**
 * Builds a specific API deny document with Action list.
 */
function buildApiDenyDocument(actions: string[], sid: string): PolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: sid,
        Effect: 'Deny',
        Action: actions,
        Resource: '*',
      },
    ],
  };
}

/**
 * Returns the JSON-serialized size of a policy document in characters.
 */
function getDocumentSize(document: PolicyDocument): number {
  return JSON.stringify(document).length;
}

/**
 * Generates a Sid string for the blanket deny document.
 * Format: PolicyEnforcerBlanketDeny{timestamp}
 */
function generateBlanketDenySid(timestamp: string): string {
  const sanitizedTimestamp = timestamp.replace(/[^a-zA-Z0-9]/g, '');
  return `PolicyEnforcerBlanketDeny${sanitizedTimestamp}`;
}

/**
 * Generates a Sid string for API deny documents.
 * Format: PolicyEnforcerAPIDeny{timestamp}Part{N}
 */
function generateApiDenySid(timestamp: string, partNumber: number): string {
  const sanitizedTimestamp = timestamp.replace(/[^a-zA-Z0-9]/g, '');
  return `PolicyEnforcerAPIDeny${sanitizedTimestamp}Part${partNumber}`;
}

/**
 * Bin-packs actions into multiple policy documents, each fitting within the IAM size limit.
 * Uses binary search to find the maximum number of actions per chunk.
 */
function binPackActions(actions: string[], timestamp: string): PolicyDocument[] {
  if (actions.length === 0) return [];

  const documents: PolicyDocument[] = [];
  let remaining = [...actions];
  let partNumber = 1;

  while (remaining.length > 0) {
    const sid = generateApiDenySid(timestamp, partNumber);

    // Binary search for the maximum number of actions that fit
    let low = 1;
    let high = remaining.length;
    let maxFit = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const testDoc = buildApiDenyDocument(remaining.slice(0, mid), sid);
      const size = getDocumentSize(testDoc);

      if (size <= IAM_SIZE_LIMIT) {
        maxFit = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // If even a single action doesn't fit, include it anyway (edge case)
    if (maxFit === 0) {
      maxFit = 1;
    }

    const chunk = remaining.slice(0, maxFit);
    remaining = remaining.slice(maxFit);

    documents.push(buildApiDenyDocument(chunk, sid));
    partNumber++;
  }

  return documents;
}

/**
 * Generates IAM/SCP policy documents using a two-tier strategy with size optimization:
 *
 * Tier 1 (Blanket Deny): A single policy with NotAction containing either `service:*` wildcards
 * or specific available action names. Services with zero available APIs are implicitly denied
 * by the blanket deny (they're not in the NotAction list).
 *
 * Tier 2 (Specific API Deny): One or more policies with Action lists containing the
 * specific unavailable APIs within partially-available services. These are bin-packed
 * into 6,144-char chunks.
 *
 * Size optimization for partially-available services:
 * For each partially-available service, the generator compares two strategies:
 * - Strategy A: `service:*` in NotAction + list all unavailable actions in Action deny
 * - Strategy B: list all available actions individually in NotAction (no Action deny needed)
 *
 * It picks whichever produces fewer total characters. When a service has many unavailable
 * actions but few available ones (common in newer regions), Strategy B dramatically reduces
 * the number of Action deny documents needed.
 *
 * Classification logic per service:
 * | Condition                                        | Strategy                                              |
 * |--------------------------------------------------|-------------------------------------------------------|
 * | availableAPIs == 0                               | Don't add to NotAction (blanket deny covers it)       |
 * | availableAPIs == totalAPIs                       | Add `service:*` to NotAction list                     |
 * | availableAPIs > 0 && availableAPIs < totalAPIs   | Compare strategies A vs B, pick smaller               |
 */
export function generatePolicyDocument(options: PolicyDocumentOptions): GeneratedPolicy {
  const { catalogData, configuration, generationTimestamp } = options;
  const { regions, mode, policyType, exceptions } = configuration;

  // Classify all services
  const classifications = classifyServices(catalogData, regions, mode, exceptions);

  // Build the NotAction list and collect specific deny actions
  const notActionEntries: string[] = [];
  const specificDenyActions: string[] = [];
  let blanketDenyServiceCount = 0;
  let fullyAvailableServiceCount = 0;

  // Track prefixes already added to avoid duplicates from services sharing a prefix
  const addedWildcardPrefixes = new Set<string>();
  // Track specific actions already added to NotAction to avoid duplicates
  const addedNotActionEntries = new Set<string>();

  for (const classification of classifications) {
    if (classification.availableAPIs === 0) {
      // Blanket deny covers this service entirely — don't add to NotAction
      blanketDenyServiceCount++;
    } else if (classification.availableAPIs === classification.totalAPIs) {
      // All APIs available — add service:* to NotAction
      const wildcard = `${classification.iamPrefix}:*`;
      if (!addedWildcardPrefixes.has(wildcard)) {
        notActionEntries.push(wildcard);
        addedWildcardPrefixes.add(wildcard);
        addedNotActionEntries.add(wildcard);
      }
      fullyAvailableServiceCount++;
    } else {
      // Partially available — compare two strategies:
      // Strategy A (current): service:* in NotAction + list unavailable actions in Action deny
      // Strategy B (flipped): list available actions in NotAction (no separate deny needed)
      //
      // Pick whichever produces fewer total characters in the output.
      // Strategy A cost: wildcard in NotAction ("service:*") + all unavailable actions in Action deny
      // Strategy B cost: all available actions listed individually in NotAction
      const wildcard = `${classification.iamPrefix}:*`;
      const wildcardCost = wildcard.length;
      const unavailableCost = classification.unavailableActions.reduce((sum, a) => sum + a.length + 3, 0); // +3 for JSON: quotes + comma
      const strategyACost = wildcardCost + unavailableCost;

      const availableCost = classification.availableActions.reduce((sum, a) => sum + a.length + 3, 0); // +3 for JSON: quotes + comma
      const strategyBCost = availableCost;

      if (strategyBCost < strategyACost) {
        // Flipped: list available actions directly in NotAction
        for (const action of classification.availableActions) {
          if (!addedNotActionEntries.has(action)) {
            notActionEntries.push(action);
            addedNotActionEntries.add(action);
          }
        }
      } else {
        // Original: service:* in NotAction + deny specific unavailable actions
        if (!addedWildcardPrefixes.has(wildcard)) {
          notActionEntries.push(wildcard);
          addedWildcardPrefixes.add(wildcard);
          addedNotActionEntries.add(wildcard);
        }
        specificDenyActions.push(...classification.unavailableActions);
      }
      fullyAvailableServiceCount++;
    }
  }

  // Sort for deterministic output and deduplicate
  notActionEntries.sort();
  const uniqueSpecificDenyActions = [...new Set(specificDenyActions)].sort();

  const partialDenyActionCount = uniqueSpecificDenyActions.length;

  // Build Policy 1: Blanket Deny with NotAction entries
  const blanketDenySid = generateBlanketDenySid(generationTimestamp);
  const blanketDenyDoc = buildBlanketDenyDocument(notActionEntries, blanketDenySid);

  // Handle SCP type
  if (policyType === 'SCP') {
    // For SCP, we combine everything into a single document
    // Add specific deny actions as a second statement if needed
    const documents: PolicyDocument[] = [];

    if (uniqueSpecificDenyActions.length > 0) {
      const combinedDoc: PolicyDocument = {
        Version: '2012-10-17',
        Statement: [
          {
            Sid: blanketDenySid,
            Effect: 'Deny',
            NotAction: notActionEntries,
            Resource: '*',
          },
          {
            Sid: generateApiDenySid(generationTimestamp, 1),
            Effect: 'Deny',
            Action: uniqueSpecificDenyActions,
            Resource: '*',
          },
        ],
      };
      documents.push(combinedDoc);
    } else {
      documents.push(blanketDenyDoc);
    }

    const totalSize = documents.reduce((sum, doc) => sum + getDocumentSize(doc), 0);

    if (totalSize > SCP_SIZE_LIMIT) {
      return {
        documents,
        totalSize,
        splitRequired: false,
        blanketDenyServiceCount,
        partialDenyActionCount,
        fullyAvailableServiceCount,
        error: `SCP document exceeds the 5,120 character limit (${totalSize} characters). ` +
          'Service Control Policies cannot be split into multiple documents. ' +
          'Consider reducing the allow-list scope by selecting fewer regions, ' +
          'switching to intersection mode, or using IAM Policy type instead.',
      };
    }

    return {
      documents,
      totalSize,
      splitRequired: false,
      blanketDenyServiceCount,
      partialDenyActionCount,
      fullyAvailableServiceCount,
    };
  }

  // IAM policy type — build documents
  // Split the blanket deny document if it exceeds the size limit
  const documents: PolicyDocument[] = [];
  const blanketDenySize = getDocumentSize(blanketDenyDoc);

  if (blanketDenySize <= IAM_SIZE_LIMIT) {
    documents.push(blanketDenyDoc);
  } else {
    // Split NotAction entries across multiple blanket deny documents
    let remaining = [...notActionEntries];
    let partNum = 1;

    while (remaining.length > 0) {
      const sid = `${blanketDenySid}Part${partNum}`;
      let low = 1;
      let high = remaining.length;
      let maxFit = 0;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const testDoc = buildBlanketDenyDocument(remaining.slice(0, mid), sid);
        const size = getDocumentSize(testDoc);
        if (size <= IAM_SIZE_LIMIT) {
          maxFit = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      if (maxFit === 0) maxFit = 1;
      documents.push(buildBlanketDenyDocument(remaining.slice(0, maxFit), sid));
      remaining = remaining.slice(maxFit);
      partNum++;
    }
  }

  // Bin-pack specific deny actions into additional documents
  if (uniqueSpecificDenyActions.length > 0) {
    const apiDenyDocs = binPackActions(uniqueSpecificDenyActions, generationTimestamp);
    documents.push(...apiDenyDocs);
  }

  const totalSize = documents.reduce((sum, doc) => sum + getDocumentSize(doc), 0);
  const splitRequired = documents.length > 1;

  return {
    documents,
    totalSize,
    splitRequired,
    blanketDenyServiceCount,
    partialDenyActionCount,
    fullyAvailableServiceCount,
  };
}
