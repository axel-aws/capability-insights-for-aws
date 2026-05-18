import Popover from '@cloudscape-design/components/popover';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Box from '@cloudscape-design/components/box';
import Icon from '@cloudscape-design/components/icon';

export interface MissingApiPopoverProps {
  missingApis: string[]; // e.g., ["S3:CreateBucket", "S3:PutBucketPolicy"]
  resourceName: string;
  region: string;
}

/**
 * Popover that displays the list of missing (unavailable) API operations
 * for a Terraform resource in a specific region.
 *
 * Triggered by an info icon next to the "Not Available" status indicator.
 */
export default function MissingApiPopover({ missingApis, resourceName, region }: MissingApiPopoverProps) {
  if (missingApis.length === 0) {
    return <StatusIndicator type="error">Not Available</StatusIndicator>;
  }

  return (
    <Popover
      dismissButton={false}
      position="top"
      size="medium"
      triggerType="custom"
      content={
        <SpaceBetween size="xs">
          <Box variant="h4">
            Missing APIs in {region}
          </Box>
          <Box variant="small" color="text-body-secondary">
            {resourceName} requires the following unavailable operations:
          </Box>
          <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
            {missingApis.map(api => (
              <li key={api}>
                <Box variant="code">{api}</Box>
              </li>
            ))}
          </ul>
        </SpaceBetween>
      }
    >
      <span style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <StatusIndicator type="error">Not Available</StatusIndicator>
        <Icon name="status-info" size="small" />
      </span>
    </Popover>
  );
}
