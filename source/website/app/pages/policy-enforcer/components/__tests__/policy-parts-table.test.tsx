import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import PolicyPartsTable from '../policy-parts-table';
import type {
  PolicyPartsResponse,
  PolicyPartDetailResponse,
} from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

vi.mock('~/clients/policy-enforcer-client', () => ({
  policyEnforcerClient: {
    getPolicyParts: vi.fn(),
    getPolicyPartDetail: vi.fn(),
    deletePolicyPart: vi.fn(),
    refreshPolicy: vi.fn(),
  },
}));

import { policyEnforcerClient } from '~/clients/policy-enforcer-client';

const mockGetPolicyParts = vi.mocked(policyEnforcerClient.getPolicyParts);
const mockGetPolicyPartDetail = vi.mocked(policyEnforcerClient.getPolicyPartDetail);

describe('PolicyPartsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state while fetching parts', () => {
    mockGetPolicyParts.mockReturnValue(new Promise(() => {})); // never resolves
    render(<PolicyPartsTable policyId="policy-1" />);

    expect(screen.getByText('Loading policy parts...')).toBeInTheDocument();
  });

  it('renders empty state message when no parts exist (no refresh performed)', async () => {
    const emptyResponse: PolicyPartsResponse = {
      parts: [],
      totalParts: 0,
      combinedSize: 0,
    };
    mockGetPolicyParts.mockResolvedValue(emptyResponse);

    render(<PolicyPartsTable policyId="policy-1" />);

    await waitFor(() => {
      expect(screen.getByText('No policy parts available')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Policy parts will be available after the first refresh/),
    ).toBeInTheDocument();
  });

  it('renders a single policy part correctly', async () => {
    const response: PolicyPartsResponse = {
      parts: [
        {
          partIndex: 0,
          arn: 'arn:aws:iam::123456789012:policy/test-policy-0',
          partType: 'blanket-deny',
          documentSize: 2048,
          statementItemCount: 5,
        },
      ],
      totalParts: 1,
      combinedSize: 2048,
    };
    mockGetPolicyParts.mockResolvedValue(response);

    render(<PolicyPartsTable policyId="policy-1" />);

    await waitFor(() => {
      expect(screen.getByText('Policy Parts')).toBeInTheDocument();
    });
    expect(screen.getByText('arn:aws:iam::123456789012:policy/test-policy-0')).toBeInTheDocument();
    expect(screen.getByText('Blanket Deny')).toBeInTheDocument();
    expect(screen.getByText('2,048 chars')).toBeInTheDocument();
  });

  it('renders multiple policy parts with summary', async () => {
    const response: PolicyPartsResponse = {
      parts: [
        {
          partIndex: 0,
          arn: 'arn:aws:iam::123456789012:policy/test-0',
          partType: 'blanket-deny',
          documentSize: 2048,
          statementItemCount: 5,
        },
        {
          partIndex: 1,
          arn: 'arn:aws:iam::123456789012:policy/test-1',
          partType: 'specific-api-deny',
          documentSize: 4096,
          statementItemCount: 20,
        },
      ],
      totalParts: 2,
      combinedSize: 6144,
    };
    mockGetPolicyParts.mockResolvedValue(response);

    const { container } = render(<PolicyPartsTable policyId="policy-1" />);

    await waitFor(() => {
      expect(screen.getByText('(2)')).toBeInTheDocument();
    });
    // Use container.textContent to avoid Cloudscape duplicate element issues
    expect(container.textContent).toContain('Blanket Deny');
    expect(container.textContent).toContain('Specific API Deny');
    expect(screen.getByText('arn:aws:iam::123456789012:policy/test-0')).toBeInTheDocument();
    expect(screen.getByText('arn:aws:iam::123456789012:policy/test-1')).toBeInTheDocument();
  });

  it('triggers detail view when a row is selected', async () => {
    const partsResponse: PolicyPartsResponse = {
      parts: [
        {
          partIndex: 0,
          arn: 'arn:aws:iam::123456789012:policy/test-0',
          partType: 'blanket-deny',
          documentSize: 2048,
          statementItemCount: 5,
        },
      ],
      totalParts: 1,
      combinedSize: 2048,
    };
    const detailResponse: PolicyPartDetailResponse = {
      part: {
        partIndex: 0,
        arn: 'arn:aws:iam::123456789012:policy/test-0',
        partType: 'blanket-deny',
        documentSize: 2048,
        statementItemCount: 5,
      },
      document: { Version: '2012-10-17', Statement: [] },
      services: [{ servicePrefix: 's3', actions: ['GetObject'] }],
    };
    mockGetPolicyParts.mockResolvedValue(partsResponse);
    mockGetPolicyPartDetail.mockResolvedValue(detailResponse);

    render(<PolicyPartsTable policyId="policy-1" />);

    await waitFor(() => {
      expect(screen.getByText('arn:aws:iam::123456789012:policy/test-0')).toBeInTheDocument();
    });

    // Click the first radio button to select the row
    const radioButtons = screen.getAllByRole('radio');
    fireEvent.click(radioButtons[0]);

    await waitFor(() => {
      expect(mockGetPolicyPartDetail).toHaveBeenCalledWith('policy-1', 0);
    });
  });

  it('displays error state when API call fails', async () => {
    mockGetPolicyParts.mockRejectedValue(new Error('Network error'));

    render(<PolicyPartsTable policyId="policy-1" />);

    await waitFor(() => {
      expect(screen.getByText('Error loading policy parts')).toBeInTheDocument();
    });
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });
});
