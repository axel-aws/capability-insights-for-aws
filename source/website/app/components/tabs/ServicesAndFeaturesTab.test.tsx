import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Region } from '@capability-insights/shared/types/capability/region';
import type { ProductAvailability } from '@capability-insights/shared/types/availability/regional-availability';
import { RegionalAvailabilityType } from '@capability-insights/shared/types/availability/regional-availability';
import { AvailabilityStatus } from '@capability-insights/shared/types/availability/availability-status';
import ServicesAndFeaturesTab from './ServicesAndFeaturesTab';

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

// Use only top-level rows (parentId: null) so they are visible in the treegrid without expanding
const mockProductRows: ProductAvailability[] = [
  {
    id: 'svc-1',
    parentId: null,
    name: 'Amazon S3',
    regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
    homepageUrl: 'https://aws.amazon.com/s3/',
    productType: 'Service',
    regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
  },
  {
    id: 'svc-2',
    parentId: null,
    name: 'Amazon EC2',
    regionalAvailabilityType: RegionalAvailabilityType.SERVICE,
    productType: 'Service',
    regionalAvailability: { 'us-east-1': AvailabilityStatus.AVAILABLE },
  },
];

const mockDownloadUrls = { json: '/data/json/products.json', csv: '/data/csv/products.csv' };

describe('ServicesAndFeaturesTab', () => {
  it('renders the table with title "Services and features"', () => {
    render(
      <ServicesAndFeaturesTab
        regions={mockRegions}
        loading={false}
        productRows={mockProductRows}
        downloadUrls={mockDownloadUrls}
      />,
    );

    expect(screen.getByText('Services and features')).toBeInTheDocument();
  });

  it('renders product rows with service names', () => {
    render(
      <ServicesAndFeaturesTab
        regions={mockRegions}
        loading={false}
        productRows={mockProductRows}
        downloadUrls={mockDownloadUrls}
      />,
    );

    // Services are top-level rows, visible without expanding
    expect(screen.getAllByText('Amazon S3').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Amazon EC2').length).toBeGreaterThanOrEqual(1);
  });

  it('renders homepage links for rows with homepageUrl', () => {
    render(
      <ServicesAndFeaturesTab
        regions={mockRegions}
        loading={false}
        productRows={mockProductRows}
        downloadUrls={mockDownloadUrls}
      />,
    );

    // Amazon S3 has a homepageUrl, so it should be rendered as a link
    const s3Links = screen.getAllByText('Amazon S3');
    const s3Link = s3Links.find(el => el.closest('a'));
    expect(s3Link).toBeDefined();
    expect(s3Link!.closest('a')!.getAttribute('href')).toBe('https://aws.amazon.com/s3/');
  });

  it('renders plain text for rows without homepageUrl', () => {
    render(
      <ServicesAndFeaturesTab
        regions={mockRegions}
        loading={false}
        productRows={mockProductRows}
        downloadUrls={mockDownloadUrls}
      />,
    );

    // EC2 has no homepageUrl, so it should be rendered as a span (not a link)
    const ec2Elements = screen.getAllByText('Amazon EC2');
    const ec2Span = ec2Elements.find(el => el.tagName.toLowerCase() === 'span' && !el.closest('a'));
    expect(ec2Span).toBeDefined();
  });

  it('renders type badges for each row', () => {
    render(
      <ServicesAndFeaturesTab
        regions={mockRegions}
        loading={false}
        productRows={mockProductRows}
        downloadUrls={mockDownloadUrls}
      />,
    );

    // RegionalAvailabilityTypeBadge renders the type text — both rows are "Service"
    expect(screen.getAllByText('Service').length).toBeGreaterThanOrEqual(2);
  });

  it('passes loading state to the table', () => {
    render(
      <ServicesAndFeaturesTab
        regions={mockRegions}
        loading={true}
        productRows={[]}
        downloadUrls={mockDownloadUrls}
      />,
    );

    // AvailabilityTable uses loadingText="Loading data"
    expect(screen.getByText('Loading data')).toBeInTheDocument();
  });
});
