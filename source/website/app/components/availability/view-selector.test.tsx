import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import ViewSelector from './view-selector';
import type { NamingConvention } from '@capability-insights/shared/types/terraform-overlay';

/**
 * Helper to get the toolbar element that contains the segmented control buttons.
 * Cloudscape SegmentedControl renders multiple copies for responsive design,
 * so we scope queries to the first toolbar.
 */
function getToolbar() {
  return screen.getAllByRole('toolbar')[0];
}

describe('ViewSelector', () => {
  const defaultProps = {
    selectedConvention: 'cloudformation' as NamingConvention,
    onChange: vi.fn(),
  };

  describe('rendering', () => {
    it('renders with CloudFormation selected by default', () => {
      render(<ViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      const cloudformationButton = within(toolbar).getByTestId('cloudformation');
      expect(cloudformationButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('renders both convention options: CloudFormation and Terraform AWSCC', () => {
      render(<ViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      expect(within(toolbar).getByText('CloudFormation')).toBeInTheDocument();
      expect(within(toolbar).getByText('Terraform AWSCC')).toBeInTheDocument();
    });

    it('marks non-selected option as not pressed', () => {
      render(<ViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      expect(within(toolbar).getByTestId('terraform-awscc')).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('disabled state during loading', () => {
    it('does not fire onChange when loading is true', () => {
      const onChange = vi.fn();
      render(<ViewSelector {...defaultProps} onChange={onChange} loading={true} />);

      const toolbar = getToolbar();
      const awsccButton = within(toolbar).getByTestId('terraform-awscc');
      fireEvent.click(awsccButton);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('shows a loading indicator (spinner) when loading is true', () => {
      const { container } = render(<ViewSelector {...defaultProps} loading={true} />);

      const children = container.querySelectorAll('[class*="child_18582"]');
      expect(children.length).toBe(2);
    });

    it('does not show a spinner when loading is false', () => {
      const { container } = render(<ViewSelector {...defaultProps} loading={false} />);

      const children = container.querySelectorAll('[class*="child_18582"]');
      expect(children.length).toBe(1);
    });
  });

  describe('disabled state on error', () => {
    it('does not fire onChange when disabled prop is true', () => {
      const onChange = vi.fn();
      render(<ViewSelector {...defaultProps} onChange={onChange} disabled={true} />);

      const toolbar = getToolbar();
      const awsccButton = within(toolbar).getByTestId('terraform-awscc');
      fireEvent.click(awsccButton);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not show spinner when only disabled (not loading)', () => {
      const { container } = render(<ViewSelector {...defaultProps} disabled={true} />);

      const children = container.querySelectorAll('[class*="child_18582"]');
      expect(children.length).toBe(1);
    });
  });

  describe('onChange callback', () => {
    it('does not fire onChange on initial render', () => {
      const onChange = vi.fn();
      render(<ViewSelector {...defaultProps} onChange={onChange} />);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not fire onChange when clicking the already-selected option', () => {
      const onChange = vi.fn();
      render(<ViewSelector {...defaultProps} onChange={onChange} />);

      const toolbar = getToolbar();
      const cloudformationButton = within(toolbar).getByTestId('cloudformation');
      fireEvent.click(cloudformationButton);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('options have correct text labels', () => {
      render(<ViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      expect(within(toolbar).getByTestId('cloudformation')).toHaveTextContent('CloudFormation');
      expect(within(toolbar).getByTestId('terraform-awscc')).toHaveTextContent('Terraform AWSCC');
    });
  });
});
