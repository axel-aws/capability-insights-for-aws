import { useEffect, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Tabs from '@cloudscape-design/components/tabs';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Link from '@cloudscape-design/components/link';
import Popover from '@cloudscape-design/components/popover';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Container from '@cloudscape-design/components/container';
import Button from '@cloudscape-design/components/button';

import { APP_NAME, PAGE_CAPABILITY_BY_REGION } from '~/constants/app';
import type { Region } from '@capability-insights/shared/types/capability/region';
import { capabilityInsightsClient, DataFile } from '~/clients/capability-insights-client';
import type { SyncMetadata } from '@capability-insights/shared/types/sync-metadata';
import AvailabilityStatCard from '~/components/availability/availability-stat-card';
import type { ApiViewMode } from '~/components/availability/api-view-selector';
import { useTerraformOverlay } from '~/hooks/use-terraform-overlay';
import { useClassicApiAvailability } from '~/hooks/use-classic-api-availability';
import { fromApiServices, fromCfnResources, fromProducts } from '~/mappers/regional-availability.mapper';
import { formatTimestamp } from '~/utils/time-utils';
import type {
  ProductAvailability,
  ApiAvailability,
  CfnAvailability,
} from '@capability-insights/shared/types/availability/regional-availability';

import ServicesAndFeaturesTab from '~/components/tabs/ServicesAndFeaturesTab';
import ApiOperationsTab from '~/components/tabs/ApiOperationsTab';
import CfnResourcesTab from '~/components/tabs/CfnResourcesTab';

import type { RouteHandle } from '~/types/route';

export const handle: RouteHandle = { pageName: PAGE_CAPABILITY_BY_REGION };

export function meta() {
  return [{ title: APP_NAME }, { name: 'description', content: 'AWS regional availability dashboard' }];
}

export default function CapabilityByRegion() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [productRows, setProductRows] = useState<ProductAvailability[]>([]);
  const [apiRows, setApiRows] = useState<ApiAvailability[]>([]);
  const [cfnRows, setCfnRows] = useState<CfnAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncMetadata, setSyncMetadata] = useState<SyncMetadata | null>(null);

  useEffect(() => {
    async function load() {
      const [r, p, a, c, syncMetadataResult] = await Promise.all([
        capabilityInsightsClient.listRegions(),
        capabilityInsightsClient.listProducts(),
        capabilityInsightsClient.listApiOperations(),
        capabilityInsightsClient.listCfnResources(),
        capabilityInsightsClient.getLastSyncTime(),
      ]);
      setRegions(r);
      setProductRows(fromProducts(p));
      setApiRows(fromApiServices(a));
      setCfnRows(fromCfnResources(c));
      setSyncMetadata(syncMetadataResult);
      setLoading(false);
    }
    load();
  }, []);

  // Hooks needed for stat cards and tab labels — called at page level
  const overlay = useTerraformOverlay(cfnRows);
  const translatedCfnRows = overlay.translateRows(cfnRows);

  const [apiViewMode, setApiViewMode] = useState<ApiViewMode>('api-operations');
  const classicApi = useClassicApiAvailability(apiRows, regions);

  const [showWelcome, setShowWelcome] = useState(
    () => localStorage.getItem('capabilityInsights_onboardingDismissed') !== 'true',
  );

  const handleDismissWelcome = () => {
    setShowWelcome(false);
    localStorage.setItem('capabilityInsights_onboardingDismissed', 'true');
  };

  const cfnTabLabel =
    overlay.convention === 'cloudformation'
      ? 'CloudFormation resources'
      : 'Terraform AWSCC resources';

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="Browse regional availability data for AWS services, API operations, and CloudFormation resource types."
          actions={
            syncMetadata?.errors?.length ? (
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
                    <Link href="/settings" variant="primary" fontSize="body-s">
                      Go to settings
                    </Link>
                  </SpaceBetween>
                }
              >
                <StatusIndicator type="error">
                  Sync completed with {syncMetadata.errors.length} error(s)
                </StatusIndicator>
              </Popover>
            ) : syncMetadata?.lastSyncTime ? (
              <Popover
                dismissButton={false}
                position="bottom"
                size="small"
                content={
                  <SpaceBetween size="xs">
                    <StatusIndicator type="success">{formatTimestamp(syncMetadata.lastSyncTime)}</StatusIndicator>
                    <Box variant="small" color="text-body-secondary">
                      Data refreshes automatically every 24 hours.
                    </Box>
                    <Link href="/settings" variant="primary" fontSize="body-s">
                      Sync manually
                    </Link>
                  </SpaceBetween>
                }
              >
                Last sync: {formatTimestamp(syncMetadata.lastSyncTime)}
              </Popover>
            ) : undefined
          }
        >
          {PAGE_CAPABILITY_BY_REGION}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {showWelcome && (
          <Container
            header={
              <Header
                variant="h2"
                actions={<Button variant="icon" iconName="close" onClick={handleDismissWelcome} ariaLabel="Dismiss welcome" />}
              >
                Welcome to Capability Insights for AWS
              </Header>
            }
          >
            <SpaceBetween size="m">
              <Box variant="p">
                Understand what&apos;s available where across AWS. Browse regional availability for every AWS service, API, and CloudFormation resource type — then use that data to plan and protect your deployments.
              </Box>
              <ColumnLayout columns={3}>
                <Container>
                  <SpaceBetween size="xs">
                    <Box variant="h3">Browse Availability</Box>
                    <Box variant="p" color="text-body-secondary">
                      Search and filter availability data for 160+ AWS services across 39 regions.
                    </Box>
                    <Box><Link href="/" variant="primary">Browse capabilities</Link></Box>
                  </SpaceBetween>
                </Container>
                <Container>
                  <SpaceBetween size="xs">
                    <Box variant="h3">Plan Your Infrastructure</Box>
                    <Box variant="p" color="text-body-secondary">
                      Upload a template or connect a repo to see where YOUR stack will work.
                    </Box>
                    <Box><Link href="/infrastructure-planning" variant="primary">Go to Infrastructure Planning</Link></Box>
                  </SpaceBetween>
                </Container>
                <Container>
                  <SpaceBetween size="xs">
                    <Box variant="h3">Enforce Region Safety</Box>
                    <Box variant="p" color="text-body-secondary">
                      Generate IAM policies that prevent calls to APIs unavailable in your target regions.
                    </Box>
                    <Box><Link href="/policy-enforcer" variant="primary">Go to Policy Enforcer</Link></Box>
                  </SpaceBetween>
                </Container>
              </ColumnLayout>
            </SpaceBetween>
          </Container>
        )}

        <ColumnLayout columns={4} variant="text-grid">
          <AvailabilityStatCard
            label="Services &amp; features"
            loading={loading}
            badges={['services', 'features']}
            rows={productRows}
          />
          <AvailabilityStatCard
            label="API operations"
            loading={loading}
            badges={apiViewMode === 'terraform-aws' ? ['resources', 'services'] : ['SDK services', 'operations']}
            rows={apiViewMode === 'terraform-aws' ? classicApi.rows : apiRows}
          />
          <AvailabilityStatCard
            label="CloudFormation resources"
            loading={loading}
            badges={['services', 'resource types']}
            rows={translatedCfnRows}
          />
          <div>
            <Box variant="awsui-key-label">Regions</Box>
            <Box variant="p">{loading ? 'Loading…' : <Badge>{regions.length.toLocaleString()} regions</Badge>}</Box>
          </div>
        </ColumnLayout>

        <Tabs
          tabs={[
            {
              label: 'Services and features',
              id: 'products',
              content: (
                <ServicesAndFeaturesTab
                  regions={regions}
                  loading={loading}
                  productRows={productRows}
                  downloadUrls={capabilityInsightsClient.exportUrls(DataFile.PRODUCTS)}
                />
              ),
            },
            {
              label: 'API operations',
              id: 'apis',
              content: (
                <ApiOperationsTab
                  regions={regions}
                  loading={loading}
                  apiRows={apiRows}
                  classicApi={classicApi}
                  apiViewMode={apiViewMode}
                  onApiViewModeChange={setApiViewMode}
                  downloadUrls={capabilityInsightsClient.exportUrls(DataFile.APIS)}
                />
              ),
            },
            {
              label: cfnTabLabel,
              id: 'cfn',
              content: (
                <CfnResourcesTab
                  regions={regions}
                  loading={loading}
                  cfnRows={cfnRows}
                  overlay={overlay}
                  downloadUrls={capabilityInsightsClient.exportUrls(DataFile.CFN_RESOURCES)}
                />
              ),
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
