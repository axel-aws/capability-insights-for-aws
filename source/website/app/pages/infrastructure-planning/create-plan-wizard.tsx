import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import Wizard from '@cloudscape-design/components/wizard';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import TagEditor from '@cloudscape-design/components/tag-editor';
import Alert from '@cloudscape-design/components/alert';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Box from '@cloudscape-design/components/box';
import ContentLayout from '@cloudscape-design/components/content-layout';
import FileUpload from '@cloudscape-design/components/file-upload';
import Link from '@cloudscape-design/components/link';
import type { TagEditorProps } from '@cloudscape-design/components/tag-editor';

import { APP_NAME } from '~/constants/app';
import { infrastructurePlanningClient } from '~/clients/infrastructure-planning-client';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { PlanSourceType, PlanLabel } from '@capability-insights/shared/types/infrastructure-planning/plan-configuration';
import type { RouteHandle } from '~/types/route';

export const PAGE_CREATE_PLAN = 'Create Plan';

export const handle: RouteHandle = { pageName: PAGE_CREATE_PLAN };

export function meta() {
  return [
    { title: `${PAGE_CREATE_PLAN} - ${APP_NAME}` },
    { name: 'description', content: 'Create a new infrastructure plan' },
  ];
}

interface WizardState {
  sourceType: PlanSourceType;
  files: File[];
  repositoryUrl: string;
  planName: string;
  tags: ReadonlyArray<TagEditorProps.Tag>;
}

export default function CreatePlanWizard() {
  const navigate = useNavigate();

  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hasGitHubToken, setHasGitHubToken] = useState<boolean | null>(null);

  const [state, setState] = useState<WizardState>({
    sourceType: 'cloudformation',
    files: [],
    repositoryUrl: '',
    planName: '',
    tags: [],
  });

  // Check if GitHub PAT is configured
  useEffect(() => {
    capabilityInsightsClient
      .getSyncSettings()
      .then(settings => setHasGitHubToken(settings.hasToken))
      .catch(() => setHasGitHubToken(false));
  }, []);

  function getAcceptedFileTypes(): string {
    switch (state.sourceType) {
      case 'cloudformation':
        return '.yaml,.yml,.json';
      case 'terraform':
        return '.tf';
      default:
        return '';
    }
  }

  function getFileUploadDescription(): string {
    switch (state.sourceType) {
      case 'cloudformation':
        return 'Upload a CloudFormation template file (.yaml, .yml, or .json).';
      case 'terraform':
        return 'Upload a Terraform configuration file (.tf).';
      default:
        return '';
    }
  }

  function getSourceContentStepTitle(): string {
    switch (state.sourceType) {
      case 'cloudformation':
        return 'Upload CloudFormation template';
      case 'terraform':
        return 'Upload Terraform template';
      case 'github':
        return 'GitHub repository';
      default:
        return 'Provide source content';
    }
  }

  function validateSourceContent(): string | null {
    if (state.sourceType === 'github') {
      if (!state.repositoryUrl.trim()) {
        return 'Repository URL is required.';
      }
      const githubUrlPattern = /^https:\/\/github\.com\/[^/]+\/[^/]+$/;
      if (!githubUrlPattern.test(state.repositoryUrl.trim())) {
        return 'Please enter a valid GitHub repository URL (https://github.com/owner/repo).';
      }
    } else {
      if (state.files.length === 0) {
        return 'Please upload a template file.';
      }
    }
    return null;
  }

  function validatePlanName(): string | null {
    if (!state.planName.trim()) {
      return 'Plan name is required.';
    }
    return null;
  }

  async function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix (e.g., "data:application/json;base64,")
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const labels: PlanLabel[] = state.tags
        .filter(t => t.key && t.value)
        .map(t => ({ key: t.key!, value: t.value! }));

      let templateContent: string | undefined;
      let repositoryUrl: string | undefined;

      if (state.sourceType === 'github') {
        repositoryUrl = state.repositoryUrl.trim();
      } else {
        templateContent = await readFileAsBase64(state.files[0]);
      }

      const plan = await infrastructurePlanningClient.createPlan({
        planName: state.planName.trim(),
        sourceType: state.sourceType,
        labels: labels.length > 0 ? labels : undefined,
        templateContent,
        repositoryUrl,
      });

      navigate(`/infrastructure-planning/${plan.planId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to create plan.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleNavigate(event: { detail: { requestedStepIndex: number; reason: string } }) {
    const { requestedStepIndex, reason } = event.detail;

    // Validate current step before moving forward
    if (reason === 'next') {
      if (activeStepIndex === 1) {
        const sourceError = validateSourceContent();
        if (sourceError) {
          setSubmitError(sourceError);
          return;
        }
      }
      if (activeStepIndex === 2) {
        const nameError = validatePlanName();
        if (nameError) {
          setSubmitError(nameError);
          return;
        }
      }
    }

    setSubmitError(null);
    setActiveStepIndex(requestedStepIndex);
  }

  const sourceTypeLabel =
    state.sourceType === 'cloudformation'
      ? 'CloudFormation template'
      : state.sourceType === 'terraform'
        ? 'Terraform template'
        : 'GitHub repository';

  return (
    <ContentLayout
      header={
        <Header variant="h1" description="Upload an IaC template or point to a GitHub repository to create an infrastructure plan.">
          {PAGE_CREATE_PLAN}
        </Header>
      }
    >
      <Wizard
        i18nStrings={{
          stepNumberLabel: stepNumber => `Step ${stepNumber}`,
          collapsedStepsLabel: (stepNumber, stepsCount) => `Step ${stepNumber} of ${stepsCount}`,
          submitButton: 'Create plan',
          cancelButton: 'Cancel',
          previousButton: 'Previous',
          nextButton: 'Next',
          optional: 'optional',
        }}
        onNavigate={handleNavigate}
        activeStepIndex={activeStepIndex}
        onCancel={() => navigate('/infrastructure-planning')}
        onSubmit={handleSubmit}
        isLoadingNextStep={submitting}
        steps={[
          {
            title: 'Select source type',
            description: 'Choose the type of infrastructure source to analyze.',
            content: (
              <Container header={<Header variant="h2">Source type</Header>}>
                <FormField
                  label="Infrastructure source"
                  description="Select the type of infrastructure definition you want to analyze."
                >
                  <RadioGroup
                    value={state.sourceType}
                    onChange={({ detail }) => {
                      setState(prev => ({
                        ...prev,
                        sourceType: detail.value as PlanSourceType,
                        files: [],
                        repositoryUrl: '',
                      }));
                    }}
                    items={[
                      {
                        value: 'cloudformation',
                        label: 'CloudFormation template',
                        description: 'Upload a CloudFormation YAML or JSON template to extract AWS resource types.',
                      },
                      {
                        value: 'terraform',
                        label: 'Terraform template',
                        description: 'Upload a Terraform HCL file to extract AWS and AWSCC resource types.',
                      },
                      {
                        value: 'github',
                        label: 'GitHub repository',
                        description: 'Analyze a GitHub repository to extract AWS resource types and API operations from source code.',
                      },
                    ]}
                  />
                </FormField>
              </Container>
            ),
          },
          {
            title: getSourceContentStepTitle(),
            description: state.sourceType === 'github'
              ? 'Provide the GitHub repository URL to analyze.'
              : `Upload your ${state.sourceType === 'cloudformation' ? 'CloudFormation' : 'Terraform'} template file.`,
            content: (
              <Container header={<Header variant="h2">{getSourceContentStepTitle()}</Header>}>
                <SpaceBetween size="l">
                  {submitError && activeStepIndex === 1 && (
                    <Alert type="error">{submitError}</Alert>
                  )}
                  {state.sourceType === 'github' ? (
                    <SpaceBetween size="l">
                      {hasGitHubToken === false && (
                        <Alert type="warning" header="GitHub token not configured">
                          A GitHub Personal Access Token (PAT) is required to access repositories.
                          Please configure one in the{' '}
                          <Link href="/settings">Settings</Link> page before proceeding.
                        </Alert>
                      )}
                      <FormField
                        label="Repository URL"
                        description="Enter the full GitHub repository URL."
                        constraintText="Format: https://github.com/owner/repository"
                      >
                        <Input
                          value={state.repositoryUrl}
                          onChange={({ detail }) =>
                            setState(prev => ({ ...prev, repositoryUrl: detail.value }))
                          }
                          placeholder="https://github.com/owner/repository"
                          type="url"
                        />
                      </FormField>
                    </SpaceBetween>
                  ) : (
                    <FormField
                      label="Template file"
                      description={getFileUploadDescription()}
                    >
                      <FileUpload
                        value={state.files}
                        onChange={({ detail }) =>
                          setState(prev => ({ ...prev, files: detail.value }))
                        }
                        accept={getAcceptedFileTypes()}
                        i18nStrings={{
                          uploadButtonText: e => (e ? 'Choose files' : 'Choose file'),
                          dropzoneText: e => (e ? 'Drop files to upload' : 'Drop file to upload'),
                          removeFileAriaLabel: e => `Remove file ${e + 1}`,
                          limitShowFewer: 'Show fewer files',
                          limitShowMore: 'Show more files',
                          errorIconAriaLabel: 'Error',
                        }}
                        constraintText={`Accepted file types: ${getAcceptedFileTypes()}`}
                        showFileSize
                        showFileLastModified
                      />
                    </FormField>
                  )}
                </SpaceBetween>
              </Container>
            ),
          },
          {
            title: 'Name and metadata',
            description: 'Provide a name and optional metadata labels for your plan.',
            content: (
              <SpaceBetween size="l">
                {submitError && activeStepIndex === 2 && (
                  <Alert type="error">{submitError}</Alert>
                )}
                <Container header={<Header variant="h2">Plan details</Header>}>
                  <FormField
                    label="Plan name"
                    description="A unique name to identify this infrastructure plan."
                    constraintText="Required. Must be unique across all plans."
                  >
                    <Input
                      value={state.planName}
                      onChange={({ detail }) =>
                        setState(prev => ({ ...prev, planName: detail.value }))
                      }
                      placeholder="e.g., Payment Service Infrastructure"
                    />
                  </FormField>
                </Container>
                <Container header={<Header variant="h2">Metadata labels</Header>}>
                  <TagEditor
                    i18nStrings={{
                      keyPlaceholder: 'Enter key',
                      valuePlaceholder: 'Enter value',
                      addButton: 'Add new label',
                      removeButton: 'Remove',
                      undoButton: 'Undo',
                      undoPrompt: 'This label will be removed',
                      loading: 'Loading suggestions',
                      keyHeader: 'Key',
                      valueHeader: 'Value',
                      optional: 'optional',
                      keySuggestion: 'Custom label key',
                      valueSuggestion: 'Custom label value',
                      emptyTags: 'No metadata labels added.',
                      tagLimit: (availableTags, _tagLimit) =>
                        availableTags === 1
                          ? 'You can add up to 1 more label.'
                          : `You can add up to ${availableTags} more labels.`,
                      tagLimitReached: (_tagLimit) => 'You have reached the label limit.',
                      tagLimitExceeded: (_tagLimit) => 'You have exceeded the label limit.',
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
            title: 'Review and create',
            description: 'Review your configuration and create the infrastructure plan.',
            content: (
              <SpaceBetween size="l">
                {submitError && activeStepIndex === 3 && (
                  <Alert type="error" header="Failed to create plan">
                    {submitError}
                  </Alert>
                )}
                <Container header={<Header variant="h2">Configuration summary</Header>}>
                  <SpaceBetween size="m">
                    <FormField label="Plan name">
                      <Box>{state.planName || '—'}</Box>
                    </FormField>
                    <FormField label="Source type">
                      <Box>{sourceTypeLabel}</Box>
                    </FormField>
                    <FormField label="Source">
                      <Box>
                        {state.sourceType === 'github'
                          ? state.repositoryUrl || '—'
                          : state.files.length > 0
                            ? state.files[0].name
                            : '—'}
                      </Box>
                    </FormField>
                    <FormField label="Metadata labels">
                      <Box>
                        {state.tags.filter(t => t.key && t.value).length > 0
                          ? state.tags
                              .filter(t => t.key && t.value)
                              .map(t => `${t.key}: ${t.value}`)
                              .join(', ')
                          : 'None'}
                      </Box>
                    </FormField>
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
