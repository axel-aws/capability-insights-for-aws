import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import StatusDashboard from '../status-dashboard';
import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

vi.mock('~/clients/policy-enforcer-client', () => ({
  policyEnforcerClient: {
    refreshPolicy: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('~/utils/time-utils', () => ({
  formatTimestamp: (iso: string) => `formatted:${iso}`,
}));

function createPolicy(overrides: Partial<PolicyConfiguration> = {}): PolicyConfiguration {
  return {
    policyId: 'policy-1',
    policyName: 'Test Policy',
    tags: [],
    regions: ['us-east-1'],
    mode: 'intersection',
    policyType: 'IAM',
    exceptions: [],
    refreshIntervalHours: 24,
    status: 'active',
    policyArn: 'arn:aws:iam::123456789012:policy/test-0',
    lastRefreshTime: '2024-01-01T00:00:00.000Z',
    lastRefreshOutcome: 'success',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('StatusDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock document.visibilityState
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders multiple policies with different statuses', () => {
    const policies = [
      createPolicy({ policyId: 'p1', policyName: 'Active Policy', status: 'active' }),
      createPolicy({ policyId: 'p2', policyName: 'Pending Policy', status: 'pending' }),
      createPolicy({ policyId: 'p3', policyName: 'Error Policy', status: 'error', lastRefreshOutcome: 'error' }),
    ];

    render(<StatusDashboard policies={policies} />);

    expect(screen.getByText('Active Policy')).toBeInTheDocument();
    expect(screen.getByText('Pending Policy')).toBeInTheDocument();
    expect(screen.getByText('Error Policy')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('displays next refresh time computed from last refresh and interval', () => {
    const policy = createPolicy({
      lastRefreshTime: '2024-01-01T00:00:00.000Z',
      refreshIntervalHours: 24,
    });

    render(<StatusDashboard policies={[policy]} />);

    // Next refresh should be 24 hours after last refresh
    const nextRefreshElements = screen.getAllByText('formatted:2024-01-02T00:00:00.000Z');
    expect(nextRefreshElements.length).toBeGreaterThan(0);
  });

  it('displays error context when policy status is error', () => {
    const policy = createPolicy({
      status: 'error',
      lastRefreshOutcome: 'error',
    });

    render(<StatusDashboard policies={[policy]} />);

    // Cloudscape Alert renders header and content in multiple elements for accessibility
    const errorHeaders = screen.getAllByText('Refresh Error');
    expect(errorHeaders.length).toBeGreaterThan(0);
    const errorMessages = screen.getAllByText(/The last refresh attempt failed/);
    expect(errorMessages.length).toBeGreaterThan(0);
  });

  it('shows empty state when no policies exist', () => {
    render(<StatusDashboard policies={[]} />);

    expect(screen.getByText('No policy configurations found.')).toBeInTheDocument();
  });

  it('displays "Never" for last refresh when no refresh has occurred', () => {
    const policy = createPolicy({
      lastRefreshTime: undefined,
    });

    render(<StatusDashboard policies={[policy]} />);

    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('auto-refreshes data every 60 seconds using fake timers', async () => {
    vi.useFakeTimers();
    const onRefreshComplete = vi.fn();

    const policy = createPolicy();
    render(<StatusDashboard policies={[policy]} onRefreshComplete={onRefreshComplete} />);

    // Initially, onRefreshComplete should not have been called
    expect(onRefreshComplete).not.toHaveBeenCalled();

    // Advance by 60 seconds
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onRefreshComplete).toHaveBeenCalledTimes(1);

    // Advance by another 60 seconds
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onRefreshComplete).toHaveBeenCalledTimes(2);
  });

  it('stops auto-refresh when page becomes hidden', async () => {
    vi.useFakeTimers();
    const onRefreshComplete = vi.fn();

    const policy = createPolicy();
    render(<StatusDashboard policies={[policy]} onRefreshComplete={onRefreshComplete} />);

    // Simulate page becoming hidden
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      writable: true,
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Advance by 60 seconds - should NOT trigger refresh
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(onRefreshComplete).not.toHaveBeenCalled();
  });
});
