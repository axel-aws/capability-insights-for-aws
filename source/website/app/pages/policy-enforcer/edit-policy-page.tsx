import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Spinner from '@cloudscape-design/components/spinner';
import Form from '@cloudscape-design/components/form';
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';

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

export const PAGE_EDIT_POLICY = 'Edit Policy';

export const handle: RouteHandle = { pageName: PAGE_EDIT_POLICY };

export function meta() {
  return [
    { title: `${PAGE_EDIT_POLICY} - ${APP_NAME}` },
    { name: 'description', content: 'Edit policy configuration' },
  ];
}

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

  const { regionOptions, regions, regionsLoading } = useRegionOptions();

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
          <PolicyDetailsFields
            policyName={policyName}
            onPolicyNameChange={setPolicyName}
            description={description}
            onDescriptionChange={setDescription}
          />
          <RegionSelectionField
            selectedRegions={selectedRegions}
            onSelectedRegionsChange={setSelectedRegions}
            regionOptions={regionOptions}
            regions={regions}
            regionsLoading={regionsLoading}
          />
          <ComputationModeField mode={mode} onModeChange={setMode} />
          <ExceptionsField exceptions={exceptions} onExceptionsChange={setExceptions} />
          <PolicyTypeField policyType={policyType} onPolicyTypeChange={setPolicyType} />
        </SpaceBetween>
      </Form>
    </ContentLayout>
  );
}
