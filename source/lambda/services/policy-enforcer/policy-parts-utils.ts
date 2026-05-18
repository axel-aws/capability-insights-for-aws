import type {
  PolicyConfiguration,
  PolicyPart,
  ServiceActionGroup,
  CascadingDeleteResponse,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

/**
 * Compute summary statistics for an array of policy parts.
 * totalParts = array length, combinedSize = sum of documentSize values.
 */
export function computePartsSummary(parts: PolicyPart[]): { totalParts: number; combinedSize: number } {
  return {
    totalParts: parts.length,
    combinedSize: parts.reduce((sum, part) => sum + part.documentSize, 0),
  };
}

/**
 * Count statement items (NotAction or Action array lengths) across all statements
 * in an IAM policy document.
 */
export function countStatementItems(document: Record<string, unknown>): number {
  const statements = document.Statement;
  if (!Array.isArray(statements)) return 0;

  let count = 0;
  for (const statement of statements) {
    if (Array.isArray(statement.NotAction)) {
      count += statement.NotAction.length;
    } else if (Array.isArray(statement.Action)) {
      count += statement.Action.length;
    }
  }
  return count;
}

/**
 * Group actions by service prefix for display.
 * Input: array of IAM action strings (e.g., "s3:GetObject")
 * Output: array of ServiceActionGroup sorted by servicePrefix
 */
export function groupActionsByService(actions: string[]): ServiceActionGroup[] {
  const groups = new Map<string, string[]>();
  for (const action of actions) {
    const [prefix, ...rest] = action.split(':');
    const servicePrefix = prefix;
    if (!groups.has(servicePrefix)) groups.set(servicePrefix, []);
    groups.get(servicePrefix)!.push(rest.join(':'));
  }
  return Array.from(groups.entries())
    .map(([servicePrefix, actions]) => ({ servicePrefix, actions }))
    .sort((a, b) => a.servicePrefix.localeCompare(b.servicePrefix));
}

/**
 * Compute the next refresh time from a last refresh timestamp and interval in hours.
 */
export function computeNextRefresh(lastRefreshTime: string, refreshIntervalHours: number): string {
  const last = new Date(lastRefreshTime);
  const next = new Date(last.getTime() + refreshIntervalHours * 60 * 60 * 1000);
  return next.toISOString();
}

/**
 * Generate a CDK TypeScript snippet that attaches multiple managed policy ARNs to a role.
 */
export function generateMultiPolicyCdkSnippet(arns: string[], policyName: string): string {
  const imports = `import * as iam from 'aws-cdk-lib/aws-iam';`;
  const arnLines = arns
    .map(arn => `  role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, '${policyName}-${arns.indexOf(arn)}', '${arn}'));`)
    .join('\n');

  return `${imports}\n\n// Attach all policy parts to the role for complete coverage\n${arnLines}\n`;
}

/**
 * Generate a CloudFormation YAML snippet that includes all ARNs in ManagedPolicyArns.
 */
export function generateMultiPolicyCfnSnippet(arns: string[]): string {
  const arnLines = arns.map(arn => `        - ${arn}`).join('\n');

  return `Resources:
  MyRole:
    Type: AWS::IAM::Role
    Properties:
      ManagedPolicyArns:
${arnLines}
`;
}

/**
 * Collect all ARNs (primary + additional) from a PolicyConfiguration without duplicates.
 */
export function buildDeleteConfirmationArns(policy: PolicyConfiguration): string[] {
  const arns: string[] = [];
  if (policy.policyArn) arns.push(policy.policyArn);
  if (policy.additionalPolicyArns) arns.push(...policy.additionalPolicyArns);
  return [...new Set(arns)];
}

/**
 * Derive policy parts from a PolicyConfiguration.
 * Part 0 = policyArn (blanket-deny), Part 1+ = additionalPolicyArns (specific-api-deny).
 */
export function derivePolicyParts(
  policy: PolicyConfiguration,
  documentSizes?: number[],
): PolicyPart[] {
  const arns = buildDeleteConfirmationArns(policy);
  return arns.map((arn, index) => ({
    partIndex: index,
    arn,
    partType: index === 0 ? 'blanket-deny' as const : 'specific-api-deny' as const,
    documentSize: documentSizes?.[index] ?? 0,
    statementItemCount: 0,
  }));
}

/**
 * Build a partial failure report from a cascading delete operation.
 * Returns a CascadingDeleteResponse indicating which ARNs succeeded and which failed.
 */
export function buildPartialFailureReport(
  allArns: string[],
  results: { arn: string; success: boolean; error?: string }[],
): CascadingDeleteResponse {
  const deletedArns: string[] = [];
  const failedArns: { arn: string; error: string }[] = [];

  for (const result of results) {
    if (result.success) {
      deletedArns.push(result.arn);
    } else {
      failedArns.push({ arn: result.arn, error: result.error ?? 'Unknown error' });
    }
  }

  return {
    success: failedArns.length === 0,
    deletedArns,
    failedArns,
  };
}
