import { useEffect, useMemo, useState } from 'react';
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
import Flashbar from '@cloudscape-design/components/flashbar';
import type { PropertyFilterQuery } from '@cloudscape-design/collection-hooks';

import { APP_NAME, PAGE_CAPABILITY_BY_REGION } from '~/constants/app';
import type { Region } from '@capability-insights/shared/types/capability/region';
import { capabilityInsightsClient, DataFile } from '~/clients/capability-insights-client';
import type { SyncMetadata } from '@capability-insights/shared/types/sync-metadata';
import AvailabilityTable from '~/components/availability/availability-table';
import AvailabilityStatCard from '~/components/availability/availability-stat-card';
import RegionalAvailabilityTypeBadge from '~/components/availability/regional-availability-type-badge';
import ViewSelector from '~/components/availability/view-selector';
import ApiViewSelector from '~/components/availability/api-view-selector';
import type { ApiViewMode } from '~/components/availability/api-view-selector';
import { useTerraformOverlay } from '~/hooks/use-terraform-overlay';
import { useClassicApiAvailability } from '~/hooks/use-classic-api-availability';
import MissingApiPopover from '~/components/availability/missing-api-popover';
import { fromApiServices, fromCfnResources, fromProducts } from '~/mappers/regional-availability.mapper';
import { formatTimestamp } from '~/utils/time-utils';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import AvailabilityStatusIndicator from '~/components/availability/availability-status-indicator';
import type {
  ProductAvailability,
  ApiAvailability,
  CfnAvailability,
} from '@capability-insights/shared/types/availability/regional-availability';

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

  const overlay = useTerraformOverlay(cfnRows);
  const translatedCfnRows = overlay.translateRows(cfnRows);

  const [apiViewMode, setApiViewMode] = useState<ApiViewMode>('api-operations');
  const classicApi = useClassicApiAvailability(apiRows, regions);

  // Build a lookup for the Missing API Popover in the Terraform AWS view.
  // For each resource row that is "Not Available", we find its operation children
  // that are also "Not Available" in that region.
  const getResourceMissingApis = useMemo(() => {
    // Build parent→children index
    const childrenOf = new Map<string, ApiAvailability[]>();
    for (const row of classicApi.rows) {
      if (row.parentId) {
        const siblings = childrenOf.get(row.parentId) ?? [];
        siblings.push(row);
        childrenOf.set(row.parentId, siblings);
      }
    }

    return (resourceRow: ApiAvailability, regionCode: string): string[] => {
      const missing: string[] = [];
      const serviceName = resourceRow.sdkServiceName ?? '';
      // Get service children of the resource
      const serviceRows = childrenOf.get(resourceRow.id) ?? [];
      for (const serviceRow of serviceRows) {
        // Get operation children of the service
        const operationRows = childrenOf.get(serviceRow.id) ?? [];
        for (const opRow of operationRows) {
          const status = opRow.regionalAvailability?.[regionCode];
          if (status === AvailabilityStatus.NOT_AVAILABLE) {
            missing.push(`${serviceName}:${opRow.name}`);
          }
        }
      }
      return missing;
    };
  }, [classicApi.rows]);

  // Custom filtering function for the Terraform AWS view.
  // Uses filterTreeBySearch logic for free-text matching across all tree levels
  // (resource names, service names, operation names) with bidirectional tree traversal:
  // - Matching a resource shows it with all children (parent-to-child)
  // - Matching a child shows its ancestors (child-to-parent)
  // Also handles property-based tokens (region filters, type filters).
  const terraformFilteringFunction = useMemo(() => {
    const rows = classicApi.rows;
    const byId = new Map(rows.map(r => [r.id, r]));

    // Pre-compute parent→children index for efficient descendant lookups
    const childrenOf = new Map<string, ApiAvailability[]>();
    for (const row of rows) {
      if (row.parentId) {
        const siblings = childrenOf.get(row.parentId) ?? [];
        siblings.push(row);
        childrenOf.set(row.parentId, siblings);
      }
    }

    // Check if any descendant of the given item matches the query
    const hasMatchingDescendant = (itemId: string, lowerQuery: string): boolean => {
      const children = childrenOf.get(itemId);
      if (!children) return false;
      for (const child of children) {
        if (child.name.toLowerCase().includes(lowerQuery)) return true;
        if (hasMatchingDescendant(child.id, lowerQuery)) return true;
      }
      return false;
    };

    // Check if any ancestor of the given item matches the query
    const hasMatchingAncestor = (item: ApiAvailability, lowerQuery: string): boolean => {
      let current = item.parentId ? byId.get(item.parentId) : undefined;
      while (current) {
        if (current.name.toLowerCase().includes(lowerQuery)) return true;
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return false;
    };

    return (item: ApiAvailability, query: PropertyFilterQuery): boolean => {
      const tokens = query.tokenGroups ?? query.tokens;
      if (!tokens || tokens.length === 0) return true;

      // Extract free-text search strings from tokens (tokens without propertyKey)
      const freeTextValues: string[] = [];
      const propertyTokens: typeof tokens = [];

      for (const token of tokens) {
        if ('operation' in token) {
          // Token group — treat as property token for standard evaluation
          propertyTokens.push(token);
        } else if (!token.propertyKey) {
          // Free-text token
          const values = Array.isArray(token.value) ? token.value : [token.value];
          freeTextValues.push(...values.filter((v): v is string => typeof v === 'string'));
        } else {
          propertyTokens.push(token);
        }
      }

      // For free-text tokens, use tree-aware search logic:
      // An item is included if:
      // 1. Its own name matches (direct match)
      // 2. Any descendant's name matches (ancestor of a match — keeps tree navigable)
      // 3. Any ancestor's name matches (descendant of a match — shows all children)
      if (freeTextValues.length > 0) {
        const freeTextPass = freeTextValues[query.operation === 'or' ? 'some' : 'every'](searchText => {
          const lowerQuery = searchText.toLowerCase();

          // Direct match on this item's name
          if (item.name.toLowerCase().includes(lowerQuery)) return true;

          // Ancestor of a match: any descendant matches
          if (hasMatchingDescendant(item.id, lowerQuery)) return true;

          // Descendant of a match: any ancestor matches
          if (hasMatchingAncestor(item, lowerQuery)) return true;

          return false;
        });

        if (!freeTextPass) return false;
      }

      // For property-based tokens, apply standard evaluation
      if (propertyTokens.length > 0) {
        const propertyPass = propertyTokens[query.operation === 'or' ? 'some' : 'every'](token => {
          if ('operation' in token) return true; // Skip token groups for simplicity
          const typedToken = token as { propertyKey?: string; operator: string; value: string | string[] };
          if (!typedToken.propertyKey) return true;

          // Handle region-based filtering
          if (typedToken.propertyKey.startsWith('region:')) {
            const regionCode = typedToken.propertyKey.slice(7);
            const status = item.regionalAvailability?.[regionCode] ?? '';
            const values = Array.isArray(typedToken.value) ? typedToken.value : [typedToken.value];
            if (typedToken.operator === '=') return values.includes(status);
            if (typedToken.operator === '!=') return !values.includes(status);
            return false;
          }

          // Handle name filtering
          if (typedToken.propertyKey === 'name') {
            const values = Array.isArray(typedToken.value) ? typedToken.value : [typedToken.value];
            switch (typedToken.operator) {
              case '=': return values.includes(item.name);
              case '!=': return !values.includes(item.name);
              case ':': return values.some(v => item.name.toLowerCase().includes(v.toLowerCase()));
              case '!:': return !values.some(v => item.name.toLowerCase().includes(v.toLowerCase()));
              default: return false;
            }
          }

          // Handle type filtering
          if (typedToken.propertyKey === 'regionalAvailabilityType') {
            const values = Array.isArray(typedToken.value) ? typedToken.value : [typedToken.value];
            if (typedToken.operator === '=') return values.includes(item.regionalAvailabilityType);
            if (typedToken.operator === '!=') return !values.includes(item.regionalAvailabilityType);
            return false;
          }

          return true;
        });

        if (query.operation === 'and' && !propertyPass) return false;
        if (query.operation === 'or' && freeTextValues.length === 0 && !propertyPass) return false;
      }

      return true;
    };
  }, [classicApi.rows]);

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
                <AvailabilityTable
                  title="Services and features"
                  nameHeader="AWS Services"
                  regions={regions}
                  regionalAvailability={productRows}
                  downloadUrls={capabilityInsightsClient.exportUrls(DataFile.PRODUCTS)}
                  nameCell={row => (
                    <SpaceBetween direction="horizontal" size="xs">
                      {row.homepageUrl ? (
                        <Link href={row.homepageUrl} external>
                          {row.name}
                        </Link>
                      ) : (
                        <span>{row.name}</span>
                      )}
                      <RegionalAvailabilityTypeBadge type={row.regionalAvailabilityType} />
                    </SpaceBetween>
                  )}
                  loading={loading}
                  includePlanProperty
                />
              ),
            },
            {
              label: 'API operations',
              id: 'apis',
              content: (
                <SpaceBetween size="m">
                  <ApiViewSelector
                    selectedView={apiViewMode}
                    onChange={setApiViewMode}
                    loading={classicApi.loading}
                    disabled={!!classicApi.error}
                  />
                  {classicApi.error && (
                    <Flashbar
                      items={[
                        {
                          type: 'error',
                          content: `Failed to load Terraform classic API mapping: ${classicApi.error}`,
                          dismissible: true,
                          id: 'classic-api-mapping-error',
                        },
                      ]}
                    />
                  )}
                  {apiViewMode === 'api-operations' ? (
                    <AvailabilityTable
                      title="API operations"
                      nameHeader="AWS Services"
                      regions={regions}
                      regionalAvailability={apiRows}
                      downloadUrls={capabilityInsightsClient.exportUrls(DataFile.APIS)}
                      nameCell={row => (
                        <SpaceBetween direction="horizontal" size="xs">
                          {row.homepageUrl ? (
                            <Link href={row.homepageUrl} external>
                              {row.name}
                            </Link>
                          ) : (
                            <span>{row.name}</span>
                          )}
                          <RegionalAvailabilityTypeBadge type={row.regionalAvailabilityType} />
                        </SpaceBetween>
                      )}
                      loading={loading}
                      includePlanProperty
                    />
                  ) : (
                    <AvailabilityTable
                      title="Terraform AWS resources"
                      nameHeader="Terraform Resources"
                      regions={regions}
                      regionalAvailability={classicApi.rows}
                      downloadUrls={capabilityInsightsClient.exportUrls(DataFile.APIS)}
                      nameCell={row => {
                        const isResource = row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE;
                        const registryUrl = isResource && row.name.startsWith('aws_')
                          ? `https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/${row.name.slice(4)}`
                          : undefined;
                        return (
                          <SpaceBetween direction="horizontal" size="xs">
                            {registryUrl ? (
                              <Link href={registryUrl} external>
                                {row.name}
                              </Link>
                            ) : (
                              <span>{row.name}</span>
                            )}
                            <RegionalAvailabilityTypeBadge type={row.regionalAvailabilityType} />
                          </SpaceBetween>
                        );
                      }}
                      availabilityCell={(row, regionCode) => {
                        if (!row.regionalAvailability) return null;
                        const status = row.regionalAvailability[regionCode] as AvailabilityStatus | undefined;
                        // Show popover only for resource rows that are "Not Available"
                        if (
                          row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE &&
                          status === AvailabilityStatus.NOT_AVAILABLE
                        ) {
                          const missingApis = getResourceMissingApis(row, regionCode);
                          return (
                            <MissingApiPopover
                              missingApis={missingApis}
                              resourceName={row.name}
                              region={regionCode}
                            />
                          );
                        }
                        return (
                          <AvailabilityStatusIndicator
                            status={status ?? null}
                            launchDate={row.regionDates?.[regionCode]}
                          />
                        );
                      }}
                      loading={classicApi.loading}
                      customFilteringFunction={terraformFilteringFunction}
                    />
                  )}
                </SpaceBetween>
              ),
            },
            {
              label: cfnTabLabel,
              id: 'cfn',
              content: (
                <SpaceBetween size="m">
                  <ViewSelector
                    selectedConvention={overlay.convention}
                    onChange={overlay.setConvention}
                    loading={overlay.loading}
                    disabled={!!overlay.error}
                  />
                  {overlay.error && (
                    <Flashbar
                      items={[
                        {
                          type: 'error',
                          content: `Failed to load Terraform overlay: ${overlay.error}`,
                          dismissible: true,
                          id: 'terraform-overlay-error',
                        },
                      ]}
                    />
                  )}
                  <AvailabilityTable
                    title={cfnTabLabel}
                    nameHeader="AWS Resources"
                    regions={regions}
                    regionalAvailability={translatedCfnRows}
                    downloadUrls={capabilityInsightsClient.exportUrls(DataFile.CFN_RESOURCES)}
                    nameCell={row => {
                      let href = row.homepageUrl;
                      if (overlay.convention === 'terraform-awscc' && row.name.startsWith('awscc_')) {
                        href = `https://registry.terraform.io/providers/hashicorp/awscc/latest/docs/resources/${row.name.slice(6)}`;
                      }
                      return (
                        <SpaceBetween direction="horizontal" size="xs">
                          {href ? (
                            <Link href={href} external>
                              {row.name}
                            </Link>
                          ) : (
                            <span>{row.name}</span>
                          )}
                          <RegionalAvailabilityTypeBadge type={row.regionalAvailabilityType} />
                        </SpaceBetween>
                      );
                    }}
                    loading={loading}
                    includeStackProperty
                    includePlanProperty
                  />
                </SpaceBetween>
              ),
            },
          ]}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}
