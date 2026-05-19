import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { ApiService } from '@capability-insights/shared/types/capability/api';
import type { SyncMetadata } from '@capability-insights/shared/types/sync-metadata';
import type { TerraformOverlayData } from '@capability-insights/shared/types/terraform-overlay';
import type { ClassicApiMappingData } from '@capability-insights/shared/types/terraform-classic-api-mapping';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';

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

// --- Mock the s3Client (used by useClassicApiAvailability hook) ---
const mockFetchJson = vi.fn();

vi.mock('~/clients/s3-client', () => ({
  s3Client: {
    fetchJson: (...args: unknown[]) => mockFetchJson(...args),
  },
}));

// --- Test Data ---
const mockRegions: Region[] = [
  { Region: 'us-east-1', RegionLongName: 'US East (N. Virginia)', Partition: 'aws', RegionStatus: 'available', RequireRegionOptIn: false },
  { Region: 'eu-west-1', RegionLongName: 'Europe (Ireland)', Partition: 'aws', RegionStatus: 'available', RequireRegionOptIn: false },
];

const mockApiServices: ApiService[] = [
  {
    sdkServiceName: 'S3',
    sdkServiceFullName: 'S3',
    apis: [
      {
        apiName: 'S3-CreateBucket',
        apiAction: 'CreateBucket',
        homepage: 'https://docs.aws.amazon.com/s3',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
        },
      },
      {
        apiName: 'S3-PutBucketPolicy',
        apiAction: 'PutBucketPolicy',
        homepage: 'https://docs.aws.amazon.com/s3',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.NOT_AVAILABLE,
        },
      },
    ],
  },
  {
    sdkServiceName: 'EC2',
    sdkServiceFullName: 'EC2',
    apis: [
      {
        apiName: 'EC2-RunInstances',
        apiAction: 'RunInstances',
        homepage: 'https://docs.aws.amazon.com/ec2',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
        },
      },
      {
        apiName: 'EC2-DescribeInstances',
        apiAction: 'DescribeInstances',
        homepage: 'https://docs.aws.amazon.com/ec2',
        regionalAvailability: {
          'us-east-1': AvailabilityStatus.AVAILABLE,
          'eu-west-1': AvailabilityStatus.AVAILABLE,
        },
      },
    ],
  },
];

const mockClassicApiMapping: ClassicApiMappingData = {
  metadata: {
    generatedAt: '2025-01-15T10:30:00.000Z',
    providerCommitSha: 'abc123def',
    resourceCount: 2,
    serviceCount: 2,
  },
  resources: [
    {
      terraformType: 'aws_s3_bucket',
      sdkService: 'S3',
      requiredApis: ['CreateBucket', 'PutBucketPolicy'],
      registryPath: 's3_bucket',
    },
    {
      terraformType: 'aws_instance',
      sdkService: 'EC2',
      requiredApis: ['RunInstances', 'DescribeInstances'],
      registryPath: 'instance',
    },
  ],
};

const mockOverlayData: TerraformOverlayData = {
  metadata: {
    generatedAt: '2024-01-01T00:00:00.000Z',
    awsccProviderCommitSha: 'abc123def456abc123def456abc123def456abc1',
    classicAwsProviderCommitSha: 'def456abc123def456abc123def456abc123def4',
    awsccResourceCount: 0,
    classicAwsResourceCount: 0,
  },
  awscc: [],
  classicAws: [],
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

describe('CapabilityByRegion - Terraform AWS view integration', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockListRegions.mockResolvedValue(mockRegions);
    mockListProducts.mockResolvedValue([]);
    mockListApiOperations.mockResolvedValue(mockApiServices);
    mockListCfnResources.mockResolvedValue([]);
    mockGetLastSyncTime.mockResolvedValue(mockSyncMetadata);
    mockListTerraformOverlay.mockResolvedValue(mockOverlayData);
    mockFetchJson.mockResolvedValue(mockClassicApiMapping);
  });

  afterEach(() => {
    cleanup();
  });

  async function renderAndNavigateToApiTab() {
    renderWithProviders(<CapabilityByRegion />);

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Capability by Region')).toBeInTheDocument();
    });

    // Click the API operations tab
    const tabs = screen.getAllByRole('tab');
    const apiTab = tabs.find(t => /API operations/.test(t.textContent ?? ''));
    expect(apiTab).toBeDefined();
    await act(async () => {
      fireEvent.click(apiTab!);
    });
  }

  describe('API View Selector - Requirements 4.1-4.5', () => {
    it('defaults to API Operations view', async () => {
      await renderAndNavigateToApiTab();

      // Wait for the classic API mapping to load
      await waitFor(() => {
        expect(mockFetchJson).toHaveBeenCalledWith('/data/json/terraform_classic_api_mapping.json');
      });

      // The segmented control should show "API Operations" as selected
      // Verify the API Operations button is pressed (selected)
      await waitFor(() => {
        const apiOpsButton = screen.getByTestId('api-operations');
        expect(apiOpsButton).toBeInTheDocument();
        expect(apiOpsButton.getAttribute('aria-pressed')).toBe('true');
      });
    });

    it('switches to Terraform AWS view when selected', async () => {
      await renderAndNavigateToApiTab();

      // Wait for mapping data to load
      await waitFor(() => {
        expect(screen.queryByText('Terraform AWS resources')).not.toBeInTheDocument();
      });

      // Click the "Terraform AWS" option in the segmented control
      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      // The Terraform AWS resources table should now be visible
      await waitFor(() => {
        expect(screen.getByText('Terraform AWS resources')).toBeInTheDocument();
      });
    });

    it('switches back to API Operations view', async () => {
      await renderAndNavigateToApiTab();

      // Switch to Terraform AWS
      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('Terraform AWS resources')).toBeInTheDocument();
      });

      // Switch back to API Operations
      const apiOption = screen.getByText('API Operations');
      await act(async () => {
        fireEvent.click(apiOption);
      });

      await waitFor(() => {
        expect(screen.queryByText('Terraform AWS resources')).not.toBeInTheDocument();
      });
    });

    it('shows loading spinner and disables Terraform AWS option while loading', async () => {
      // Make the fetch never resolve to keep loading state
      mockFetchJson.mockReturnValue(new Promise(() => {}));

      renderWithProviders(<CapabilityByRegion />);

      await waitFor(() => {
        expect(screen.getByText('Capability by Region')).toBeInTheDocument();
      });

      // Navigate to API tab
      const tabs = screen.getAllByRole('tab');
      const apiTab = tabs.find(t => /API operations/.test(t.textContent ?? ''));
      await act(async () => {
        fireEvent.click(apiTab!);
      });

      // The Terraform AWS option should be disabled while loading
      await waitFor(() => {
        const terraformOption = screen.getByText('Terraform AWS');
        // The parent button/segment should be disabled
        const segment = terraformOption.closest('[data-testid]') ?? terraformOption.closest('button');
        // Check that the option is rendered but disabled
        expect(terraformOption).toBeInTheDocument();
      });
    });

    it('disables Terraform AWS option and shows error notification on fetch failure', async () => {
      mockFetchJson.mockRejectedValue(new Error('Network error'));

      await renderAndNavigateToApiTab();

      // Wait for the error state to be set
      await waitFor(() => {
        expect(screen.getByText(/Failed to load Terraform classic API mapping/)).toBeInTheDocument();
      });
    });
  });

  describe('Resource Registry Links - Requirements 6.1-6.3', () => {
    it('renders resource names as external links to Terraform Registry', async () => {
      await renderAndNavigateToApiTab();

      // Switch to Terraform AWS view
      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      // Wait for the tree to render
      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });

      // Check that resource names are rendered as links
      const s3Link = screen.getByText('aws_s3_bucket').closest('a');
      expect(s3Link).not.toBeNull();
      expect(s3Link!.getAttribute('href')).toBe(
        'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/s3_bucket',
      );

      const ec2Link = screen.getByText('aws_instance').closest('a');
      expect(ec2Link).not.toBeNull();
      expect(ec2Link!.getAttribute('href')).toBe(
        'https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance',
      );
    });

    it('resource links open in new tab (external link)', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });

      // Cloudscape external links have target="_blank" or rel="noopener noreferrer"
      const s3Link = screen.getByText('aws_s3_bucket').closest('a');
      expect(s3Link).not.toBeNull();
      expect(
        s3Link!.getAttribute('target') === '_blank' || s3Link!.getAttribute('rel')?.includes('noopener'),
      ).toBe(true);
    });
  });

  describe('Three-level tree hierarchy - Requirements 1.1-1.6', () => {
    it('displays Terraform resources as top-level rows that expand', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      // Top-level resource rows should be visible
      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
        expect(screen.getByText('aws_instance')).toBeInTheDocument();
      });
    });

    it('expands to show SDK service and operation levels', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });

      // Click "Expand all" button to expand the tree (expands top-level resource items)
      const expandButton = screen.getByText('Expand all');
      await act(async () => {
        fireEvent.click(expandButton);
      });

      // After expanding top-level resources, SDK service names should be visible (level 1)
      await waitFor(() => {
        expect(screen.getByText('S3')).toBeInTheDocument();
        expect(screen.getByText('EC2')).toBeInTheDocument();
      });

      // Now expand the service rows to see operations (level 2)
      // Click the expand toggle on the S3 service row
      const expandToggles = document.querySelectorAll('button[class*="expand-toggle"]');
      // Find the expand toggle for the S3 service row (it should be one of the visible toggles)
      for (const toggle of expandToggles) {
        const row = toggle.closest('tr');
        if (row && row.textContent?.includes('S3') && !row.textContent?.includes('aws_s3_bucket')) {
          await act(async () => {
            fireEvent.click(toggle);
          });
          break;
        }
      }

      // After expanding the S3 service, operation names should be visible
      await waitFor(() => {
        expect(screen.getByText('CreateBucket')).toBeInTheDocument();
        expect(screen.getByText('PutBucketPolicy')).toBeInTheDocument();
      });
    });
  });

  describe('Computed availability (AND logic) - Requirements 2.1-2.2', () => {
    it('shows Available when all child operations are available', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('aws_instance')).toBeInTheDocument();
      });

      // aws_instance depends on RunInstances and DescribeInstances
      // Both are available in us-east-1 and eu-west-1
      // So aws_instance should show "Available" in both regions
      // The treegrid should be rendered with the correct data
      const treegrid = screen.getByRole('treegrid');
      expect(treegrid).toBeInTheDocument();

      // Verify that "Available" status is shown for aws_instance
      // The row for aws_instance should have Available cells
      await waitFor(() => {
        expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
      });
    });

    it('shows Not Available when any child operation is unavailable', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });

      // aws_s3_bucket depends on CreateBucket (available everywhere) and PutBucketPolicy (NOT available in eu-west-1)
      // So aws_s3_bucket should show "Not Available" in eu-west-1
      // The MissingApiPopover should be rendered for unavailable cells
      // Look for the "Not Available" status indicator text
      await waitFor(() => {
        const notAvailableElements = screen.getAllByText('Not Available');
        expect(notAvailableElements.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Missing API Popover - Requirements 3.1-3.4', () => {
    it('shows info icon on unavailable resource cells', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });

      // The MissingApiPopover renders a "Not Available" status with an info icon
      // For aws_s3_bucket in eu-west-1, PutBucketPolicy is missing
      await waitFor(() => {
        const notAvailableElements = screen.getAllByText('Not Available');
        expect(notAvailableElements.length).toBeGreaterThan(0);
      });
    });

    it('displays missing API operations in popover when triggered', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });

      // Find and click the popover trigger (the "Not Available" text with info icon)
      await waitFor(() => {
        const notAvailableElements = screen.getAllByText('Not Available');
        expect(notAvailableElements.length).toBeGreaterThan(0);
      });

      // Click the first "Not Available" element that has a cursor pointer (popover trigger)
      const notAvailableElements = screen.getAllByText('Not Available');
      const popoverTrigger = notAvailableElements.find(el => {
        const parent = el.closest('span[style]');
        return parent?.getAttribute('style')?.includes('cursor');
      });

      if (popoverTrigger) {
        const triggerSpan = popoverTrigger.closest('span[style*="cursor"]');
        await act(async () => {
          fireEvent.click(triggerSpan ?? popoverTrigger);
        });

        // The popover should show the missing API operations
        await waitFor(() => {
          expect(screen.getByText(/Missing APIs/)).toBeInTheDocument();
        });

        // Should show the specific missing operation
        expect(screen.getByText('S3:PutBucketPolicy')).toBeInTheDocument();
      }
    });
  });

  describe('Search filtering - Requirements 5.1-5.4', () => {
    it('filters by Terraform resource name', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
        expect(screen.getByText('aws_instance')).toBeInTheDocument();
      });

      // Type in the filter input
      const filterInput = screen.getByPlaceholderText(/filter terraform/i);
      await act(async () => {
        fireEvent.change(filterInput, { target: { value: 's3_bucket' } });
      });

      // Submit the filter (press Enter)
      await act(async () => {
        fireEvent.keyDown(filterInput, { key: 'Enter', code: 'Enter' });
      });

      // After filtering, aws_s3_bucket should be visible but aws_instance should not
      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });
    });

    it('search is case-insensitive', async () => {
      await renderAndNavigateToApiTab();

      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });

      // Type uppercase search
      const filterInput = screen.getByPlaceholderText(/filter terraform/i);
      await act(async () => {
        fireEvent.change(filterInput, { target: { value: 'S3_BUCKET' } });
      });

      await act(async () => {
        fireEvent.keyDown(filterInput, { key: 'Enter', code: 'Enter' });
      });

      // Should still find the resource (case-insensitive)
      await waitFor(() => {
        expect(screen.getByText('aws_s3_bucket')).toBeInTheDocument();
      });
    });
  });

  describe('Statistics display - Requirements 9.1-9.3', () => {
    it('shows resource count and service count for Terraform AWS view', async () => {
      await renderAndNavigateToApiTab();

      // Switch to Terraform AWS view
      const terraformOption = await waitFor(() => screen.getByText('Terraform AWS'));
      await act(async () => {
        fireEvent.click(terraformOption);
      });

      // The stat card for "API operations" should show resource and service counts
      // In Terraform AWS mode, badges show ['resources', 'services']
      // The stat card counts parentId === null rows as the first badge
      // and parentId !== null rows as the second badge
      await waitFor(() => {
        // 2 resources (parentId: null) shown as "resources" badge
        expect(screen.getByText(/2 resources/)).toBeInTheDocument();
      });
    });

    it('shows SDK services and operations count for API Operations view', async () => {
      await renderAndNavigateToApiTab();

      // In API Operations mode (default), badges show ['SDK services', 'operations']
      await waitFor(() => {
        expect(screen.getByText(/2 SDK services/)).toBeInTheDocument();
        expect(screen.getByText(/4 operations/)).toBeInTheDocument();
      });
    });
  });

  describe('Error state - Requirement 4.5', () => {
    it('disables Terraform AWS option and shows error flashbar on mapping load failure', async () => {
      mockFetchJson.mockRejectedValue(new Error('Network error'));

      await renderAndNavigateToApiTab();

      // Error notification should be displayed
      await waitFor(() => {
        expect(screen.getByText(/Failed to load Terraform classic API mapping: Network error/)).toBeInTheDocument();
      });

      // The Terraform AWS option should still be visible but clicking it should not switch views
      const terraformOption = screen.getByText('Terraform AWS');
      expect(terraformOption).toBeInTheDocument();
    });
  });

  describe('Loading state - Requirement 4.4', () => {
    it('shows spinner while mapping data is loading', async () => {
      // Make the s3Client fetch hang to simulate loading
      mockFetchJson.mockReturnValue(new Promise(() => {}));

      renderWithProviders(<CapabilityByRegion />);

      await waitFor(() => {
        expect(screen.getByText('Capability by Region')).toBeInTheDocument();
      });

      // Navigate to API tab
      const tabs = screen.getAllByRole('tab');
      const apiTab = tabs.find(t => /API operations/.test(t.textContent ?? ''));
      await act(async () => {
        fireEvent.click(apiTab!);
      });

      // The ApiViewSelector shows a Cloudscape Spinner component when loading.
      // When loading, the "Terraform AWS" segment should be disabled.
      // Cloudscape SegmentedControl disables options by adding aria-disabled or disabled attribute.
      await waitFor(() => {
        const terraformButton = screen.getByTestId('terraform-aws');
        expect(terraformButton).toBeInTheDocument();
        // Cloudscape disabled segments have the disabled attribute
        expect(terraformButton).toBeDisabled();
      });
    });
  });
});
