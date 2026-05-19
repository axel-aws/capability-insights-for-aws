import SpaceBetween from '@cloudscape-design/components/space-between';
import Link from '@cloudscape-design/components/link';

import type { Region } from '@capability-insights/shared/types/capability/region';
import type { ProductAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import type { ExportUrls } from '~/clients/capability-insights-client';
import AvailabilityTable from '~/components/availability/availability-table';
import RegionalAvailabilityTypeBadge from '~/components/availability/regional-availability-type-badge';

export interface SharedTabProps {
  regions: Region[];
  loading: boolean;
}

export interface ServicesAndFeaturesTabProps extends SharedTabProps {
  productRows: ProductAvailability[];
  downloadUrls: ExportUrls;
}

export default function ServicesAndFeaturesTab({
  regions,
  loading,
  productRows,
  downloadUrls,
}: ServicesAndFeaturesTabProps) {
  return (
    <AvailabilityTable
      title="Services and features"
      nameHeader="AWS Services"
      regions={regions}
      regionalAvailability={productRows}
      downloadUrls={downloadUrls}
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
    />
  );
}
