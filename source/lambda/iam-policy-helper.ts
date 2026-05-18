/**
 * IAM Policy Helper Lambda — runs OUTSIDE the VPC so it can reach the global IAM endpoint.
 * Invoked by the API Lambda (which is in a private subnet) to create/update/delete IAM policies.
 */
import {
  IAMClient,
  CreatePolicyCommand,
  CreatePolicyVersionCommand,
  GetPolicyVersionCommand,
  ListPolicyVersionsCommand,
  DeletePolicyVersionCommand,
  DeletePolicyCommand,
} from '@aws-sdk/client-iam';

const iamClient = new IAMClient({});

export interface IAMHelperEvent {
  action: 'create' | 'update' | 'delete' | 'getPolicyDocument' | 'listVersions';
  policyName?: string;
  policyArn?: string;
  policyDocument?: string;
  description?: string;
  versionId?: string;
}

export interface IAMHelperResult {
  success: boolean;
  policyArn?: string;
  policyDocument?: string;
  versions?: PolicyVersionSummary[];
  error?: string;
}

export interface PolicyVersionSummary {
  versionId: string;
  isDefaultVersion: boolean;
  createDate: string;
}

export const handler = async (event: IAMHelperEvent): Promise<IAMHelperResult> => {
  try {
    switch (event.action) {
      case 'create': {
        const result = await iamClient.send(new CreatePolicyCommand({
          PolicyName: event.policyName,
          PolicyDocument: event.policyDocument,
          Description: event.description,
        }));
        return { success: true, policyArn: result.Policy?.Arn };
      }

      case 'update': {
        if (!event.policyArn) return { success: false, error: 'policyArn required for update' };

        // IAM allows max 5 versions — delete oldest non-default if at limit
        const versions = await iamClient.send(new ListPolicyVersionsCommand({ PolicyArn: event.policyArn }));
        const nonDefaultVersions = (versions.Versions ?? [])
          .filter(v => !v.IsDefaultVersion)
          .sort((a, b) => (a.CreateDate?.getTime() ?? 0) - (b.CreateDate?.getTime() ?? 0));

        if ((versions.Versions?.length ?? 0) >= 5 && nonDefaultVersions.length > 0) {
          await iamClient.send(new DeletePolicyVersionCommand({
            PolicyArn: event.policyArn,
            VersionId: nonDefaultVersions[0].VersionId,
          }));
        }

        await iamClient.send(new CreatePolicyVersionCommand({
          PolicyArn: event.policyArn,
          PolicyDocument: event.policyDocument,
          SetAsDefault: true,
        }));
        return { success: true, policyArn: event.policyArn };
      }

      case 'delete': {
        if (!event.policyArn) return { success: false, error: 'policyArn required for delete' };

        // Delete all non-default versions first
        const versions = await iamClient.send(new ListPolicyVersionsCommand({ PolicyArn: event.policyArn }));
        for (const v of (versions.Versions ?? []).filter(v => !v.IsDefaultVersion)) {
          await iamClient.send(new DeletePolicyVersionCommand({
            PolicyArn: event.policyArn,
            VersionId: v.VersionId,
          }));
        }
        await iamClient.send(new DeletePolicyCommand({ PolicyArn: event.policyArn }));
        return { success: true };
      }

      case 'getPolicyDocument': {
        if (!event.policyArn) return { success: false, error: 'policyArn required for getPolicyDocument' };

        let versionId = event.versionId;

        // If no versionId specified, find the default version
        if (!versionId) {
          const versionsResponse = await iamClient.send(new ListPolicyVersionsCommand({ PolicyArn: event.policyArn }));
          const defaultVersion = (versionsResponse.Versions ?? []).find(v => v.IsDefaultVersion);
          if (!defaultVersion?.VersionId) {
            return { success: false, error: 'Could not determine default policy version' };
          }
          versionId = defaultVersion.VersionId;
        }

        const policyVersionResponse = await iamClient.send(new GetPolicyVersionCommand({
          PolicyArn: event.policyArn,
          VersionId: versionId,
        }));

        const document = policyVersionResponse.PolicyVersion?.Document;
        if (!document) {
          return { success: false, error: 'Policy document not found' };
        }

        return { success: true, policyDocument: decodeURIComponent(document) };
      }

      case 'listVersions': {
        if (!event.policyArn) return { success: false, error: 'policyArn required for listVersions' };

        const versionsResponse = await iamClient.send(new ListPolicyVersionsCommand({ PolicyArn: event.policyArn }));
        const versionSummaries: PolicyVersionSummary[] = (versionsResponse.Versions ?? []).map(v => ({
          versionId: v.VersionId ?? '',
          isDefaultVersion: v.IsDefaultVersion ?? false,
          createDate: v.CreateDate?.toISOString() ?? '',
        }));

        return { success: true, versions: versionSummaries };
      }

      default:
        return { success: false, error: `Unknown action: ${(event as IAMHelperEvent).action}` };
    }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
