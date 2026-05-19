import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import type { TerraformOverlayData } from '@capability-insights/shared/types/terraform-overlay';
import type { CfnResource } from '@capability-insights/shared/types/capability/cfn';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { SyncMetadata } from '@capability-insights/shared/types/sync-metadata';

// --- Mock the capability insights client ---
const mockListRegions = vi.fn();
const mockListProducts = vi.fn();
const mockListApiOperations = vi.fn();
const mockListCfnResources = vi.fn();
const mockGetLastSyncTime = vi.fn();
const mockListTerraformOverlay = vi.fn();
const mockExportUrls = vi.fn().mockReturnValue({ json: '/data.json', csv: '/data.csv' });

vi.mock('~/clients/capability-insights-client', () => ({
  capabilityInsightsClient: {
    listRegions: (...args: unknown[]) => mockListRegions(...args),
    listProducts: (...args: unknown[]) => mockListProducts(...args),
    listApiOperations: (...args: unknown[]) => mockListApiOperations(...args),
    listCfnResources: (...args: unknown[]) => mockListCfnResources(...args),
    getLastSyncTime: (...args: unknown[]) => mockGetLastSyncTime(...args),
    listTerraformOverlay: (...args: unknown[]) => mockListTerraformOverlay(...args),
    exportUrls: (...args: unknown[]) => mockExportUrls(...args),
  },
  DataFile: { PRODUCTS: 'products', APIS: 'apis', CFN_RESOURCES: 'cfn_resources' },
}));

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

const mockCfnResources: CfnResource[] = [
  {
    serviceName: 'S3',
    resourceTypes: [
      {
        resourceTypeName: 'AWS::S3::Bucket',
        resourceTypeHomepage: 'https://docs.aws.amazon.com/s3',
        regionalAvailability: { 'us-east-1': 'AVAILABLE' },
      },
    ],
  },
  {
    serviceName: 'EC2',
    resourceTypes: [
      {
        resourceTypeName: 'AWS::EC2::Instance',
        resourceTypeHomepage: 'https://docs.aws.amazon.com/ec2',
        regionalAvailability: { 'us-east-1': 'AVAILABLE' },
      },
    ],
  },
];

const mockOverlayData: TerraformOverlayData = {
  metadata: {
    generatedAt: '2024-01-01T00:00:00.000Z',
    awsccProviderCommitSha: 'abc123def456abc123def456abc123def456abc1',
    classicAwsProviderCommitSha: 'def456abc123def456abc123def456abc123def4',
    awsccResourceCount: 2,
    classicAwsResourceCount: 3,
  },
  awscc: [
    { terraformType: 'awscc_s3_bucket', cfnType: 'AWS::S3::Bucket' },
    { terraformType: 'awscc_ec2_instance', cfnType: 'AWS::EC2::Instance' },
  ],
  classicAws: [
    { terraformType: 'aws_s3_bucket', cfnType: 'AWS::S3::Bucket' },
    { terraformType: 'aws_instance', cfnType: 'AWS::EC2::Instance' },
    { terraformType: 'aws_vpc_peering', cfnType: null },
  ],
};

const mockSyncMetadata: SyncMetadata = {
  lastSyncTime: '2024-01-01T12:00:00.000Z',
};

// --- Import the component under test (after mocks are set up) ---
import CapabilityByRegion from './capability-by-region';
import { HelpPanelProvider } from '~/contexts/help-panel-context';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <HelpPanelProvider onToolsContentChange={() => {}} onToolsOpenChange={() => {}}>
      {ui}
    </HelpPanelProvider>
  );
}

describe('CapabilityByRegion page with overlay integration', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockListRegions.mockResolvedValue(mockRegions);
    mockListProducts.mockResolvedValue([]);
    mockListApiOperations.mockResolvedValue([]);
    mockListCfnResources.mockResolvedValue(mockCfnResources);
    mockGetLastSyncTime.mockResolvedValue(mockSyncMetadata);
    mockListTerraformOverlay.mockResolvedValue(mockOverlayData);
  });

  describe('View Selector rendering - Requirement 5.1', () => {
    it('calls listTerraformOverlay to fetch overlay data', async () => {
      renderWithProviders(<CapabilityByRegion />);

      await waitFor(() => {
        expect(mockListTerraformOverlay).toHaveBeenCalled();
      });
    });

    it('renders the page with CloudFormation tab', async () => {
      renderWithProviders(<CapabilityByRegion />);

      await waitFor(() => {
        expect(screen.getByText('Capabilities by Region')).toBeInTheDocument();
      });

      // The CFN tab should be present
      const tabs = screen.getAllByRole('tab');
      const cfnTab = tabs.find(t => /CloudFormation resources/.test(t.textContent ?? ''));
      expect(cfnTab).toBeDefined();
    });
  });

  describe('Error state - Requirements 5.5', () => {
    it('shows error notification when overlay fails to load', async () => {
      mockListTerraformOverlay.mockResolvedValue(null);

      renderWithProviders(<CapabilityByRegion />);

      // Navigate to CFN tab
      await waitFor(() => {
        const tabs = screen.getAllByRole('tab');
        const cfnTab = tabs.find(t => /CloudFormation resources/.test(t.textContent ?? ''));
        expect(cfnTab).toBeDefined();
      });

      const tabs = screen.getAllByRole('tab');
      const cfnTab = tabs.find(t => /CloudFormation resources/.test(t.textContent ?? ''));
      await act(async () => {
        fireEvent.click(cfnTab!);
      });

      await waitFor(() => {
        expect(screen.getByText(/Failed to load Terraform overlay/)).toBeInTheDocument();
      });
    });

    it('still displays CloudFormation names when overlay fails', async () => {
      mockListTerraformOverlay.mockResolvedValue(null);

      renderWithProviders(<CapabilityByRegion />);

      await waitFor(() => {
        const tabs = screen.getAllByRole('tab');
        const cfnTab = tabs.find(t => /CloudFormation resources/.test(t.textContent ?? ''));
        expect(cfnTab).toBeDefined();
      });

      const tabs = screen.getAllByRole('tab');
      const cfnTab = tabs.find(t => /CloudFormation resources/.test(t.textContent ?? ''));
      await act(async () => {
        fireEvent.click(cfnTab!);
      });

      // The table renders with service names as parent rows and resource types as children.
      // Verify the service names (parent rows) are visible - these are always shown.
      await waitFor(() => {
        expect(screen.getByText('S3')).toBeInTheDocument();
      });
      expect(screen.getByText('EC2')).toBeInTheDocument();
    });
  });
});
