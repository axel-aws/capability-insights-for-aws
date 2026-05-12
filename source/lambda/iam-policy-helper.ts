/**
 * IAM Policy Helper Lambda — runs OUTSIDE the VPC so it can reach the global IAM endpoint.
 * Invoked by the API Lambda (which is in a private subnet) to create/update/delete IAM policies.
 */
import {
  IAMClient,
  CreatePolicyCommand,
  CreatePolicyVersionCommand,
  ListPolicyVersionsCommand,
  DeletePolicyVersionCommand,
  DeletePolicyCommand,
} from '@aws-sdk/client-iam';

const iamClient = new IAMClient({});

export interface IAMHelperEvent {
  action: 'create' | 'update' | 'delete';
  policyName?: string;
  policyArn?: string;
  policyDocument?: string;
  description?: string;
}

export interface IAMHelperResult {
  success: boolean;
  policyArn?: string;
  error?: string;
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

      default:
        return { success: false, error: `Unknown action: ${event.action}` };
    }
  } catch (error: unknown) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
