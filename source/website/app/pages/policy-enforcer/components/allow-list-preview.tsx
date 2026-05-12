import { useState } from 'react';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import Alert from '@cloudscape-design/components/alert';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';

export interface AllowListPreviewProps {
  /** List of computed IAM actions in the allow-list */
  actions: string[];
  /** Total number of actions in the allow-list */
  actionCount: number;
  /** Number of actions excluded by the availability filter */
  excludedCount: number;
  /** Number of actions added via exceptions */
  exceptionCount: number;
  /** Estimated policy document size in characters */
  estimatedPolicySize: number;
  /** Whether the policy needs to be split into multiple documents */
  splitRequired: boolean;
  /** The policy type (IAM or SCP) */
  policyType: 'IAM' | 'SCP';
  /** Whether the preview data is currently loading */
  loading?: boolean;
}

/**
 * Displays a searchable preview of the computed allow-list actions
 * with summary statistics about the policy generation.
 */
export default function AllowListPreview({
  actions,
  actionCount,
  excludedCount,
  exceptionCount,
  estimatedPolicySize,
  splitRequired,
  policyType,
  loading = false,
}: AllowListPreviewProps) {
  const [filteringText, setFilteringText] = useState('');

  const filteredActions = filteringText
    ? actions.filter(action => action.toLowerCase().includes(filteringText.toLowerCase()))
    : actions;

  const sizeLimit = policyType === 'IAM' ? 6144 : 5120;
  const sizePercentage = sizeLimit > 0 ? Math.round((estimatedPolicySize / sizeLimit) * 100) : 0;

  return (
    <SpaceBetween size="l">
      <KeyValuePairs
        columns={4}
        items={[
          {
            label: 'Action count',
            value: <Badge color="blue">{actionCount.toLocaleString()}</Badge>,
          },
          {
            label: 'Excluded actions',
            value: <Badge color="grey">{excludedCount.toLocaleString()}</Badge>,
          },
          {
            label: 'Exception actions',
            value: <Badge color="green">{exceptionCount.toLocaleString()}</Badge>,
          },
          {
            label: 'Estimated policy size',
            value: (
              <span>
                {estimatedPolicySize > 0
                  ? `${estimatedPolicySize.toLocaleString()} / ${sizeLimit.toLocaleString()} chars (${sizePercentage}%)`
                  : '—'}
              </span>
            ),
          },
        ]}
      />

      {splitRequired && policyType === 'IAM' && (
        <Alert type="warning" header="Policy split required">
          The allow-list exceeds the IAM policy size limit ({sizeLimit.toLocaleString()} characters).
          The policy will be split into multiple managed policies.
        </Alert>
      )}

      {splitRequired && policyType === 'SCP' && (
        <Alert type="error" header="SCP size limit exceeded">
          The allow-list exceeds the SCP size limit ({sizeLimit.toLocaleString()} characters).
          Consider reducing the scope by selecting fewer regions, using intersection mode, or
          switching to IAM Policy type which supports splitting.
        </Alert>
      )}

      <Table
        loading={loading}
        loadingText="Loading allow-list preview..."
        header={
          <Header counter={`(${filteredActions.length.toLocaleString()})`}>
            Allowed actions
          </Header>
        }
        items={filteredActions.slice(0, 100)}
        filter={
          <TextFilter
            filteringText={filteringText}
            onChange={({ detail }) => setFilteringText(detail.filteringText)}
            filteringPlaceholder="Search actions"
            countText={`${filteredActions.length.toLocaleString()} action${filteredActions.length === 1 ? '' : 's'}`}
          />
        }
        columnDefinitions={[
          {
            id: 'action',
            header: 'IAM Action',
            cell: item => item,
          },
        ]}
        empty={
          <Box textAlign="center" color="inherit">
            {filteringText ? (
              <SpaceBetween size="xs">
                <b>No matching actions</b>
                <Box variant="p" color="inherit">
                  No actions match the current filter.
                </Box>
              </SpaceBetween>
            ) : (
              <SpaceBetween size="xs">
                <b>No actions</b>
                <Box variant="p" color="inherit">
                  The allow-list is empty. The policy will deny all actions.
                </Box>
              </SpaceBetween>
            )}
          </Box>
        }
      />

      {filteredActions.length > 100 && (
        <Box textAlign="center" color="text-status-inactive">
          Showing first 100 of {filteredActions.length.toLocaleString()} actions. Use the search
          filter to find specific actions.
        </Box>
      )}
    </SpaceBetween>
  );
}
