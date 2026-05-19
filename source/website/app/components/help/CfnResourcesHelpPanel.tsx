import HelpPanel from '@cloudscape-design/components/help-panel';

/**
 * Help panel content explaining the CloudFormation/AWSCC resources methodology.
 *
 * Covers:
 * - AWSCC naming convention mapping
 * - How classic AWS provider types are mapped via the overlay
 * - How resource availability is determined from authoritative data
 */
export default function CfnResourcesHelpPanel() {
  return (
    <HelpPanel header={<h2>CloudFormation &amp; AWSCC Resources</h2>}>
      <p>
        This view shows AWS CloudFormation resource types and their regional availability.
        You can switch between CloudFormation and Terraform AWSCC naming conventions using
        the toggle above the table.
      </p>

      <h3>AWSCC Naming Convention</h3>
      <p>
        The Terraform AWSCC provider maps directly to CloudFormation resource types using a
        deterministic naming convention. For example, <code>AWS::S3::Bucket</code> becomes{' '}
        <code>awscc_s3_bucket</code>. The mapping converts the service and resource portions
        to lowercase with underscores separating them.
      </p>

      <h3>Classic AWS Provider Overlay</h3>
      <p>
        Some resources also have equivalents in the classic Terraform AWS provider (e.g.,{' '}
        <code>aws_s3_bucket</code>). The overlay data maps between CloudFormation types and
        their classic AWS provider counterparts where a mapping exists.
      </p>

      <h3>Availability Determination</h3>
      <p>
        Resource availability is determined from the authoritative AWS capability data,
        which refreshes every 24 hours from the source. A resource is shown as
        &ldquo;Available&rdquo; in a region when the underlying CloudFormation resource type
        is supported in that region according to the authoritative data.
      </p>
    </HelpPanel>
  );
}
