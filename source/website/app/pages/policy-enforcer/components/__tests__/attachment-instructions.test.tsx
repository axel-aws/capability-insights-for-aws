import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AttachmentInstructions from '../attachment-instructions';
import type { PolicyPart } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

describe('AttachmentInstructions', () => {
  const singlePart: PolicyPart[] = [
    {
      partIndex: 0,
      arn: 'arn:aws:iam::123456789012:policy/my-policy-0',
      partType: 'blanket-deny',
      documentSize: 2048,
      statementItemCount: 5,
    },
  ];

  const multipleParts: PolicyPart[] = [
    {
      partIndex: 0,
      arn: 'arn:aws:iam::123456789012:policy/my-policy-0',
      partType: 'blanket-deny',
      documentSize: 2048,
      statementItemCount: 5,
    },
    {
      partIndex: 1,
      arn: 'arn:aws:iam::123456789012:policy/my-policy-1',
      partType: 'specific-api-deny',
      documentSize: 4096,
      statementItemCount: 20,
    },
    {
      partIndex: 2,
      arn: 'arn:aws:iam::123456789012:policy/my-policy-2',
      partType: 'specific-api-deny',
      documentSize: 3000,
      statementItemCount: 15,
    },
  ];

  describe('multi-part warning', () => {
    it('shows warning alert when there are multiple parts', () => {
      const { container } = render(
        <AttachmentInstructions
          parts={multipleParts}
          policyType="IAM"
          policyName="test-policy"
        />,
      );

      expect(container.textContent).toContain('Multiple policy parts must be attached');
      expect(container.textContent).toContain('split into 3 managed policies');
    });

    it('omits multi-part warning when there is only one part', () => {
      const { container } = render(
        <AttachmentInstructions
          parts={singlePart}
          policyType="IAM"
          policyName="test-policy"
        />,
      );

      expect(container.textContent).not.toContain('Multiple policy parts must be attached');
    });
  });

  describe('IAM type instructions', () => {
    it('shows CDK snippet section for IAM type', () => {
      const { container } = render(
        <AttachmentInstructions
          parts={singlePart}
          policyType="IAM"
          policyName="test-policy"
        />,
      );

      expect(container.textContent).toContain('CDK snippet');
    });

    it('shows CloudFormation snippet section for IAM type', () => {
      const { container } = render(
        <AttachmentInstructions
          parts={singlePart}
          policyType="IAM"
          policyName="test-policy"
        />,
      );

      expect(container.textContent).toContain('CloudFormation snippet');
    });

    it('does not show SCP instructions for IAM type', () => {
      const { container } = render(
        <AttachmentInstructions
          parts={singlePart}
          policyType="IAM"
          policyName="test-policy"
        />,
      );

      expect(container.textContent).not.toContain('Attaching to an Organizational Unit');
    });
  });

  describe('SCP type instructions', () => {
    it('shows SCP-specific instructions for SCP type', () => {
      const { container } = render(
        <AttachmentInstructions
          parts={singlePart}
          policyType="SCP"
          policyName="test-policy"
        />,
      );

      expect(container.textContent).toContain('Attaching to an Organizational Unit');
      expect(container.textContent).toContain('SCP Attachment');
    });

    it('does not show CDK or CloudFormation snippets for SCP type', () => {
      const { container } = render(
        <AttachmentInstructions
          parts={singlePart}
          policyType="SCP"
          policyName="test-policy"
        />,
      );

      expect(container.textContent).not.toContain('CDK snippet');
      expect(container.textContent).not.toContain('CloudFormation snippet');
    });
  });

  describe('empty parts', () => {
    it('shows info message when no parts are available', () => {
      const { container } = render(
        <AttachmentInstructions
          parts={[]}
          policyType="IAM"
          policyName="test-policy"
        />,
      );

      expect(container.textContent).toContain('No policy parts are available yet');
    });
  });
});
