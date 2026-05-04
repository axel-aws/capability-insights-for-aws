import {
  CloudFormationClient,
  ListStacksCommand,
  ListStackResourcesCommand,
  GetTemplateCommand,
  type StackStatus,
} from '@aws-sdk/client-cloudformation';

const client = new CloudFormationClient({});

export const ACTIVE_STACK_STATUSES: StackStatus[] = [
  'CREATE_COMPLETE',
  'UPDATE_COMPLETE',
  'UPDATE_ROLLBACK_COMPLETE',
  'IMPORT_COMPLETE',
];

export class CloudFormationServiceClient {
  async listActiveStacks(): Promise<string[]> {
    const stackNames: string[] = [];
    let nextToken: string | undefined;

    try {
      do {
        const response = await client.send(
          new ListStacksCommand({
            StackStatusFilter: ACTIVE_STACK_STATUSES,
            NextToken: nextToken,
          }),
        );

        for (const summary of response.StackSummaries ?? []) {
          if (summary.StackName) {
            stackNames.push(summary.StackName);
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);
    } catch (e) {
      throw new Error(`Failed to list active stacks: ${e}`);
    }

    return stackNames;
  }

  async listStackResourceTypes(stackName: string): Promise<string[]> {
    const resourceTypes: string[] = [];
    let nextToken: string | undefined;

    try {
      do {
        const response = await client.send(
          new ListStackResourcesCommand({
            StackName: stackName,
            NextToken: nextToken,
          }),
        );

        for (const resource of response.StackResourceSummaries ?? []) {
          if (resource.ResourceType) {
            resourceTypes.push(resource.ResourceType);
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);
    } catch (e) {
      throw new Error(`Failed to list stack resources for '${stackName}': ${e}`);
    }

    return resourceTypes;
  }

  async getTemplate(stackName: string): Promise<string> {
    try {
      const response = await client.send(
        new GetTemplateCommand({
          StackName: stackName,
        }),
      );

      return response.TemplateBody ?? '';
    } catch (e) {
      throw new Error(`Failed to get template for '${stackName}': ${e}`);
    }
  }
}
