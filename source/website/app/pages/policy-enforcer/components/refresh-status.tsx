import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Spinner from '@cloudscape-design/components/spinner';

import { formatTimestamp } from '~/utils/time-utils';

export interface RefreshStatusProps {
  /** ISO 8601 timestamp of the last refresh, or undefined if never refreshed */
  lastRefreshTime: string | undefined;
  /** Outcome of the last refresh */
  lastRefreshOutcome: 'success' | 'retained' | 'error' | undefined;
  /** Number of actions in the last generated allow-list */
  lastActionCount: number | undefined;
  /** Callback triggered when the user clicks "Refresh Now" */
  onRefresh: () => void;
  /** Whether a refresh is currently in progress */
  refreshing: boolean;
}

/**
 * Maps a refresh outcome to a StatusIndicator type and label.
 */
function getOutcomeIndicator(outcome: 'success' | 'retained' | 'error'): {
  type: 'success' | 'warning' | 'error';
  label: string;
} {
  switch (outcome) {
    case 'success':
      return { type: 'success', label: 'Success' };
    case 'retained':
      return { type: 'warning', label: 'Retained (previous policy kept)' };
    case 'error':
      return { type: 'error', label: 'Error' };
  }
}

/**
 * Displays the last refresh time, outcome, and action count for a policy configuration.
 * Includes a "Refresh Now" button to trigger an immediate refresh and shows a loading
 * indicator while a refresh is in progress.
 */
export default function RefreshStatus({
  lastRefreshTime,
  lastRefreshOutcome,
  lastActionCount,
  onRefresh,
  refreshing,
}: RefreshStatusProps) {
  const hasRefreshed = lastRefreshTime !== undefined;

  return (
    <Container
      header={
        <Header
          variant="h3"
          actions={
            <Button onClick={onRefresh} disabled={refreshing} iconName="refresh">
              Refresh Now
            </Button>
          }
        >
          Refresh Status
        </Header>
      }
    >
      {refreshing ? (
        <SpaceBetween size="xs" direction="horizontal" alignItems="center">
          <Spinner size="normal" />
          <Box variant="p" color="text-status-info">
            Refresh in progress…
          </Box>
        </SpaceBetween>
      ) : hasRefreshed ? (
        <KeyValuePairs
          columns={3}
          items={[
            {
              label: 'Last refresh',
              value: formatTimestamp(lastRefreshTime),
            },
            {
              label: 'Outcome',
              value: lastRefreshOutcome ? (
                <StatusIndicator type={getOutcomeIndicator(lastRefreshOutcome).type}>
                  {getOutcomeIndicator(lastRefreshOutcome).label}
                </StatusIndicator>
              ) : (
                '—'
              ),
            },
            {
              label: 'Action count',
              value:
                lastActionCount !== undefined ? lastActionCount.toLocaleString() : '—',
            },
          ]}
        />
      ) : (
        <Box variant="p" color="text-status-inactive">
          No refresh has been performed yet. Click "Refresh Now" to trigger the first policy
          generation.
        </Box>
      )}
    </Container>
  );
}
