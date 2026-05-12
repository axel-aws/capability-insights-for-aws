export interface PolicyDocumentOptions {
  allowList: string[];
  policyType: 'IAM' | 'SCP';
  policyName: string;
  generationTimestamp: string;
}

export interface GeneratedPolicy {
  documents: PolicyDocument[];
  totalSize: number;
  splitRequired: boolean;
  error?: string;
}

export interface PolicyDocument {
  Version: '2012-10-17';
  Statement: PolicyStatement[];
}

export interface PolicyStatement {
  Sid: string;
  Effect: 'Deny';
  NotAction: string[];
  Resource: '*';
}

const IAM_SIZE_LIMIT = 6144;
const SCP_SIZE_LIMIT = 5120;

/**
 * Builds a single policy document with the given actions and Sid.
 */
function buildDocument(actions: string[], sid: string): PolicyDocument {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: sid,
        Effect: 'Deny',
        NotAction: actions,
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
 * Generates a Sid string incorporating the policy name context and timestamp.
 * For split policies, appends a part number.
 */
function generateSid(timestamp: string, partNumber?: number): string {
  const sanitizedTimestamp = timestamp.replace(/[^a-zA-Z0-9]/g, '');
  if (partNumber !== undefined) {
    return `PolicyEnforcer${sanitizedTimestamp}Part${partNumber}`;
  }
  return `PolicyEnforcer${sanitizedTimestamp}`;
}

/**
 * Splits the NotAction list into chunks that each fit within the given size limit
 * when serialized as a complete policy document.
 *
 * Uses binary search to find the maximum number of actions per chunk.
 */
function splitActionsForIam(actions: string[], timestamp: string): PolicyDocument[] {
  const documents: PolicyDocument[] = [];
  let remaining = [...actions];
  let partNumber = 1;

  while (remaining.length > 0) {
    const sid = generateSid(timestamp, partNumber);

    // Binary search for the maximum number of actions that fit
    let low = 1;
    let high = remaining.length;
    let maxFit = 0;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const testDoc = buildDocument(remaining.slice(0, mid), sid);
      const size = getDocumentSize(testDoc);

      if (size <= IAM_SIZE_LIMIT) {
        maxFit = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // If even a single action doesn't fit, include it anyway (edge case with extremely long action name)
    if (maxFit === 0) {
      maxFit = 1;
    }

    const chunk = remaining.slice(0, maxFit);
    remaining = remaining.slice(maxFit);

    documents.push(buildDocument(chunk, sid));
    partNumber++;
  }

  return documents;
}

/**
 * Generates one or more IAM/SCP policy documents from an allow-list.
 *
 * - Builds the base document structure with Version "2012-10-17" and a Deny statement
 * - Serializes to JSON to check size against limits
 * - IAM: If over 6,144 chars, splits NotAction across multiple documents
 * - SCP: If over 5,120 chars, returns error with guidance (cannot split SCPs)
 *
 * The Sid field includes the generation timestamp for traceability.
 */
export function generatePolicyDocument(options: PolicyDocumentOptions): GeneratedPolicy {
  const { allowList, policyType, generationTimestamp } = options;

  // Build a single document first
  const sid = generateSid(generationTimestamp);
  const singleDocument = buildDocument(allowList, sid);
  const singleDocSize = getDocumentSize(singleDocument);

  if (policyType === 'SCP') {
    if (singleDocSize > SCP_SIZE_LIMIT) {
      return {
        documents: [singleDocument],
        totalSize: singleDocSize,
        splitRequired: false,
        error: `SCP document exceeds the 5,120 character limit (${singleDocSize} characters). ` +
          'Service Control Policies cannot be split into multiple documents. ' +
          'Consider reducing the allow-list scope by selecting fewer regions, ' +
          'switching to intersection mode, or using IAM Policy type instead.',
      };
    }

    return {
      documents: [singleDocument],
      totalSize: singleDocSize,
      splitRequired: false,
    };
  }

  // IAM policy type
  if (singleDocSize <= IAM_SIZE_LIMIT) {
    return {
      documents: [singleDocument],
      totalSize: singleDocSize,
      splitRequired: false,
    };
  }

  // Need to split for IAM
  const documents = splitActionsForIam(allowList, generationTimestamp);
  const totalSize = documents.reduce((sum, doc) => sum + getDocumentSize(doc), 0);

  return {
    documents,
    totalSize,
    splitRequired: true,
  };
}
