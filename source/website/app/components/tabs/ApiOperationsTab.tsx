import { useMemo } from 'react';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Link from '@cloudscape-design/components/link';
import Flashbar from '@cloudscape-design/components/flashbar';
import Button from '@cloudscape-design/components/button';
import type { PropertyFilterQuery } from '@cloudscape-design/collection-hooks';

import type { ApiAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { ExportUrls } from '~/clients/capability-insights-client';
import type { UseClassicApiAvailabilityResult } from '~/hooks/use-classic-api-availability';
import type { ApiViewMode } from '~/components/availability/api-view-selector';
import AvailabilityTable from '~/components/availability/availability-table';
import ApiViewSelector from '~/components/availability/api-view-selector';
import RegionalAvailabilityTypeBadge from '~/components/availability/regional-availability-type-badge';
import AvailabilityStatusIndicator from '~/components/availability/availability-status-indicator';
import MissingApiPopover from '~/components/availability/missing-api-popover';
import TerraformAwsHelpPanel from '~/components/help/TerraformAwsHelpPanel';
import { useHelpPanel } from '~/contexts/help-panel-context';

import type { SharedTabProps } from './ServicesAndFeaturesTab';

export interface ApiOperationsTabProps extends SharedTabProps {
  apiRows: ApiAvailability[];
  classicApi: UseClassicApiAvailabilityResult;
  apiViewMode: ApiViewMode;
  onApiViewModeChange: (mode: ApiViewMode) => void;
  downloadUrls: ExportUrls;
  initialQuery?: PropertyFilterQuery;
  onFilterChange?: (query: PropertyFilterQuery) => void;
  headerActions?: React.ReactNode;
}

export default function ApiOperationsTab({
  regions,
  loading,
  apiRows,
  classicApi,
  apiViewMode,
  onApiViewModeChange,
  downloadUrls,
  initialQuery,
  onFilterChange,
  headerActions,
}: ApiOperationsTabProps) {
  const { setToolsContent, setToolsOpen } = useHelpPanel();

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
      // Get service children of the resource
      const serviceRows = childrenOf.get(resourceRow.id) ?? [];
      for (const serviceRow of serviceRows) {
        // Use the service row's name (the actual SDK service) for the prefix
        const svcName = serviceRow.sdkServiceName ?? serviceRow.name ?? '';
        // Get operation children of the service
        const operationRows = childrenOf.get(serviceRow.id) ?? [];
        for (const opRow of operationRows) {
          const status = opRow.regionalAvailability?.[regionCode];
          if (status === AvailabilityStatus.NOT_AVAILABLE) {
            missing.push(`${svcName}:${opRow.name}`);
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
      const propertyTokens: Array<(typeof tokens)[number]> = [];

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

  return (
    <SpaceBetween size="m">
      <SpaceBetween direction="horizontal" size="xs">
        <ApiViewSelector
          selectedView={apiViewMode}
          onChange={onApiViewModeChange}
          loading={classicApi.loading}
          disabled={!!classicApi.error}
        />
        {apiViewMode === 'terraform-aws' && (
          <Button
            iconName="status-info"
            variant="icon"
            ariaLabel="Info about Terraform AWS availability"
            onClick={() => {
              setToolsContent(<TerraformAwsHelpPanel />);
              setToolsOpen(true);
            }}
          />
        )}
      </SpaceBetween>
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
          downloadUrls={downloadUrls}
          initialQuery={initialQuery}
          onFilterChange={onFilterChange}
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
          headerActions={headerActions}
        />
      ) : (
        <AvailabilityTable
          title="Terraform AWS resources"
          nameHeader="Terraform Resources"
          regions={regions}
          regionalAvailability={classicApi.rows}
          downloadUrls={downloadUrls}
          initialQuery={initialQuery}
          onFilterChange={onFilterChange}
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
          includePlanProperty
          headerActions={headerActions}
        />
      )}
    </SpaceBetween>
  );
}
