import { useCallback, useEffect, useRef, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Button from '@cloudscape-design/components/button';
import Spinner from '@cloudscape-design/components/spinner';
import Alert from '@cloudscape-design/components/alert';
import ColumnLayout from '@cloudscape-design/components/column-layout';

import type { PolicyConfiguration, PolicyStatus } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { policyEnforcerClient } from '~/clients/policy-enforcer-client';
import { formatTimestamp } from '~/utils/time-utils';

const AUTO_REFRESH_INTERVAL_MS = 60_000;

export interface StatusDashboardProps {
  policies: PolicyConfiguration[];
  onRefreshComplete?: () => void;
}

/**
 * Computes the next refresh time from the last refresh time and interval.
 */
function computeNextRefresh(lastRefreshTime: string, refreshIntervalHours: number): string {
  const last = new Date(lastRefreshTime);
  const next = new Date(last.getTime() + refreshIntervalHours * 60 * 60 * 1000);
  return next.toISOString();
}

/**
 * Returns the count of policy parts (primary + additional ARNs).
 */
function getPartCount(policy: PolicyConfiguration): number {
  let count = 0;
  if (policy.policyArn) count += 1;
  if (policy.additionalPolicyArns) count += policy.additionalPolicyArns.length;
  return count;
}

/**
 * Maps a policy status to a StatusIndicator type and label.
 */
function getStatusIndicator(status: PolicyStatus): {
  type: 'success' | 'pending' | 'error';
  label: string;
} {
  switch (status) {
    case 'active':
      return { type: 'success', label: 'Active' };
    case 'pending':
      return { type: 'pending', label: 'Pending' };
    case 'error':
      return { type: 'error', label: 'Error' };
  }
}

/**
 * StatusDashboard displays all policy configurations with their current status,
 * part count, last refresh time, and next scheduled refresh. It provides a
 * "Refresh All" bulk action and auto-refreshes data every 60 seconds while
 * the page is visible.
 */
export default function StatusDashboard({ policies, onRefreshComplete }: StatusDashboardProps) {
  const [refreshingPolicies, setRefreshingPolicies] = useState<Set<string>>(new Set());
  const [refreshAllLoading, setRefreshAllLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 9.2: Refresh All bulk action
  const handleRefreshAll = useCallback(async () => {
    const activePolicies = policies.filter((p) => p.status === 'active');
    if (activePolicies.length === 0) return;

    setRefreshAllLoading(true);
    const refreshingIds = new Set(activePolicies.map((p) => p.policyId));
    setRefreshingPolicies(refreshingIds);

    await Promise.allSettled(
      activePolicies.map(async (policy) => {
        try {
          await policyEnforcerClient.refreshPolicy(policy.policyId);
        } finally {
          setRefreshingPolicies((prev) => {
            const next = new Set(prev);
            next.delete(policy.policyId);
            return next;
          });
        }
      }),
    );

    setRefreshAllLoading(false);
    onRefreshComplete?.();
  }, [policies, onRefreshComplete]);

  // 9.3: Auto-refresh with 60-second interval using Page Visibility API
  useEffect(() => {
    function startInterval() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        onRefreshComplete?.();
      }, AUTO_REFRESH_INTERVAL_MS);
    }

    function stopInterval() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        startInterval();
      } else {
        stopInterval();
      }
    }

    // Start interval only if page is currently visible
    if (document.visibilityState === 'visible') {
      startInterval();
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [onRefreshComplete]);

  if (policies.length === 0) {
    return (
      <Container header={<Header variant="h2">Status Dashboard</Header>}>
        <Box variant="p" color="text-status-inactive">
          No policy configurations found.
        </Box>
      </Container>
    );
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button
              iconName="refresh"
              loading={refreshAllLoading}
              onClick={handleRefreshAll}
              disabled={policies.filter((p) => p.status === 'active').length === 0}
            >
              Refresh All
            </Button>
          }
        >
          Status Dashboard
        </Header>
      }
    >
      <SpaceBetween size="m">
        {policies.map((policy) => {
          const statusInfo = getStatusIndicator(policy.status);
          const partCount = getPartCount(policy);
          const isRefreshing = refreshingPolicies.has(policy.policyId);
          const nextRefresh =
            policy.lastRefreshTime
              ? computeNextRefresh(policy.lastRefreshTime, policy.refreshIntervalHours)
              : undefined;

          return (
            <Container
              key={policy.policyId}
              header={
                <Header variant="h3">
                  <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                    <span>{policy.policyName}</span>
                    {isRefreshing && <Spinner size="normal" />}
                  </SpaceBetween>
                </Header>
              }
            >
              <SpaceBetween size="s">
                <ColumnLayout columns={4} variant="text-grid">
                  <div>
                    <Box variant="awsui-key-label">Status</Box>
                    <StatusIndicator type={statusInfo.type}>
                      {statusInfo.label}
                    </StatusIndicator>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Parts</Box>
                    <Badge>{partCount.toString()}</Badge>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Last Refresh</Box>
                    <div>
                      {policy.lastRefreshTime
                        ? formatTimestamp(policy.lastRefreshTime)
                        : 'Never'}
                    </div>
                  </div>
                  <div>
                    <Box variant="awsui-key-label">Next Refresh</Box>
                    <div>
                      {nextRefresh ? formatTimestamp(nextRefresh) : '—'}
                    </div>
                  </div>
                </ColumnLayout>

                {policy.status === 'error' && (
                  <Alert type="error" header="Refresh Error">
                    {policy.lastRefreshOutcome === 'error'
                      ? 'The last refresh attempt failed. Check CloudWatch logs for details or try refreshing again.'
                      : 'This policy is in an error state.'}
                  </Alert>
                )}
              </SpaceBetween>
            </Container>
          );
        })}
      </SpaceBetween>
    </Container>
  );
}
