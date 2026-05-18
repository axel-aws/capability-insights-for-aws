import { useEffect, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Popover from '@cloudscape-design/components/popover';
import Tabs from '@cloudscape-design/components/tabs';
import Toggle from '@cloudscape-design/components/toggle';
import Input from '@cloudscape-design/components/input';
import Spinner from '@cloudscape-design/components/spinner';
import { PAGE_SETTINGS } from '~/constants/app';
import { capabilityInsightsClient } from '~/clients/capability-insights-client';
import type { SyncSettingsResponse } from '~/clients/capability-insights-client';
import { formatTimestamp } from '~/utils/time-utils';
import type { SyncMetadata } from '@capability-insights/shared/types/sync-metadata';
import { DataUploadSection } from '~/components/data-upload-section';
import { DatasetMergeSection } from '~/components/dataset-merge-section';
import { ExportSection } from '~/components/export-section';

import type { RouteHandle } from '~/types/route';

export const handle: RouteHandle = { pageName: PAGE_SETTINGS };

export function meta() {
  return [{ title: PAGE_SETTINGS }];
}

function ExternalDataSourcesContainer() {
  const [syncSettings, setSyncSettings] = useState<SyncSettingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [tokenValue, setTokenValue] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    capabilityInsightsClient
      .getSyncSettings()
      .then(setSyncSettings)
      .catch(() => {
        setNotification({ type: 'error', message: 'Failed to load sync settings.' });
      })
      .finally(() => setInitialLoading(false));
  }, []);

  const handleToggleChange = async (checked: boolean) => {
    if (checked) {
      // Turning ON: show token input if no token stored
      if (syncSettings?.hasToken) {
        // Token already stored, just enable
        setLoading(true);
        setNotification(null);
        try {
          const updated = await capabilityInsightsClient.updateSyncSettings({ terraformOverlayEnabled: true });
          setSyncSettings(updated);
          setNotification({ type: 'success', message: 'Terraform overlay enabled.' });
        } catch (e) {
          setNotification({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        } finally {
          setLoading(false);
        }
      } else {
        // No token stored, show input field
        setSyncSettings((prev) => (prev ? { ...prev, terraformOverlayEnabled: true } : prev));
        setShowTokenInput(true);
      }
    } else {
      // Turning OFF: immediately call API
      setLoading(true);
      setNotification(null);
      try {
        const updated = await capabilityInsightsClient.updateSyncSettings({ terraformOverlayEnabled: false });
        setSyncSettings(updated);
        setShowTokenInput(false);
        setTokenValue('');
        setNotification({ type: 'success', message: 'Terraform overlay disabled.' });
      } catch (e) {
        setNotification({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        setLoading(false);
      }
    }
  };

  const handleSaveToken = async () => {
    setLoading(true);
    setNotification(null);
    try {
      const updated = await capabilityInsightsClient.updateSyncSettings({
        terraformOverlayEnabled: true,
        githubToken: tokenValue,
      });
      setSyncSettings(updated);
      setShowTokenInput(false);
      setTokenValue('');
      setNotification({ type: 'success', message: 'Terraform overlay enabled with token saved.' });
    } catch (e) {
      setNotification({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  const handleReplaceToken = () => {
    setShowTokenInput(true);
    setTokenValue('');
  };

  if (initialLoading) {
    return (
      <Container header={<Header variant="h2">External data sources</Header>}>
        <Spinner size="normal" />
      </Container>
    );
  }

  const isToggleOn = syncSettings?.terraformOverlayEnabled ?? false;

  return (
    <Container header={<Header variant="h2">External data sources</Header>}>
      <SpaceBetween size="m">
        <SpaceBetween size="xs" direction="horizontal" alignItems="center">
          <Toggle
            onChange={({ detail }) => handleToggleChange(detail.checked)}
            checked={isToggleOn}
            disabled={loading}
          >
            Terraform overlay
          </Toggle>
          {loading && <Spinner size="normal" />}
        </SpaceBetween>

        {isToggleOn && syncSettings?.hasToken && !showTokenInput && (
          <SpaceBetween size="xs" direction="horizontal" alignItems="center">
            <Box variant="code">••••••••</Box>
            <Button onClick={handleReplaceToken} disabled={loading}>
              Replace token
            </Button>
          </SpaceBetween>
        )}

        {isToggleOn && (showTokenInput || (!syncSettings?.hasToken && isToggleOn)) && (
          <SpaceBetween size="xs">
            <Input
              value={tokenValue}
              onChange={({ detail }) => setTokenValue(detail.value)}
              placeholder="Enter GitHub personal access token"
              type="password"
              disabled={loading}
            />
            <Button onClick={handleSaveToken} disabled={loading || !tokenValue.trim()} variant="primary">
              Save
            </Button>
          </SpaceBetween>
        )}

        {notification && <Alert type={notification.type}>{notification.message}</Alert>}
      </SpaceBetween>
    </Container>
  );
}

function SettingsTabContent() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [syncMetadata, setSyncMetadata] = useState<SyncMetadata | null>(null);
  const [dataSyncEnabled, setDataSyncEnabled] = useState<boolean>(true);
  const [dataSyncLoading, setDataSyncLoading] = useState(false);
  const [dataSyncNotification, setDataSyncNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [syncSettings, setSyncSettings] = useState<SyncSettingsResponse | null>(null);

  useEffect(() => {
    capabilityInsightsClient.getLastSyncTime().then(setSyncMetadata);
    capabilityInsightsClient.getSyncSettings().then((settings) => {
      setSyncSettings(settings);
      setDataSyncEnabled(settings.dataSyncEnabled);
    });
  }, []);

  const handleSync = async () => {
    setLoading(true);
    setStatus('idle');
    try {
      await capabilityInsightsClient.syncCapabilityData();
      setStatus('success');
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDataSyncToggle = async (checked: boolean) => {
    setDataSyncLoading(true);
    setDataSyncNotification(null);
    try {
      const updated = await capabilityInsightsClient.updateSyncSettings({
        terraformOverlayEnabled: syncSettings?.terraformOverlayEnabled ?? false,
        dataSyncEnabled: checked,
      });
      setSyncSettings(updated);
      setDataSyncEnabled(updated.dataSyncEnabled);
      setDataSyncNotification({
        type: 'success',
        message: checked ? 'Scheduled data sync enabled.' : 'Scheduled data sync disabled.',
      });
    } catch (e) {
      setDataSyncNotification({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setDataSyncLoading(false);
    }
  };

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Data synchronization</Header>}>
        <SpaceBetween size="m">
          <Alert type="info">Data is automatically refreshed every 24 hours.</Alert>
          <SpaceBetween size="xs">
            <SpaceBetween size="xs" direction="horizontal" alignItems="center">
              <Toggle
                onChange={({ detail }) => handleDataSyncToggle(detail.checked)}
                checked={dataSyncEnabled}
                disabled={dataSyncLoading}
              >
                Scheduled data sync
              </Toggle>
              {dataSyncLoading && <Spinner size="normal" />}
            </SpaceBetween>
            <Box variant="small" color="text-body-secondary">
              When disabled, the daily scheduled sync from the S3 access point will not run. Manual sync using the button below is unaffected.
            </Box>
          </SpaceBetween>
          {dataSyncNotification && <Alert type={dataSyncNotification.type}>{dataSyncNotification.message}</Alert>}
          {syncMetadata?.errors?.length ? (
            <Popover
              dismissButton={false}
              position="bottom"
              size="large"
              content={
                <SpaceBetween size="xs">
                  {syncMetadata.errors.map((err, i) => (
                    <StatusIndicator key={i} type="error">
                      {err}
                    </StatusIndicator>
                  ))}
                </SpaceBetween>
              }
            >
              <StatusIndicator type="error">Sync completed with {syncMetadata.errors.length} error(s)</StatusIndicator>
            </Popover>
          ) : syncMetadata?.lastSyncTime ? (
            <StatusIndicator type="success">Last synced: {formatTimestamp(syncMetadata.lastSyncTime)}</StatusIndicator>
          ) : (
            <StatusIndicator type="pending">No sync has completed yet</StatusIndicator>
          )}
          {syncMetadata?.terraformOverlaySkipped && (
            <StatusIndicator type="info">Terraform overlay: disabled</StatusIndicator>
          )}
          <Box variant="small" color="text-body-secondary">
            If data appears outdated, use the button below to sync manually. This runs in the background and may take a
            few minutes. Refresh the page to see the update.
          </Box>
          <Button onClick={handleSync} loading={loading}>
            Sync capability data
          </Button>
          {status === 'success' && (
            <Alert type="success">
              Data sync has been triggered. It may take a few minutes for updated data to appear.
            </Alert>
          )}
          {status === 'error' && (
            <Alert type="error">
              <SpaceBetween size="xs">
                <Box>Failed to trigger data sync.</Box>
                <Box variant="small" color="text-body-secondary">
                  {errorMessage}
                </Box>
              </SpaceBetween>
            </Alert>
          )}
        </SpaceBetween>
      </Container>
      <ExternalDataSourcesContainer />
    </SpaceBetween>
  );
}

function UtilitiesTabContent() {
  return (
    <SpaceBetween size="l">
      <DataUploadSection />
      <DatasetMergeSection />
      <ExportSection />
    </SpaceBetween>
  );
}

export default function Settings() {
  return (
    <ContentLayout header={<Header variant="h1">{PAGE_SETTINGS}</Header>}>
      <Tabs
        tabs={[
          {
            id: 'settings',
            label: 'Settings',
            content: <SettingsTabContent />,
          },
          {
            id: 'utilities',
            label: 'Utilities',
            content: <UtilitiesTabContent />,
          },
        ]}
      />
    </ContentLayout>
  );
}
