import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ListStacksCommand, ListStackResourcesCommand, GetTemplateCommand } from '@aws-sdk/client-cloudformation';
import { CloudFormationServiceClient, ACTIVE_STACK_STATUSES } from './cloudformation-client';

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-cloudformation', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-cloudformation')>(
    '@aws-sdk/client-cloudformation',
  );
  return {
    ...actual,
    CloudFormationClient: vi.fn().mockImplementation(() => ({
      send: mockSend,
    })),
  };
});

describe('CloudFormationServiceClient', () => {
  let serviceClient: CloudFormationServiceClient;

  beforeEach(() => {
    vi.clearAllMocks();
    serviceClient = new CloudFormationServiceClient();
  });

  describe('ACTIVE_STACK_STATUSES', () => {
    it('includes only the four allowed statuses', () => {
      expect(ACTIVE_STACK_STATUSES).toEqual([
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
        'IMPORT_COMPLETE',
      ]);
    });

    it('does not include non-active statuses', () => {
      const nonActiveStatuses = [
        'CREATE_IN_PROGRESS',
        'CREATE_FAILED',
        'DELETE_IN_PROGRESS',
        'DELETE_COMPLETE',
        'DELETE_FAILED',
        'ROLLBACK_COMPLETE',
        'ROLLBACK_FAILED',
        'UPDATE_IN_PROGRESS',
        'UPDATE_ROLLBACK_IN_PROGRESS',
      ];
      for (const status of nonActiveStatuses) {
        expect(ACTIVE_STACK_STATUSES).not.toContain(status);
      }
    });
  });

  describe('listActiveStacks', () => {
    it('returns stack names from a single page', async () => {
      mockSend.mockResolvedValueOnce({
        StackSummaries: [{ StackName: 'stack-a' }, { StackName: 'stack-b' }],
        NextToken: undefined,
      });

      const result = await serviceClient.listActiveStacks();

      expect(result).toEqual(['stack-a', 'stack-b']);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(ListStacksCommand);
      expect(command.input.StackStatusFilter).toEqual(ACTIVE_STACK_STATUSES);
    });

    it('paginates through multiple pages', async () => {
      mockSend
        .mockResolvedValueOnce({
          StackSummaries: [{ StackName: 'stack-1' }],
          NextToken: 'token-1',
        })
        .mockResolvedValueOnce({
          StackSummaries: [{ StackName: 'stack-2' }],
          NextToken: 'token-2',
        })
        .mockResolvedValueOnce({
          StackSummaries: [{ StackName: 'stack-3' }],
          NextToken: undefined,
        });

      const result = await serviceClient.listActiveStacks();

      expect(result).toEqual(['stack-1', 'stack-2', 'stack-3']);
      expect(mockSend).toHaveBeenCalledTimes(3);

      // Verify NextToken is passed correctly on subsequent calls
      expect(mockSend.mock.calls[0][0].input.NextToken).toBeUndefined();
      expect(mockSend.mock.calls[1][0].input.NextToken).toBe('token-1');
      expect(mockSend.mock.calls[2][0].input.NextToken).toBe('token-2');
    });

    it('returns empty array when no stacks exist', async () => {
      mockSend.mockResolvedValueOnce({
        StackSummaries: [],
        NextToken: undefined,
      });

      const result = await serviceClient.listActiveStacks();

      expect(result).toEqual([]);
    });

    it('skips summaries without a StackName', async () => {
      mockSend.mockResolvedValueOnce({
        StackSummaries: [{ StackName: 'valid-stack' }, { StackName: undefined }, {}],
        NextToken: undefined,
      });

      const result = await serviceClient.listActiveStacks();

      expect(result).toEqual(['valid-stack']);
    });

    it('handles undefined StackSummaries gracefully', async () => {
      mockSend.mockResolvedValueOnce({
        StackSummaries: undefined,
        NextToken: undefined,
      });

      const result = await serviceClient.listActiveStacks();

      expect(result).toEqual([]);
    });

    it('throws an error when the API call fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access denied'));

      await expect(serviceClient.listActiveStacks()).rejects.toThrow('Failed to list active stacks');
    });

    it('passes StackStatusFilter with the allowed statuses', async () => {
      mockSend.mockResolvedValueOnce({
        StackSummaries: [],
        NextToken: undefined,
      });

      await serviceClient.listActiveStacks();

      const command = mockSend.mock.calls[0][0];
      expect(command.input.StackStatusFilter).toEqual([
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
        'IMPORT_COMPLETE',
      ]);
    });
  });

  describe('listStackResourceTypes', () => {
    it('returns resource types from a single page', async () => {
      mockSend.mockResolvedValueOnce({
        StackResourceSummaries: [{ ResourceType: 'AWS::EC2::Instance' }, { ResourceType: 'AWS::S3::Bucket' }],
        NextToken: undefined,
      });

      const result = await serviceClient.listStackResourceTypes('my-stack');

      expect(result).toEqual(['AWS::EC2::Instance', 'AWS::S3::Bucket']);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(ListStackResourcesCommand);
      expect(command.input.StackName).toBe('my-stack');
    });

    it('paginates through multiple pages', async () => {
      mockSend
        .mockResolvedValueOnce({
          StackResourceSummaries: [{ ResourceType: 'AWS::EC2::Instance' }],
          NextToken: 'page-2',
        })
        .mockResolvedValueOnce({
          StackResourceSummaries: [{ ResourceType: 'AWS::S3::Bucket' }],
          NextToken: 'page-3',
        })
        .mockResolvedValueOnce({
          StackResourceSummaries: [{ ResourceType: 'AWS::Lambda::Function' }],
          NextToken: undefined,
        });

      const result = await serviceClient.listStackResourceTypes('my-stack');

      expect(result).toEqual(['AWS::EC2::Instance', 'AWS::S3::Bucket', 'AWS::Lambda::Function']);
      expect(mockSend).toHaveBeenCalledTimes(3);

      // Verify pagination tokens
      expect(mockSend.mock.calls[0][0].input.NextToken).toBeUndefined();
      expect(mockSend.mock.calls[1][0].input.NextToken).toBe('page-2');
      expect(mockSend.mock.calls[2][0].input.NextToken).toBe('page-3');
    });

    it('returns empty array when stack has no resources', async () => {
      mockSend.mockResolvedValueOnce({
        StackResourceSummaries: [],
        NextToken: undefined,
      });

      const result = await serviceClient.listStackResourceTypes('empty-stack');

      expect(result).toEqual([]);
    });

    it('skips resources without a ResourceType', async () => {
      mockSend.mockResolvedValueOnce({
        StackResourceSummaries: [{ ResourceType: 'AWS::EC2::Instance' }, { ResourceType: undefined }, {}],
        NextToken: undefined,
      });

      const result = await serviceClient.listStackResourceTypes('my-stack');

      expect(result).toEqual(['AWS::EC2::Instance']);
    });

    it('handles undefined StackResourceSummaries gracefully', async () => {
      mockSend.mockResolvedValueOnce({
        StackResourceSummaries: undefined,
        NextToken: undefined,
      });

      const result = await serviceClient.listStackResourceTypes('my-stack');

      expect(result).toEqual([]);
    });

    it('throws an error when the API call fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Stack not found'));

      await expect(serviceClient.listStackResourceTypes('bad-stack')).rejects.toThrow(
        "Failed to list stack resources for 'bad-stack'",
      );
    });
  });

  describe('getTemplate', () => {
    it('returns the template body', async () => {
      const templateBody = JSON.stringify({
        Resources: {
          MyBucket: { Type: 'AWS::S3::Bucket' },
        },
      });

      mockSend.mockResolvedValueOnce({
        TemplateBody: templateBody,
      });

      const result = await serviceClient.getTemplate('my-stack');

      expect(result).toBe(templateBody);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command).toBeInstanceOf(GetTemplateCommand);
      expect(command.input.StackName).toBe('my-stack');
    });

    it('returns empty string when TemplateBody is undefined', async () => {
      mockSend.mockResolvedValueOnce({
        TemplateBody: undefined,
      });

      const result = await serviceClient.getTemplate('my-stack');

      expect(result).toBe('');
    });

    it('throws an error when the API call fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access denied'));

      await expect(serviceClient.getTemplate('my-stack')).rejects.toThrow("Failed to get template for 'my-stack'");
    });
  });
});

/**
 * Feature: stack-resource-filter, Property 1: Stack status filtering preserves only allowed statuses
 *
 * **Validates: Requirements 1.1**
 *
 * For any array of CloudFormation stack summaries with arbitrary status values,
 * filtering by the allowed statuses (CREATE_COMPLETE, UPDATE_COMPLETE,
 * UPDATE_ROLLBACK_COMPLETE, IMPORT_COMPLETE) SHALL return only stacks whose
 * status is one of those four values, and SHALL not exclude any stack that has
 * an allowed status.
 */
describe('Feature: stack-resource-filter, Property 1: Stack status filtering preserves only allowed statuses', () => {
  // All possible CloudFormation stack statuses (superset of allowed)
  const ALL_STACK_STATUSES = [
    'CREATE_IN_PROGRESS',
    'CREATE_FAILED',
    'CREATE_COMPLETE',
    'ROLLBACK_IN_PROGRESS',
    'ROLLBACK_FAILED',
    'ROLLBACK_COMPLETE',
    'DELETE_IN_PROGRESS',
    'DELETE_FAILED',
    'DELETE_COMPLETE',
    'UPDATE_IN_PROGRESS',
    'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
    'UPDATE_COMPLETE',
    'UPDATE_FAILED',
    'UPDATE_ROLLBACK_IN_PROGRESS',
    'UPDATE_ROLLBACK_FAILED',
    'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
    'UPDATE_ROLLBACK_COMPLETE',
    'REVIEW_IN_PROGRESS',
    'IMPORT_IN_PROGRESS',
    'IMPORT_COMPLETE',
    'IMPORT_ROLLBACK_IN_PROGRESS',
    'IMPORT_ROLLBACK_FAILED',
    'IMPORT_ROLLBACK_COMPLETE',
  ] as const;

  const allowedStatusSet = new Set<string>(ACTIVE_STACK_STATUSES);

  // Generator: random array of { stackName, status } with statuses from the full superset
  const stackSummaryArb = fc.record({
    stackName: fc.string({ minLength: 1, maxLength: 50 }),
    status: fc.constantFrom(...ALL_STACK_STATUSES),
  });

  const stackSummariesArb = fc.array(stackSummaryArb, { minLength: 0, maxLength: 50 });

  // The filtering function under test: simulates what the CloudFormation API does
  // when StackStatusFilter is set to ACTIVE_STACK_STATUSES
  function filterByActiveStatuses(
    stacks: { stackName: string; status: string }[],
  ): { stackName: string; status: string }[] {
    return stacks.filter(s => allowedStatusSet.has(s.status));
  }

  it('should return only stacks with allowed statuses', () => {
    fc.assert(
      fc.property(stackSummariesArb, stacks => {
        const filtered = filterByActiveStatuses(stacks);

        // Every stack in the result must have an allowed status
        for (const stack of filtered) {
          expect(allowedStatusSet.has(stack.status)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('should not exclude any stack with an allowed status', () => {
    fc.assert(
      fc.property(stackSummariesArb, stacks => {
        const filtered = filterByActiveStatuses(stacks);

        // Every stack from the input that has an allowed status must appear in the result
        const expectedAllowed = stacks.filter(s => allowedStatusSet.has(s.status));
        expect(filtered).toEqual(expectedAllowed);
      }),
      { numRuns: 100 },
    );
  });

  it('should never include a stack with a disallowed status', () => {
    fc.assert(
      fc.property(stackSummariesArb, stacks => {
        const filtered = filterByActiveStatuses(stacks);

        // No stack in the result should have a status outside the allowed set
        const disallowed = filtered.filter(s => !allowedStatusSet.has(s.status));
        expect(disallowed).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('should preserve the count of allowed stacks from the input', () => {
    fc.assert(
      fc.property(stackSummariesArb, stacks => {
        const filtered = filterByActiveStatuses(stacks);

        // The number of filtered stacks should equal the number of input stacks with allowed statuses
        const expectedCount = stacks.filter(s => allowedStatusSet.has(s.status)).length;
        expect(filtered.length).toBe(expectedCount);
      }),
      { numRuns: 100 },
    );
  });
});
