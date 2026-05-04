import { useEffect, useState } from 'react';
import Select from '@cloudscape-design/components/select';
import type { SelectProps } from '@cloudscape-design/components/select';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';

interface StackSelectorProps {
  /** Called when a stack is selected or cleared. null means cleared. */
  onStackSelected: (stackName: string | null) => void;
  /** The currently selected stack name, or null. */
  selectedStack: string | null;
}

export default function StackSelector({ onStackSelected, selectedStack }: StackSelectorProps) {
  const [options, setOptions] = useState<SelectProps.Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStacks() {
      try {
        const stacks = await capabilityInsightsClient.listStacks();
        setOptions(stacks.map(name => ({ label: name, value: name })));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stacks');
      } finally {
        setLoading(false);
      }
    }
    fetchStacks();
  }, []);

  const selectedOption = selectedStack ? { label: selectedStack, value: selectedStack } : null;

  return (
    <Select
      selectedOption={selectedOption}
      onChange={({ detail }) => {
        onStackSelected(detail.selectedOption?.value ?? null);
      }}
      options={options}
      filteringType="auto"
      placeholder="Filter by CloudFormation stack"
      statusType={loading ? 'loading' : error ? 'error' : 'finished'}
      errorText={error ?? undefined}
      loadingText="Loading stacks"
      empty="No stacks found"
      ariaLabel="Filter by CloudFormation stack"
    />
  );
}
