import { useState, useEffect } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Textarea from '@cloudscape-design/components/textarea';
import Multiselect from '@cloudscape-design/components/multiselect';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import Alert from '@cloudscape-design/components/alert';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';

import type { ExceptionEntry } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { Region } from '@capability-insights/shared/types/capability/region';

export const EXCEPTION_PATTERN = /^[a-zA-Z0-9-]+:(([A-Z][a-zA-Z0-9]*)|(\*))$/;

// --- Policy Details Section ---

interface PolicyDetailsFieldsProps {
  policyName: string;
  onPolicyNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
}

export function PolicyDetailsFields({
  policyName,
  onPolicyNameChange,
  description,
  onDescriptionChange,
}: PolicyDetailsFieldsProps) {
  return (
    <Container header={<Header variant="h2">Policy details</Header>}>
      <SpaceBetween size="l">
        <FormField
          label="Policy name"
          description="A unique name to identify this policy configuration."
          constraintText="Required. Must be unique across all policies."
        >
          <Input
            value={policyName}
            onChange={({ detail }) => onPolicyNameChange(detail.value)}
            placeholder="e.g., Payment Service - US/EU"
          />
        </FormField>
        <FormField
          label={<span>Description <i>- optional</i></span>}
          description="Describe the workload or purpose of this policy."
        >
          <Textarea
            value={description}
            onChange={({ detail }) => onDescriptionChange(detail.value)}
            placeholder="e.g., Restricts capabilities for the payment processing service deployed in US and EU regions."
          />
        </FormField>
      </SpaceBetween>
    </Container>
  );
}

// --- Region Selection Section ---

interface RegionSelectionFieldProps {
  selectedRegions: ReadonlyArray<MultiselectProps.Option>;
  onSelectedRegionsChange: (options: ReadonlyArray<MultiselectProps.Option>) => void;
  regionOptions: MultiselectProps.Option[];
  regionsLoading: boolean;
}

export function RegionSelectionField({
  selectedRegions,
  onSelectedRegionsChange,
  regionOptions,
  regionsLoading,
}: RegionSelectionFieldProps) {
  return (
    <Container header={<Header variant="h2">Region selection</Header>}>
      <FormField
        label="Target regions"
        description="The policy will restrict capabilities based on availability in these regions."
        constraintText="At least one region is required."
      >
        <Multiselect
          selectedOptions={selectedRegions}
          onChange={({ detail }) => onSelectedRegionsChange(detail.selectedOptions)}
          options={regionOptions}
          loadingText="Loading regions..."
          placeholder="Select regions"
          filteringType="auto"
          tokenLimit={5}
          statusType={regionsLoading ? 'loading' : 'finished'}
        />
      </FormField>
    </Container>
  );
}

// --- Computation Mode Section ---

interface ComputationModeFieldProps {
  mode: 'intersection' | 'union';
  onModeChange: (mode: 'intersection' | 'union') => void;
}

export function ComputationModeField({ mode, onModeChange }: ComputationModeFieldProps) {
  return (
    <Container header={<Header variant="h2">Computation mode</Header>}>
      <FormField
        label="Computation mode"
        description="Determines which capabilities are included in the allow-list."
      >
        <RadioGroup
          value={mode}
          onChange={({ detail }) => onModeChange(detail.value as 'intersection' | 'union')}
          items={[
            {
              value: 'intersection',
              label: 'Intersection',
              description:
                'Only include capabilities available in ALL selected regions. This is the most restrictive option — the policy will only allow actions that are universally available across every selected region.',
            },
            {
              value: 'union',
              label: 'Union',
              description:
                'Include capabilities available in ANY of the selected regions. This is more permissive — the policy will allow actions that are available in at least one selected region.',
            },
          ]}
        />
      </FormField>
    </Container>
  );
}

// --- Policy Type Section ---

interface PolicyTypeFieldProps {
  policyType: 'IAM' | 'SCP';
  onPolicyTypeChange: (type: 'IAM' | 'SCP') => void;
}

export function PolicyTypeField({ policyType, onPolicyTypeChange }: PolicyTypeFieldProps) {
  return (
    <Container header={<Header variant="h2">Policy type</Header>}>
      <SpaceBetween size="l">
        <FormField
          label="Output policy type"
          description="Select whether to generate an IAM Policy or a Service Control Policy."
        >
          <RadioGroup
            value={policyType}
            onChange={({ detail }) => onPolicyTypeChange(detail.value as 'IAM' | 'SCP')}
            items={[
              {
                value: 'IAM',
                label: 'IAM Policy',
                description:
                  'A standalone managed policy that can be attached to IAM roles, users, or groups. Supports splitting into multiple policies if the size limit is exceeded.',
              },
              {
                value: 'SCP',
                label: 'Service Control Policy (SCP)',
                description:
                  'An organization-level policy applied to organizational units or accounts. Cannot be split if the size limit is exceeded.',
              },
            ]}
          />
        </FormField>
        {policyType === 'SCP' && (
          <Alert type="warning" header="Organization-wide impact">
            Service Control Policies affect all accounts within the targeted organizational
            unit. Ensure the selected regions and mode are appropriate for your entire
            organization before proceeding.
          </Alert>
        )}
      </SpaceBetween>
    </Container>
  );
}

// --- Exceptions Section ---

interface ExceptionsFieldProps {
  exceptions: ExceptionEntry[];
  onExceptionsChange: (exceptions: ExceptionEntry[]) => void;
}

export function ExceptionsField({ exceptions, onExceptionsChange }: ExceptionsFieldProps) {
  const [newException, setNewException] = useState('');
  const [exceptionError, setExceptionError] = useState('');
  const [exceptionFilter, setExceptionFilter] = useState('');

  function handleAddException() {
    const trimmed = newException.trim();
    if (!trimmed) {
      setExceptionError('Exception entry cannot be empty.');
      return;
    }
    if (!EXCEPTION_PATTERN.test(trimmed)) {
      setExceptionError('Invalid format. Use service:Action or service:* (e.g., s3:GetObject, ec2:*).');
      return;
    }
    if (exceptions.some(e => e.action === trimmed)) {
      setExceptionError('This exception already exists.');
      return;
    }
    onExceptionsChange([...exceptions, { action: trimmed, addedAt: new Date().toISOString() }]);
    setNewException('');
    setExceptionError('');
  }

  function handleRemoveException(action: string) {
    onExceptionsChange(exceptions.filter(e => e.action !== action));
  }

  const filteredExceptions = exceptions.filter(e =>
    e.action.toLowerCase().includes(exceptionFilter.toLowerCase()),
  );

  return (
    <Container header={<Header variant="h2">Exceptions</Header>}>
      <SpaceBetween size="l">
        <FormField
          label="Add exception"
          description="Specify AWS actions to always include regardless of regional availability."
          constraintText="Format: service:Action or service:* (e.g., s3:GetObject, ec2:*)"
          errorText={exceptionError}
        >
          <SpaceBetween direction="horizontal" size="xs">
            <Input
              value={newException}
              onChange={({ detail }) => {
                setNewException(detail.value);
                setExceptionError('');
              }}
              placeholder="e.g., s3:GetObject"
              onKeyDown={({ detail }) => {
                if (detail.key === 'Enter') handleAddException();
              }}
            />
            <Button onClick={handleAddException} iconName="add-plus">
              Add
            </Button>
          </SpaceBetween>
        </FormField>
        {exceptions.length > 0 && (
          <Table
            header={
              <Header counter={`(${exceptions.length})`}>
                Current exceptions
              </Header>
            }
            items={filteredExceptions}
            filter={
              <TextFilter
                filteringText={exceptionFilter}
                onChange={({ detail }) => setExceptionFilter(detail.filteringText)}
                filteringPlaceholder="Search exceptions"
              />
            }
            columnDefinitions={[
              {
                id: 'action',
                header: 'Action',
                cell: item => item.action,
                width: 300,
              },
              {
                id: 'remove',
                header: '',
                cell: item => (
                  <Button
                    variant="inline-icon"
                    iconName="remove"
                    onClick={() => handleRemoveException(item.action)}
                    ariaLabel={`Remove exception ${item.action}`}
                  />
                ),
                width: 60,
              },
            ]}
            empty={
              <Box textAlign="center" color="inherit">
                No exceptions match the filter.
              </Box>
            }
          />
        )}
        {exceptions.length === 0 && (
          <Box color="text-status-inactive">
            No exceptions added. Actions listed here are always included regardless of regional availability.
          </Box>
        )}
      </SpaceBetween>
    </Container>
  );
}

// --- Region Loading Hook ---

export function useRegionOptions() {
  const [regionOptions, setRegionOptions] = useState<MultiselectProps.Option[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);

  useEffect(() => {
    async function loadRegions() {
      setRegionsLoading(true);
      try {
        const regions: Region[] = await capabilityInsightsClient.listRegions();
        const options = regions.map(r => ({
          value: r.Region,
          label: r.Region,
          description: r.RegionLongName,
        }));
        setRegionOptions(options);
      } catch {
        setRegionOptions([]);
      } finally {
        setRegionsLoading(false);
      }
    }
    loadRegions();
  }, []);

  return { regionOptions, regionsLoading };
}
