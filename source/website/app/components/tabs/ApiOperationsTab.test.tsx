import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { ApiAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { UseClassicApiAvailabilityResult } from '~/hooks/use-classic-api-availability';
import { HelpPanelProvider } from '~/contexts/help-panel-context';
import ApiOperationsTab from './ApiOperationsTab';

// --- Test Data ---
const mockRegions: Region[] = [
  {
    Region: 'us-east-1',
    RegionLongName: 'US East (N. Virginia)',
    Partition: 'aws',
    RegionStatus: 'available',
    RequireRegionOptIn: false,
  },
];

// Top-level rows only (parentId: null) so they're visible in the treegrid
const mockApiRows: ApiAvailability[] = [
  {
    id: 'svc-s3',
    parentId: null,
    name: 'S3',
    regionalAvailabilityType: RegionalAvailabilityType.SDK_SERVICE,
    homepageUrl: 'https://docs.aws.amazon.com/s3',
    regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
  },
];

// Classic API rows: resource is top-level, service and operation are children
const mockClassicApiRows: ApiAvailability[] = [
  {
    id: 'res-aws_s3_bucket',
    parentId: null,
    name: 'aws_s3_bucket',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
    regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
  },
  {
    id: 'svc-s3-classic',
    parentId: 'res-aws_s3_bucket',
    name: 'S3',
    sdkServiceName: 'S3',
    regionalAvailabilityType: RegionalAvailabilityType.SDK_SERVICE,
    regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
  },
  {
    id: 'op-create-bucket-classic',
    parentId: 'svc-s3-classic',
    name: 'CreateBucket',
    regionalAvailabilityType: RegionalAvailabilityType.OPERATION,
    regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
  },
];

const mockClassicApi: UseClassicApiAvailabilityResult = {
  rows: mockClassicApiRows,
  loading: false,
  error: null,
  resourceCount: 1,
  serviceCount: 1,
};

const mockDownloadUrls = { json: '/data/json/apis.json', csv: '/data/csv/apis.csv' };

function renderWithProviders(ui: React.ReactElement) {
  const onToolsContentChange = vi.fn();
  const onToolsOpenChange = vi.fn();
  const result = render(
    <HelpPanelProvider onToolsContentChange={onToolsContentChange} onToolsOpenChange={onToolsOpenChange}>
      {ui}
    </HelpPanelProvider>,
  );
  return { ...result, onToolsContentChange, onToolsOpenChange };
}

describe('ApiOperationsTab', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('API Operations view (default)', () => {
    it('renders the API operations table when apiViewMode is api-operations', () => {
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="api-operations"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.getByText('API operations')).toBeInTheDocument();
    });

    it('renders SDK service names in API Operations view', () => {
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="api-operations"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // S3 is a top-level row (parentId: null) so it's visible
      expect(screen.getAllByText('S3').length).toBeGreaterThanOrEqual(1);
    });

    it('does not show info icon in API Operations view', () => {
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="api-operations"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.queryByLabelText('Info about Terraform AWS availability')).not.toBeInTheDocument();
    });
  });

  describe('Terraform AWS view', () => {
    it('renders the Terraform AWS resources table when apiViewMode is terraform-aws', () => {
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="terraform-aws"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.getByText('Terraform AWS resources')).toBeInTheDocument();
    });

    it('renders resource names with registry links', () => {
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="terraform-aws"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // aws_s3_bucket is a top-level row (parentId: null) so it's visible
      const links = screen.getAllByText('aws_s3_bucket');
      const link = links.find(el => el.closest('a'));
      expect(link).toBeDefined();
      expect(link!.closest('a')!.getAttribute('href')).toBe(
        'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket',
      );
    });

    it('shows info icon in Terraform AWS view', () => {
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="terraform-aws"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.getByLabelText('Info about Terraform AWS availability')).toBeInTheDocument();
    });

    it('opens help panel when info icon is clicked', () => {
      const { onToolsContentChange, onToolsOpenChange } = renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="terraform-aws"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      const infoButton = screen.getByLabelText('Info about Terraform AWS availability');
      act(() => {
        fireEvent.click(infoButton);
      });

      expect(onToolsContentChange).toHaveBeenCalled();
      expect(onToolsOpenChange).toHaveBeenCalledWith(true);
    });
  });

  describe('ApiViewSelector toggle', () => {
    it('renders the ApiViewSelector with both options', () => {
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="api-operations"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // SegmentedControl renders options with data-testid
      expect(screen.getByTestId('api-operations')).toBeInTheDocument();
      expect(screen.getByTestId('terraform-aws')).toBeInTheDocument();
    });

    it('calls onApiViewModeChange when Terraform AWS is clicked', () => {
      const onApiViewModeChange = vi.fn();
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="api-operations"
          onApiViewModeChange={onApiViewModeChange}
          downloadUrls={mockDownloadUrls}
        />,
      );

      const terraformOption = screen.getByTestId('terraform-aws');
      act(() => {
        fireEvent.click(terraformOption);
      });

      expect(onApiViewModeChange).toHaveBeenCalledWith('terraform-aws');
    });
  });

  describe('Error state', () => {
    it('shows error flashbar when classicApi has an error', () => {
      const classicApiWithError: UseClassicApiAvailabilityResult = {
        ...mockClassicApi,
        error: 'Network error',
      };

      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={classicApiWithError}
          apiViewMode="api-operations"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.getByText(/Failed to load Terraform classic API mapping: Network error/)).toBeInTheDocument();
    });

    it('does not show error flashbar when there is no error', () => {
      renderWithProviders(
        <ApiOperationsTab
          regions={mockRegions}
          loading={false}
          apiRows={mockApiRows}
          classicApi={mockClassicApi}
          apiViewMode="api-operations"
          onApiViewModeChange={() => {}}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.queryByText(/Failed to load Terraform classic API mapping/)).not.toBeInTheDocument();
    });
  });
});
