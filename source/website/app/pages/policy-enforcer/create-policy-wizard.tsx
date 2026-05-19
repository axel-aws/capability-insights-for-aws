import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import Wizard from '@cloudscape-design/components/wizard';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Table from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import Box from '@cloudscape-design/components/box';
import ContentLayout from '@cloudscape-design/components/content-layout';
import FormField from '@cloudscape-design/components/form-field';
import Alert from '@cloudscape-design/components/alert';
import TagEditor from '@cloudscape-design/components/tag-editor';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';
import type { TagEditorProps } from '@cloudscape-design/components/tag-editor';

import { APP_NAME } from '~/constants/app';
import { policyEnforcerClient } from '~/clients/policy-enforcer-client';
import type { CreatePolicyRequest, ExceptionEntry } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';
import type { RouteHandle } from '~/types/route';
import {
  PolicyDetailsFields,
  RegionSelectionField,
  ComputationModeField,
  PolicyTypeField,
  ExceptionsField,
  useRegionOptions,
} from './components/policy-form-fields';

export const PAGE_CREATE_POLICY = 'Create Policy';

export const handle: RouteHandle = { pageName: PAGE_CREATE_POLICY };

export function meta() {
  return [
    { title: `${PAGE_CREATE_POLICY} - ${APP_NAME}` },
    { name: 'description', content: 'Create a new policy configuration' },
  ];
}

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

  const [state, setState] = useState<WizardState>({
    policyName: '',
    description: '',
    tags: [],
    selectedRegions: [],
    mode: 'intersection',
    exceptions: [],
    policyType: 'IAM',
  });

  const { regionOptions, regionsLoading } = useRegionOptions();

  // Preview state
  const [previewActions, setPreviewActions] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewActionCount, setPreviewActionCount] = useState(0);
  const [previewEstimatedSize, setPreviewEstimatedSize] = useState(0);
  const [previewSplitRequired, setPreviewSplitRequired] = useState(false);
  const [previewFilter, setPreviewFilter] = useState('');

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const request = buildCreateRequest();
      const tempPolicy = await policyEnforcerClient.createPolicy(request);
      try {
        const preview = await policyEnforcerClient.previewPolicy(tempPolicy.policyId);
        setPreviewActions(preview.actions);
        setPreviewActionCount(preview.actionCount);
        setPreviewEstimatedSize(preview.estimatedPolicySize);
        setPreviewSplitRequired(preview.splitRequired);
      } finally {
        await policyEnforcerClient.deletePolicy(tempPolicy.policyId);
      }
    } catch {
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
    if (requestedStepIndex === 5) {
      loadPreview();
    }
    setActiveStepIndex(requestedStepIndex);
  }

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
                <PolicyDetailsFields
                  policyName={state.policyName}
                  onPolicyNameChange={v => setState(prev => ({ ...prev, policyName: v }))}
                  description={state.description}
                  onDescriptionChange={v => setState(prev => ({ ...prev, description: v }))}
                />
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
                      tagLimit: (availableTags) =>
                        availableTags === 1
                          ? 'You can add up to 1 more tag.'
                          : `You can add up to ${availableTags} more tags.`,
                      tagLimitReached: () => 'You have reached the tag limit.',
                      tagLimitExceeded: () => 'You have exceeded the tag limit.',
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
              <RegionSelectionField
                selectedRegions={state.selectedRegions}
                onSelectedRegionsChange={opts => setState(prev => ({ ...prev, selectedRegions: opts }))}
                regionOptions={regionOptions}
                regionsLoading={regionsLoading}
              />
            ),
          },
          {
            title: 'Computation mode',
            description: 'Choose how capabilities are evaluated across selected regions.',
            content: (
              <ComputationModeField
                mode={state.mode}
                onModeChange={m => setState(prev => ({ ...prev, mode: m }))}
              />
            ),
          },
          {
            title: 'Exceptions',
            description: 'Add manual exceptions to always include in the allow-list.',
            content: (
              <ExceptionsField
                exceptions={state.exceptions}
                onExceptionsChange={excs => setState(prev => ({ ...prev, exceptions: excs }))}
              />
            ),
          },
          {
            title: 'Policy type',
            description: 'Choose the type of policy to generate.',
            content: (
              <PolicyTypeField
                policyType={state.policyType}
                onPolicyTypeChange={t => setState(prev => ({ ...prev, policyType: t }))}
              />
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
