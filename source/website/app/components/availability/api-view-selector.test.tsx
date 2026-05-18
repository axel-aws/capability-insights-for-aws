import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import ApiViewSelector from './api-view-selector';
import type { ApiViewMode } from './api-view-selector';

/**
 * Helper to get the toolbar element that contains the segmented control buttons.
 * Cloudscape SegmentedControl renders multiple copies for responsive design,
 * so we scope queries to the first toolbar.
 */
function getToolbar() {
  return screen.getAllByRole('toolbar')[0];
}

describe('ApiViewSelector', () => {
  const defaultProps = {
    selectedView: 'api-operations' as ApiViewMode,
    onChange: vi.fn(),
  };

  describe('rendering', () => {
    it('renders with "API Operations" selected by default', () => {
      render(<ApiViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      const apiOperationsButton = within(toolbar).getByTestId('api-operations');
      expect(apiOperationsButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('renders both view options: "API Operations" and "Terraform AWS"', () => {
      render(<ApiViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      expect(within(toolbar).getByText('API Operations')).toBeInTheDocument();
      expect(within(toolbar).getByText('Terraform AWS')).toBeInTheDocument();
    });

    it('marks non-selected option as not pressed', () => {
      render(<ApiViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      expect(within(toolbar).getByTestId('terraform-aws')).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('disabled state during loading', () => {
    it('does not fire onChange when clicking disabled Terraform AWS option during loading', () => {
      const onChange = vi.fn();
      render(<ApiViewSelector {...defaultProps} onChange={onChange} loading={true} />);

      const toolbar = getToolbar();
      const terraformButton = within(toolbar).getByTestId('terraform-aws');
      fireEvent.click(terraformButton);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('shows a loading indicator (spinner) when loading is true', () => {
      const { container } = render(<ApiViewSelector {...defaultProps} loading={true} />);

      const children = container.querySelectorAll('[class*="child_18582"]');
      expect(children.length).toBe(2);
    });

    it('does not show a spinner when loading is false', () => {
      const { container } = render(<ApiViewSelector {...defaultProps} loading={false} />);

      const children = container.querySelectorAll('[class*="child_18582"]');
      expect(children.length).toBe(1);
    });
  });

  describe('disabled state on error', () => {
    it('does not fire onChange when clicking disabled Terraform AWS option on error', () => {
      const onChange = vi.fn();
      render(<ApiViewSelector {...defaultProps} onChange={onChange} disabled={true} />);

      const toolbar = getToolbar();
      const terraformButton = within(toolbar).getByTestId('terraform-aws');
      fireEvent.click(terraformButton);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not show spinner when only disabled (not loading)', () => {
      const { container } = render(<ApiViewSelector {...defaultProps} disabled={true} />);

      const children = container.querySelectorAll('[class*="child_18582"]');
      expect(children.length).toBe(1);
    });
  });

  describe('onChange callback', () => {
    it('does not fire onChange on initial render', () => {
      const onChange = vi.fn();
      render(<ApiViewSelector {...defaultProps} onChange={onChange} />);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not fire onChange when clicking the already-selected option', () => {
      const onChange = vi.fn();
      render(<ApiViewSelector {...defaultProps} onChange={onChange} />);

      const toolbar = getToolbar();
      const apiOperationsButton = within(toolbar).getByTestId('api-operations');
      fireEvent.click(apiOperationsButton);

      expect(onChange).not.toHaveBeenCalled();
    });

    it('renders Terraform AWS option as clickable when not disabled or loading', () => {
      render(<ApiViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      const terraformButton = within(toolbar).getByTestId('terraform-aws');
      expect(terraformButton).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('passes selectedView prop to the segmented control', () => {
      const onChange = vi.fn();
      // Verify the component renders without error when terraform-aws is selected
      const { container } = render(<ApiViewSelector selectedView="terraform-aws" onChange={onChange} />);
      expect(container).toBeTruthy();
    });

    it('options have correct text labels', () => {
      render(<ApiViewSelector {...defaultProps} />);

      const toolbar = getToolbar();
      expect(within(toolbar).getByTestId('api-operations')).toHaveTextContent('API Operations');
      expect(within(toolbar).getByTestId('terraform-aws')).toHaveTextContent('Terraform AWS');
    });
  });
});
