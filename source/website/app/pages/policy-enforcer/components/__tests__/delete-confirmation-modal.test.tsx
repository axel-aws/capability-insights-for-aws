import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DeleteConfirmationModal, {
  buildDeleteConfirmationArns,
} from '../delete-confirmation-modal';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

function createPolicy(overrides: Partial<PolicyConfiguration> = {}): PolicyConfiguration {
  return {
    policyId: 'policy-1',
    policyName: 'my-test-policy',
    tags: [],
    regions: ['us-east-1'],
    mode: 'intersection',
    policyType: 'IAM',
    exceptions: [],
    refreshIntervalHours: 24,
    status: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DeleteConfirmationModal', () => {
  let onConfirm: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onConfirm = vi.fn();
    onCancel = vi.fn();
  });

  describe('ARN listing', () => {
    it('lists all ARNs (primary + additional) in the confirmation dialog', () => {
      const policy = createPolicy({
        policyArn: 'arn:aws:iam::123456789012:policy/my-test-policy-0',
        additionalPolicyArns: [
          'arn:aws:iam::123456789012:policy/my-test-policy-1',
          'arn:aws:iam::123456789012:policy/my-test-policy-2',
        ],
      });

      render(
        <DeleteConfirmationModal
          policy={policy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );

      expect(
        screen.getByText('arn:aws:iam::123456789012:policy/my-test-policy-0'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('arn:aws:iam::123456789012:policy/my-test-policy-1'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('arn:aws:iam::123456789012:policy/my-test-policy-2'),
      ).toBeInTheDocument();
      expect(screen.getByText('IAM policies to be deleted (3)')).toBeInTheDocument();
    });

    it('shows simplified message when no ARNs exist (never refreshed)', () => {
      const policy = createPolicy();
      // No policyArn or additionalPolicyArns set in base createPolicy

      const { container } = render(
        <DeleteConfirmationModal
          policy={policy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );

      expect(
        screen.getByText(/has not been refreshed yet/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Only the DynamoDB configuration record will be deleted/),
      ).toBeInTheDocument();
      // The ARN list section should not be present
      expect(container.textContent).not.toContain('IAM policies to be deleted');
    });
  });

  describe('confirmation input', () => {
    it('renders with Delete button disabled initially (requires typing policy name)', () => {
      const policy = createPolicy({
        policyArn: 'arn:aws:iam::123456789012:policy/test-0',
      });

      render(
        <DeleteConfirmationModal
          policy={policy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );

      // Find all buttons with "Delete" text - they should all be disabled initially
      const allButtons = screen.getAllByRole('button');
      const deleteButtons = allButtons.filter((btn) => btn.textContent?.trim() === 'Delete');
      expect(deleteButtons.length).toBeGreaterThan(0);

      // All Delete buttons should be disabled (user hasn't typed the policy name yet)
      const allDisabled = deleteButtons.every((btn) => btn.hasAttribute('disabled'));
      expect(allDisabled).toBe(true);
    });

    it('displays the policy name that must be typed for confirmation', () => {
      const policy = createPolicy({
        policyName: 'production-deny-policy',
        policyArn: 'arn:aws:iam::123456789012:policy/test-0',
      });

      render(
        <DeleteConfirmationModal
          policy={policy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );

      // The modal should display the policy name that needs to be typed
      expect(screen.getByText('production-deny-policy')).toBeInTheDocument();
    });

    it('does not call onConfirm when Delete button is disabled', () => {
      const policy = createPolicy({
        policyArn: 'arn:aws:iam::123456789012:policy/test-0',
      });

      render(
        <DeleteConfirmationModal
          policy={policy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      );

      // Try to click the disabled Delete button
      const allButtons = screen.getAllByRole('button');
      const deleteButton = allButtons.find(
        (btn) => btn.textContent?.trim() === 'Delete' && btn.hasAttribute('disabled'),
      );
      expect(deleteButton).toBeDefined();

      // Clicking a disabled button should not trigger onConfirm
      deleteButton!.click();
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe('buildDeleteConfirmationArns utility', () => {
    it('returns primary + additional ARNs', () => {
      const policy = createPolicy({
        policyArn: 'arn:aws:iam::123456789012:policy/my-test-policy-0',
        additionalPolicyArns: [
          'arn:aws:iam::123456789012:policy/my-test-policy-1',
          'arn:aws:iam::123456789012:policy/my-test-policy-2',
        ],
      });
      const arns = buildDeleteConfirmationArns(policy);

      expect(arns).toEqual([
        'arn:aws:iam::123456789012:policy/my-test-policy-0',
        'arn:aws:iam::123456789012:policy/my-test-policy-1',
        'arn:aws:iam::123456789012:policy/my-test-policy-2',
      ]);
    });

    it('returns empty array when no ARNs exist', () => {
      const policy = createPolicy();
      const arns = buildDeleteConfirmationArns(policy);

      expect(arns).toEqual([]);
    });

    it('returns only primary ARN when no additional ARNs exist', () => {
      const policy = createPolicy({
        policyArn: 'arn:aws:iam::123456789012:policy/my-test-policy-0',
      });
      const arns = buildDeleteConfirmationArns(policy);

      expect(arns).toEqual(['arn:aws:iam::123456789012:policy/my-test-policy-0']);
    });
  });
});
