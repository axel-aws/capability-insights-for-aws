import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { CfnAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import type { UseTerraformOverlayResult } from '~/hooks/use-terraform-overlay';
import { HelpPanelProvider } from '~/contexts/help-panel-context';
import CfnResourcesTab from './CfnResourcesTab';

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

// Use top-level rows (parentId: null) so they're visible in the treegrid
const mockCfnRows: CfnAvailability[] = [
  {
    id: 'res-s3-bucket',
    parentId: null,
    name: 'AWS::S3::Bucket',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
    serviceName: 'S3',
    homepageUrl: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-s3-bucket.html',
    regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
  },
  {
    id: 'res-ec2-instance',
    parentId: null,
    name: 'AWS::EC2::Instance',
    regionalAvailabilityType: RegionalAvailabilityType.RESOURCE_TYPE,
    serviceName: 'EC2',
    regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
  },
];

const mockDownloadUrls = { json: '/data/json/cfn_resources.json', csv: '/data/csv/cfn_resources.csv' };

function createMockOverlay(convention: 'cloudformation' | 'terraform-awscc' = 'cloudformation'): UseTerraformOverlayResult {
  return {
    convention,
    setConvention: vi.fn(),
    loading: false,
    error: null,
    translateRows: (rows: CfnAvailability[]) => {
      if (convention === 'terraform-awscc') {
        return rows.map(row => {
          if (row.regionalAvailabilityType === RegionalAvailabilityType.RESOURCE_TYPE && row.name.startsWith('AWS::')) {
            // Simulate AWSCC translation: AWS::S3::Bucket -> awscc_s3_bucket
            const parts = row.name.replace('AWS::', '').split('::');
            const tfName = `awscc_${parts.map(p => p.toLowerCase()).join('_')}`;
            return { ...row, name: tfName, cfnName: row.name };
          }
          return row;
        });
      }
      return rows;
    },
    searchAllConventions: (rows: CfnAvailability[]) => rows,
    getResourceCount: () => mockCfnRows.length,
  };
}

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

describe('CfnResourcesTab', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('CloudFormation convention (default)', () => {
    it('renders the table with title "CloudFormation resources"', () => {
      const overlay = createMockOverlay('cloudformation');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.getByText('CloudFormation resources')).toBeInTheDocument();
    });

    it('renders CFN resource type names', () => {
      const overlay = createMockOverlay('cloudformation');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // Top-level rows are visible in the treegrid
      expect(screen.getAllByText('AWS::S3::Bucket').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('AWS::EC2::Instance').length).toBeGreaterThanOrEqual(1);
    });

    it('renders homepage links for resources with homepageUrl', () => {
      const overlay = createMockOverlay('cloudformation');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      const links = screen.getAllByText('AWS::S3::Bucket');
      const link = links.find(el => el.closest('a'));
      expect(link).toBeDefined();
      expect(link!.closest('a')!.getAttribute('href')).toContain('docs.aws.amazon.com');
    });
  });

  describe('Terraform AWSCC convention', () => {
    it('renders the table with title "Terraform AWSCC resources"', () => {
      const overlay = createMockOverlay('terraform-awscc');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.getByText('Terraform AWSCC resources')).toBeInTheDocument();
    });

    it('renders translated AWSCC resource names', () => {
      const overlay = createMockOverlay('terraform-awscc');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.getAllByText('awscc_s3_bucket').length).toBeGreaterThanOrEqual(1);
    });

    it('renders Terraform Registry links for AWSCC resources', () => {
      const overlay = createMockOverlay('terraform-awscc');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      const links = screen.getAllByText('awscc_s3_bucket');
      const link = links.find(el => el.closest('a'));
      expect(link).toBeDefined();
      expect(link!.closest('a')!.getAttribute('href')).toBe(
        'https://registry.terraform.io/providers/hashicorp/awscc/latest/docs/resources/s3_bucket',
      );
    });
  });

  describe('ViewSelector toggle', () => {
    it('renders the ViewSelector with both convention options', () => {
      const overlay = createMockOverlay('cloudformation');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // Cloudscape SegmentedControl renders with role="toolbar"
      const segmentedControl = screen.getByRole('toolbar');
      expect(segmentedControl).toBeInTheDocument();
    });

    it('calls overlay.setConvention when Terraform AWSCC is clicked', () => {
      const overlay = createMockOverlay('cloudformation');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // Find and click the Terraform AWSCC segment
      const awsccSegment = screen.getByText('Terraform AWSCC');
      act(() => {
        fireEvent.click(awsccSegment);
      });

      expect(overlay.setConvention).toHaveBeenCalledWith('terraform-awscc');
    });
  });

  describe('Info icon and help panel', () => {
    it('renders the info icon button', () => {
      const overlay = createMockOverlay('cloudformation');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // There may be multiple "Info" buttons; verify at least one exists
      const infoButtons = screen.getAllByLabelText('Info');
      expect(infoButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('opens help panel when info icon is clicked', () => {
      const overlay = createMockOverlay('cloudformation');
      const { onToolsContentChange, onToolsOpenChange } = renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // Click the first "Info" button (the one we added in the header)
      const infoButtons = screen.getAllByLabelText('Info');
      act(() => {
        fireEvent.click(infoButtons[0]);
      });

      expect(onToolsContentChange).toHaveBeenCalled();
      expect(onToolsOpenChange).toHaveBeenCalledWith(true);
    });
  });

  describe('Error state', () => {
    it('shows error flashbar when overlay has an error', () => {
      const overlay: UseTerraformOverlayResult = {
        ...createMockOverlay('cloudformation'),
        error: 'Failed to fetch overlay data',
      };

      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.getByText(/Failed to load Terraform overlay: Failed to fetch overlay data/)).toBeInTheDocument();
    });

    it('does not show error flashbar when there is no error', () => {
      const overlay = createMockOverlay('cloudformation');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={false}
          cfnRows={mockCfnRows}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      expect(screen.queryByText(/Failed to load Terraform overlay/)).not.toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('passes loading state to the table', () => {
      const overlay = createMockOverlay('cloudformation');
      renderWithProviders(
        <CfnResourcesTab
          regions={mockRegions}
          loading={true}
          cfnRows={[]}
          overlay={overlay}
          downloadUrls={mockDownloadUrls}
        />,
      );

      // AvailabilityTable uses loadingText="Loading data"
      expect(screen.getByText('Loading data')).toBeInTheDocument();
    });
  });
});
