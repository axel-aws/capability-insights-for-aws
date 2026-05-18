import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
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
import Spinner from '@cloudscape-design/components/spinner';
import Form from '@cloudscape-design/components/form';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';

import { APP_NAME } from '~/constants/app';
import { policyEnforcerClient } from '~/clients/policy-enforcer-client';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { CreatePolicyRequest, ExceptionEntry } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import type { RouteHandle } from '~/types/route';

export const PAGE_EDIT_POLICY = 'Edit Policy';

export const handle: RouteHandle = { pageName: PAGE_EDIT_POLICY };

export function meta() {
  return [
    { title: `${PAGE_EDIT_POLICY} - ${APP_NAME}` },
    { name: 'description', content: 'Edit policy configuration' },
  ];
}

const EXCEPTION_PATTERN = /^[a-zA-Z0-9-]+:(([A-Z][a-zA-Z0-9]*)|(\*))$/;

export default function EditPolicyPage() {
  const { policyId } = useParams<{ policyId: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Form state
  const [policyName, setPolicyName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedRegions, setSelectedRegions] = useState<ReadonlyArray<MultiselectProps.Option>>([]);
  const [mode, setMode] = useState<'intersection' | 'union'>('intersection');
  const [policyType, setPolicyType] = useState<'IAM' | 'SCP'>('IAM');
  const [exceptions, setExceptions] = useState<ExceptionEntry[]>([]);

  // Region options
  const [regionOptions, setRegionOptions] = useState<MultiselectProps.Option[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);

  // Exception input
  const [newException, setNewException] = useState('');
  const [exceptionError, setExceptionError] = useState('');
  const [exceptionFilter, setExceptionFilter] = useState('');

  // Load regions and policy data
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

  useEffect(() => {
    if (!policyId) return;
    async function loadPolicy() {
      setLoading(true);
      setLoadError(null);
      try {
        const policy = await policyEnforcerClient.getPolicy(policyId!);
        setPolicyName(policy.policyName);
        setDescription(policy.description ?? '');
        setSelectedRegions(policy.regions.map(r => ({ value: r, label: r })));
        setMode(policy.mode);
        setPolicyType(policy.policyType);
        setExceptions(policy.exceptions ?? []);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load policy');
      } finally {
        setLoading(false);
      }
    }
    loadPolicy();
  }, [policyId]);

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
    setExceptions(prev => [...prev, { action: trimmed, addedAt: new Date().toISOString() }]);
    setNewException('');
    setExceptionError('');
  }

  function handleRemoveException(action: string) {
    setExceptions(prev => prev.filter(e => e.action !== action));
  }

  async function handleSubmit() {
    if (!policyId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const request: CreatePolicyRequest = {
        policyName: policyName.trim(),
        regions: selectedRegions.map(r => r.value!),
        mode,
        policyType,
      };
      if (description.trim()) {
        request.description = description.trim();
      }
      if (exceptions.length > 0) {
        request.exceptions = exceptions;
      }
      await policyEnforcerClient.updatePolicy(policyId, request);
      navigate(`/policy-enforcer/${policyId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update policy.');
    } finally {
      setSubmitting(false);
    }
  }

  const filteredExceptions = exceptions.filter(e =>
    e.action.toLowerCase().includes(exceptionFilter.toLowerCase()),
  );

  if (loading) {
    return (
      <ContentLayout header={<Header variant="h1">Loading...</Header>}>
        <Box textAlign="center" padding="xxl">
          <Spinner size="large" />
        </Box>
      </ContentLayout>
    );
  }

  if (loadError) {
    return (
      <ContentLayout header={<Header variant="h1">Edit Policy</Header>}>
        <Alert type="error" header="Error loading policy">
          {loadError}
        </Alert>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Modify the policy configuration. Changes will take effect on the next refresh."
        >
          Edit: {policyName}
        </Header>
      }
    >
      <Form
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={() => navigate(`/policy-enforcer/${policyId}`)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} loading={submitting}>
              Save changes
            </Button>
          </SpaceBetween>
        }
        errorText={submitError}
      >
        <SpaceBetween size="l">
          <Container header={<Header variant="h2">Policy details</Header>}>
            <SpaceBetween size="l">
              <FormField label="Policy name" constraintText="Must be unique across all policies.">
                <Input
                  value={policyName}
                  onChange={({ detail }) => setPolicyName(detail.value)}
                />
              </FormField>
              <FormField label={<span>Description <i>- optional</i></span>}>
                <Textarea
                  value={description}
                  onChange={({ detail }) => setDescription(detail.value)}
                />
              </FormField>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h2">Regions</Header>}>
            <FormField
              label="Target regions"
              constraintText="At least one region is required."
            >
              <Multiselect
                selectedOptions={selectedRegions}
                onChange={({ detail }) => setSelectedRegions(detail.selectedOptions)}
                options={regionOptions}
                loadingText="Loading regions..."
                placeholder="Select regions"
                filteringType="auto"
                tokenLimit={5}
                statusType={regionsLoading ? 'loading' : 'finished'}
              />
            </FormField>
          </Container>

          <Container header={<Header variant="h2">Computation mode</Header>}>
            <FormField label="Mode">
              <RadioGroup
                value={mode}
                onChange={({ detail }) => setMode(detail.value as 'intersection' | 'union')}
                items={[
                  {
                    value: 'intersection',
                    label: 'Intersection',
                    description: 'Only include capabilities available in ALL selected regions.',
                  },
                  {
                    value: 'union',
                    label: 'Union',
                    description: 'Include capabilities available in ANY selected region.',
                  },
                ]}
              />
            </FormField>
          </Container>

          <Container header={<Header variant="h2">Exceptions</Header>}>
            <SpaceBetween size="l">
              <FormField
                label="Add exception"
                description="Actions to always include regardless of regional availability."
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
                  No exceptions. Actions listed here are always included regardless of regional availability.
                </Box>
              )}
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h2">Policy type</Header>}>
            <FormField label="Output policy type">
              <RadioGroup
                value={policyType}
                onChange={({ detail }) => setPolicyType(detail.value as 'IAM' | 'SCP')}
                items={[
                  {
                    value: 'IAM',
                    label: 'IAM Policy',
                    description: 'Standalone managed policy for IAM roles, users, or groups.',
                  },
                  {
                    value: 'SCP',
                    label: 'Service Control Policy (SCP)',
                    description: 'Organization-level policy for OUs or accounts.',
                  },
                ]}
              />
            </FormField>
          </Container>
        </SpaceBetween>
      </Form>
    </ContentLayout>
  );
}
