import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TerraformAwsHelpPanel from './TerraformAwsHelpPanel';

describe('TerraformAwsHelpPanel', () => {
  it('renders without errors', () => {
    render(<TerraformAwsHelpPanel />);
    expect(screen.getByText('Terraform AWS availability')).toBeInTheDocument();
  });

  it('mentions the source of mappings (Terraform AWS provider / HashiCorp)', () => {
    const { container } = render(<TerraformAwsHelpPanel />);
    const text = container.textContent ?? '';
    const mentionsProvider = /terraform aws provider/i.test(text) || /hashicorp/i.test(text);
    expect(mentionsProvider).toBe(true);
  });

  it('explains AND-logic for availability (Available + all)', () => {
    const { container } = render(<TerraformAwsHelpPanel />);
    const text = container.textContent ?? '';
    expect(/available/i.test(text)).toBe(true);
    expect(/\ball\b/i.test(text)).toBe(true);
  });

  it('explains service attribution (service + attribution or cross-referencing)', () => {
    const { container } = render(<TerraformAwsHelpPanel />);
    const text = container.textContent ?? '';
    expect(/service/i.test(text)).toBe(true);
    const mentionsAttribution = /attribution/i.test(text) || /cross-referencing/i.test(text);
    expect(mentionsAttribution).toBe(true);
  });

  it('explains data freshness (24 hours or refresh)', () => {
    const { container } = render(<TerraformAwsHelpPanel />);
    const text = container.textContent ?? '';
    const mentionsFreshness = /24 hours/i.test(text) || /refresh/i.test(text);
    expect(mentionsFreshness).toBe(true);
  });

  it('explains tree hierarchy (Resource + SDK Service + API Operation)', () => {
    const { container } = render(<TerraformAwsHelpPanel />);
    const text = container.textContent ?? '';
    expect(/resource/i.test(text)).toBe(true);
    expect(/sdk service/i.test(text)).toBe(true);
    expect(/api operation/i.test(text)).toBe(true);
  });

  it('has content under 300 words', () => {
    const { container } = render(<TerraformAwsHelpPanel />);
    const text = container.textContent ?? '';
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(300);
  });
});
