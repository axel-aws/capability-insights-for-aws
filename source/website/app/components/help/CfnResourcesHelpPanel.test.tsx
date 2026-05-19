import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CfnResourcesHelpPanel from './CfnResourcesHelpPanel';

describe('CfnResourcesHelpPanel', () => {
  it('renders without errors', () => {
    render(<CfnResourcesHelpPanel />);
    expect(screen.getByText('CloudFormation & AWSCC Resources')).toBeInTheDocument();
  });

  it('explains AWSCC naming convention (AWSCC + naming or convention)', () => {
    const { container } = render(<CfnResourcesHelpPanel />);
    const text = container.textContent ?? '';
    expect(/awscc/i.test(text)).toBe(true);
    const mentionsNaming = /naming/i.test(text) || /convention/i.test(text);
    expect(mentionsNaming).toBe(true);
  });

  it('explains classic AWS mapping (classic or overlay)', () => {
    const { container } = render(<CfnResourcesHelpPanel />);
    const text = container.textContent ?? '';
    const mentionsClassic = /classic/i.test(text) || /overlay/i.test(text);
    expect(mentionsClassic).toBe(true);
  });

  it('explains availability determination (availability + authoritative or CloudFormation)', () => {
    const { container } = render(<CfnResourcesHelpPanel />);
    const text = container.textContent ?? '';
    expect(/availab/i.test(text)).toBe(true);
    const mentionsSource = /authoritative/i.test(text) || /cloudformation/i.test(text);
    expect(mentionsSource).toBe(true);
  });

  it('has content under 300 words', () => {
    const { container } = render(<CfnResourcesHelpPanel />);
    const text = container.textContent ?? '';
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(300);
  });
});
