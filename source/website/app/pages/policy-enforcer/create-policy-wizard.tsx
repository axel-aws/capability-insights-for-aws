import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import Wizard from '@cloudscape-design/components/wizard';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Textarea from '@cloudscape-design/components/textarea';
import Multiselect from '@cloudscape-design/components/multiselect';
import RadioGroup from '@cloudscape-design/components/radio-group';
import TagEditor from '@cloudscape-design/components/tag-editor';
import Alert from '@cloudscape-design/components/alert';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import Box from '@cloudscape-design/components/box';
import ContentLayout from '@cloudscape-design/components/content-layout';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';
import type { TagEditorProps } from '@cloudscape-design/components/tag-editor';

import { APP_NAME } from '~/constants/app';
import { policyEnforcerClient } from '~/clients/policy-enforcer-client';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { CreatePolicyRequest, ExceptionEntry } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import type { RouteHandle } from '~/types/route';

export const PAGE_CREATE_POLICY = 'Create Policy';

export const handle: RouteHandle = { pageName: PAGE_CREATE_POLICY };

export function meta() {
  return [
    { title: `${PAGE_CREATE_POLICY} - ${APP_NAME}` },
    { name: 'description', content: 'Create a new policy configuration' },
  ];
}

const EXCEPTION_PATTERN = /^[a-zA-Z0-9-]+:(([A-Z][a-zA-Z0-9]*)|(\*))$/;

interface WizardState {
  policyName: string;
  description: string;
  tags: ReadonlyArray<TagEditorProps.Tag>;
  selectedRegions: ReadonlyArray<MultiselectProps.Option>;
  mode: 'intersection' | 'union';
  exceptions: ExceptionEntry[];
  policyType: 'IAM' | 'SCP';
}

export default function CreatePolicyWizard() {
  const navigate = useNavigate();

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Form state
  const [state, setState] = useState<WizardState>({
    policyName: '',
    description: '',
    tags: [],
    selectedRegions: [],
    mode: 'intersection',
    exceptions: [],
    policyType: 'IAM',
  });

  // Region options from catalog
  const [regionOptions, setRegionOptions] = useState<MultiselectProps.Option[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);

  // Exception input
  const [newException, setNewException] = useState('');
  const [exceptionError, setExceptionError] = useState('');
  const [exceptionFilter, setExceptionFilter] = useState('');

  // Preview state
  const [previewActions, setPreviewActions] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewActionCount, setPreviewActionCount] = useState(0);
  const [previewEstimatedSize, setPreviewEstimatedSize] = useState(0);
  const [previewSplitRequired, setPreviewSplitRequired] = useState(false);
  const [previewFilter, setPreviewFilter] = useState('');

  // Load regions from catalog
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

  // Load preview when reaching the review step
  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      // Create a temporary policy to get preview
      const request = buildCreateRequest();
      const tempPolicy = await policyEnforcerClient.createPolicy(request);
      try {
        const preview = await policyEnforcerClient.previewPolicy(tempPolicy.policyId);
        setPreviewActions(preview.actions);
        setPreviewActionCount(preview.actionCount);
        setPreviewEstimatedSize(preview.estimatedPolicySize);
        setPreviewSplitRequired(preview.splitRequired);
      } finally {
        // Clean up the temporary policy
        await policyEnforcerClient.deletePolicy(tempPolicy.policyId);
      }
    } catch {
      // If preview fails, show empty state
      setPreviewActions([]);
      setPreviewActionCount(0);
      setPreviewEstimatedSize(0);
      setPreviewSplitRequired(false);
    } finally {
      setPreviewLoading(false);
    }
  }, [state]);

  function buildCreateRequest(): CreatePolicyRequest {
    const request: CreatePolicyRequest = {
      policyName: state.policyName.trim(),
      regions: state.selectedRegions.map(r => r.value!),
      mode: state.mode,
      policyType: state.policyType,
    };
    if (state.description.trim()) {
      request.description = state.description.trim();
    }
    const validTags = state.tags
      .filter(t => t.key && t.value)
      .map(t => ({ key: t.key!, value: t.value! }));
    if (validTags.length > 0) {
      request.tags = validTags;
    }
    if (state.exceptions.length > 0) {
      request.exceptions = state.exceptions;
    }
    return request;
  }

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
    if (state.exceptions.some(e => e.action === trimmed)) {
      setExceptionError('This exception already exists.');
      return;
    }
    setState(prev => ({
      ...prev,
      exceptions: [...prev.exceptions, { action: trimmed, addedAt: new Date().toISOString() }],
    }));
    setNewException('');
    setExceptionError('');
  }

  function handleRemoveException(action: string) {
    setState(prev => ({
      ...prev,
      exceptions: prev.exceptions.filter(e => e.action !== action),
    }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const request = buildCreateRequest();
      await policyEnforcerClient.createPolicy(request);
      navigate('/policy-enforcer');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create policy.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleNavigate(event: { detail: { requestedStepIndex: number; reason: string } }) {
    const { requestedStepIndex } = event.detail;
    // Load preview when navigating to the review step
    if (requestedStepIndex === 5) {
      loadPreview();
    }
    setActiveStepIndex(requestedStepIndex);
  }

  const filteredExceptions = state.exceptions.filter(e =>
    e.action.toLowerCase().includes(exceptionFilter.toLowerCase()),
  );

  const filteredPreviewActions = previewActions.filter(a =>
    a.toLowerCase().includes(previewFilter.toLowerCase()),
  );

  return (
    <ContentLayout
      header={
        <Header variant="h1" description="Configure a new policy for regional governance.">
          {PAGE_CREATE_POLICY}
        </Header>
      }
    >
      <Wizard
        i18nStrings={{
          stepNumberLabel: stepNumber => `Step ${stepNumber}`,
          collapsedStepsLabel: (stepNumber, stepsCount) => `Step ${stepNumber} of ${stepsCount}`,
          submitButton: 'Create policy',
          cancelButton: 'Cancel',
          previousButton: 'Previous',
          nextButton: 'Next',
          optional: 'optional',
        }}
        onNavigate={handleNavigate}
        activeStepIndex={activeStepIndex}
        onCancel={() => navigate('/policy-enforcer')}
        onSubmit={handleSubmit}
        isLoadingNextStep={submitting}
        steps={[
          {
            title: 'Name, description, and tags',
            description: 'Provide a name and optional details for your policy configuration.',
            content: (
              <SpaceBetween size="l">
                <Container header={<Header variant="h2">Policy details</Header>}>
                  <SpaceBetween size="l">
                    <FormField
                      label="Policy name"
                      description="A unique name to identify this policy configuration."
                      constraintText="Required. Must be unique across all policies."
                    >
                      <Input
                        value={state.policyName}
                        onChange={({ detail }) =>
                          setState(prev => ({ ...prev, policyName: detail.value }))
                        }
                        placeholder="e.g., Payment Service - US/EU"
                      />
                    </FormField>
                    <FormField
                      label={<span>Description <i>- optional</i></span>}
                      description="Describe the workload or purpose of this policy."
                    >
                      <Textarea
                        value={state.description}
                        onChange={({ detail }) =>
                          setState(prev => ({ ...prev, description: detail.value }))
                        }
                        placeholder="e.g., Restricts capabilities for the payment processing service deployed in US and EU regions."
                      />
                    </FormField>
                  </SpaceBetween>
                </Container>
                <Container header={<Header variant="h2">Tags</Header>}>
                  <TagEditor
                    i18nStrings={{
                      keyPlaceholder: 'Enter key',
                      valuePlaceholder: 'Enter value',
                      addButton: 'Add new tag',
                      removeButton: 'Remove',
                      undoButton: 'Undo',
                      undoPrompt: 'This tag will be removed',
                      loading: 'Loading tag suggestions',
                      keyHeader: 'Key',
                      valueHeader: 'Value',
                      optional: 'optional',
                      keySuggestion: 'Custom tag key',
                      valueSuggestion: 'Custom tag value',
                      emptyTags: 'No tags associated with this policy.',
                      tagLimit: (availableTags, _tagLimit) =>
                        availableTags === 1
                          ? 'You can add up to 1 more tag.'
                          : `You can add up to ${availableTags} more tags.`,
                      tagLimitReached: (_tagLimit) => 'You have reached the tag limit.',
                      tagLimitExceeded: (_tagLimit) => 'You have exceeded the tag limit.',
                      enteredKeyLabel: (key) => `Use "${key}"`,
                      enteredValueLabel: (value) => `Use "${value}"`,
                    }}
                    tags={state.tags}
                    onChange={({ detail }) =>
                      setState(prev => ({ ...prev, tags: detail.tags }))
                    }
                  />
                </Container>
              </SpaceBetween>
            ),
          },
          {
            title: 'Regions',
            description: 'Select the target AWS regions for policy generation.',
            content: (
              <Container header={<Header variant="h2">Region selection</Header>}>
                <FormField
                  label="Target regions"
                  description="The policy will restrict capabilities based on availability in these regions."
                  constraintText="At least one region is required."
                >
                  <Multiselect
                    selectedOptions={state.selectedRegions}
                    onChange={({ detail }) =>
                      setState(prev => ({
                        ...prev,
                        selectedRegions: detail.selectedOptions,
                      }))
                    }
                    options={regionOptions}
                    loadingText="Loading regions..."
                    placeholder="Select regions"
                    filteringType="auto"
                    tokenLimit={5}
                    statusType={regionsLoading ? 'loading' : 'finished'}
                  />
                </FormField>
              </Container>
            ),
          },
          {
            title: 'Computation mode',
            description: 'Choose how capabilities are evaluated across selected regions.',
            content: (
              <Container header={<Header variant="h2">Mode selection</Header>}>
                <FormField
                  label="Computation mode"
                  description="Determines which capabilities are included in the allow-list."
                >
                  <RadioGroup
                    value={state.mode}
                    onChange={({ detail }) =>
                      setState(prev => ({
                        ...prev,
                        mode: detail.value as 'intersection' | 'union',
                      }))
                    }
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
            ),
          },
          {
            title: 'Exceptions',
            description: 'Add manual exceptions to always include in the allow-list.',
            content: (
              <Container header={<Header variant="h2">Exception entries</Header>}>
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
                  {state.exceptions.length > 0 && (
                    <Table
                      header={
                        <Header counter={`(${state.exceptions.length})`}>
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
                  {state.exceptions.length === 0 && (
                    <Box color="text-status-inactive">
                      No exceptions added. Exceptions allow specific actions regardless of regional availability.
                    </Box>
                  )}
                </SpaceBetween>
              </Container>
            ),
          },
          {
            title: 'Policy type',
            description: 'Choose the type of policy to generate.',
            content: (
              <Container header={<Header variant="h2">Policy type</Header>}>
                <SpaceBetween size="l">
                  <FormField
                    label="Output policy type"
                    description="Select whether to generate an IAM Policy or a Service Control Policy."
                  >
                    <RadioGroup
                      value={state.policyType}
                      onChange={({ detail }) =>
                        setState(prev => ({
                          ...prev,
                          policyType: detail.value as 'IAM' | 'SCP',
                        }))
                      }
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
                  {state.policyType === 'SCP' && (
                    <Alert type="warning" header="Organization-wide impact">
                      Service Control Policies affect all accounts within the targeted organizational
                      unit. Ensure the selected regions and mode are appropriate for your entire
                      organization before proceeding.
                    </Alert>
                  )}
                </SpaceBetween>
              </Container>
            ),
          },
          {
            title: 'Review and create',
            description: 'Review your configuration and create the policy.',
            content: (
              <SpaceBetween size="l">
                {submitError && (
                  <Alert type="error" header="Failed to create policy">
                    {submitError}
                  </Alert>
                )}
                <Container header={<Header variant="h2">Configuration summary</Header>}>
                  <SpaceBetween size="m">
                    <FormField label="Policy name">
                      <Box>{state.policyName || '—'}</Box>
                    </FormField>
                    <FormField label="Description">
                      <Box>{state.description || '—'}</Box>
                    </FormField>
                    <FormField label="Tags">
                      <Box>
                        {state.tags.filter(t => t.key && t.value).length > 0
                          ? state.tags
                              .filter(t => t.key && t.value)
                              .map(t => `${t.key}: ${t.value}`)
                              .join(', ')
                          : '—'}
                      </Box>
                    </FormField>
                    <FormField label="Regions">
                      <Box>
                        {state.selectedRegions.length > 0
                          ? state.selectedRegions.map(r => r.value).join(', ')
                          : '—'}
                      </Box>
                    </FormField>
                    <FormField label="Mode">
                      <Box>{state.mode === 'intersection' ? 'Intersection' : 'Union'}</Box>
                    </FormField>
                    <FormField label="Exceptions">
                      <Box>
                        {state.exceptions.length > 0
                          ? `${state.exceptions.length} exception${state.exceptions.length === 1 ? '' : 's'}`
                          : 'None'}
                      </Box>
                    </FormField>
                    <FormField label="Policy type">
                      <Box>{state.policyType === 'IAM' ? 'IAM Policy' : 'Service Control Policy (SCP)'}</Box>
                    </FormField>
                  </SpaceBetween>
                </Container>
                <Container header={<Header variant="h2">Allow-list preview</Header>}>
                  <SpaceBetween size="m">
                    {previewLoading ? (
                      <Box textAlign="center" color="text-status-inactive">
                        Loading preview...
                      </Box>
                    ) : (
                      <>
                        <SpaceBetween direction="horizontal" size="l">
                          <FormField label="Action count">
                            <Box variant="awsui-key-label">{previewActionCount}</Box>
                          </FormField>
                          <FormField label="Estimated policy size">
                            <Box variant="awsui-key-label">
                              {previewEstimatedSize > 0
                                ? `${previewEstimatedSize.toLocaleString()} characters`
                                : '—'}
                            </Box>
                          </FormField>
                        </SpaceBetween>
                        {previewSplitRequired && (
                          <Alert type="warning" header="Policy split required">
                            {state.policyType === 'IAM'
                              ? 'The allow-list exceeds the IAM policy size limit (6,144 characters). The policy will be split into multiple managed policies.'
                              : 'The allow-list exceeds the SCP size limit (5,120 characters). Consider reducing the scope or switching to IAM Policy mode.'}
                          </Alert>
                        )}
                        {previewActions.length > 0 && (
                          <Table
                            header={
                              <Header counter={`(${filteredPreviewActions.length})`}>
                                Allowed actions
                              </Header>
                            }
                            items={filteredPreviewActions.slice(0, 50)}
                            filter={
                              <TextFilter
                                filteringText={previewFilter}
                                onChange={({ detail }) => setPreviewFilter(detail.filteringText)}
                                filteringPlaceholder="Search actions"
                                countText={`${filteredPreviewActions.length} action${filteredPreviewActions.length === 1 ? '' : 's'}`}
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
                                No actions match the filter.
                              </Box>
                            }
                          />
                        )}
                        {previewActions.length === 0 && !previewLoading && (
                          <Box color="text-status-inactive">
                            No preview available. The preview will be generated when you reach this step.
                          </Box>
                        )}
                      </>
                    )}
                  </SpaceBetween>
                </Container>
              </SpaceBetween>
            ),
          },
        ]}
      />
    </ContentLayout>
  );
}
