import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MissingApiPopover from './missing-api-popover';

describe('MissingApiPopover', () => {
  const defaultProps = {
    missingApis: ['S3:CreateBucket', 'S3:PutBucketPolicy'],
    resourceName: 'aws_s3_bucket',
    region: 'us-east-1',
  };

  describe('rendering', () => {
    it('renders "Not Available" status text', () => {
      render(<MissingApiPopover {...defaultProps} />);
      expect(screen.getAllByText('Not Available').length).toBeGreaterThanOrEqual(1);
    });

    it('renders an info icon as popover trigger when missingApis is non-empty', () => {
      const { container } = render(<MissingApiPopover {...defaultProps} />);
      // The Cloudscape Icon component renders SVGs; with popover + status indicator + info icon
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThanOrEqual(2);
    });

    it('renders without info icon when missingApis is empty', () => {
      const { container } = render(<MissingApiPopover {...defaultProps} missingApis={[]} />);
      // When empty, renders a plain StatusIndicator (no popover, no info icon)
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBe(1);
    });
  });

  describe('popover content', () => {
    it('displays all missing API operations on activation', () => {
      const { container } = render(<MissingApiPopover {...defaultProps} />);

      // Click the popover trigger
      const trigger = container.querySelector('span[style]');
      if (trigger) {
        fireEvent.click(trigger);
      }

      // The popover content should show the missing APIs (may appear multiple times due to Cloudscape rendering)
      expect(screen.getAllByText('S3:CreateBucket').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('S3:PutBucketPolicy').length).toBeGreaterThanOrEqual(1);
    });

    it('displays the region name in the popover header', () => {
      const { container } = render(<MissingApiPopover {...defaultProps} />);

      const trigger = container.querySelector('span[style]');
      if (trigger) {
        fireEvent.click(trigger);
      }

      expect(screen.getAllByText('Missing APIs in us-east-1').length).toBeGreaterThanOrEqual(1);
    });

    it('displays the resource name in the description', () => {
      const { container } = render(<MissingApiPopover {...defaultProps} />);

      const trigger = container.querySelector('span[style]');
      if (trigger) {
        fireEvent.click(trigger);
      }

      expect(
        screen.getAllByText('aws_s3_bucket requires the following unavailable operations:').length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('displays each missing API in {service}:{action} format', () => {
      const props = {
        missingApis: ['EC2:RunInstances', 'EC2:DescribeInstances', 'EC2:TerminateInstances'],
        resourceName: 'aws_instance',
        region: 'eu-west-1',
      };
      const { container } = render(<MissingApiPopover {...props} />);

      const trigger = container.querySelector('span[style]');
      if (trigger) {
        fireEvent.click(trigger);
      }

      expect(screen.getAllByText('EC2:RunInstances').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('EC2:DescribeInstances').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('EC2:TerminateInstances').length).toBeGreaterThanOrEqual(1);
    });

    it('shows all missing operations when multiple are unavailable', () => {
      const props = {
        missingApis: ['S3:CreateBucket', 'S3:PutBucketPolicy', 'S3:DeleteBucket', 'S3:HeadBucket'],
        resourceName: 'aws_s3_bucket',
        region: 'ap-southeast-1',
      };
      const { container } = render(<MissingApiPopover {...props} />);

      const trigger = container.querySelector('span[style]');
      if (trigger) {
        fireEvent.click(trigger);
      }

      expect(screen.getAllByText('S3:CreateBucket').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('S3:PutBucketPolicy').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('S3:DeleteBucket').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('S3:HeadBucket').length).toBeGreaterThanOrEqual(1);
    });
  });
});
