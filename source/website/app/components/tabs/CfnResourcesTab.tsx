import SpaceBetween from '@cloudscape-design/components/space-between';
import Link from '@cloudscape-design/components/link';
import Flashbar from '@cloudscape-design/components/flashbar';

import type { CfnAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { ExportUrls } from '~/clients/capability-insights-client';
import type { PropertyFilterQuery } from '@cloudscape-design/collection-hooks';
import type { UseTerraformOverlayResult } from '~/hooks/use-terraform-overlay';
import AvailabilityTable from '~/components/availability/availability-table';
import RegionalAvailabilityTypeBadge from '~/components/availability/regional-availability-type-badge';
import ViewSelector from '~/components/availability/view-selector';

import type { SharedTabProps } from './ServicesAndFeaturesTab';

export interface CfnResourcesTabProps extends SharedTabProps {
  cfnRows: CfnAvailability[];
  overlay: UseTerraformOverlayResult;
  downloadUrls: ExportUrls;
  initialQuery?: PropertyFilterQuery;
  onFilterChange?: (query: PropertyFilterQuery) => void;
  headerActions?: React.ReactNode;
}

export default function CfnResourcesTab({
  regions,
  loading,
  cfnRows,
  overlay,
  downloadUrls,
  initialQuery,
  onFilterChange,
  headerActions: externalHeaderActions,
}: CfnResourcesTabProps) {
  const translatedCfnRows = overlay.translateRows(cfnRows);

  const cfnTabLabel =
    overlay.convention === 'cloudformation'
      ? 'CloudFormation resources'
      : 'Terraform AWSCC resources';

  return (
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
        downloadUrls={downloadUrls}
        initialQuery={initialQuery}
        onFilterChange={onFilterChange}
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
        headerActions={externalHeaderActions}
      />
    </SpaceBetween>
  );
}
