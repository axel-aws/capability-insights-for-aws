import HelpPanel from '@cloudscape-design/components/help-panel';

export default function TerraformAwsHelpPanel() {
  return (
    <HelpPanel header={<h2>Terraform AWS availability</h2>}>
      <h3>How resource mappings are derived</h3>
      <p>
        Each Terraform AWS provider resource (e.g., <code>aws_lambda_function</code>) is mapped to the set of API
        operations it requires. These mappings are derived by parsing the HashiCorp Terraform AWS provider source code —
        specifically, the Go source files that implement each resource's CRUD lifecycle. The parser extracts SDK client
        method calls to identify which API operations a resource invokes.
      </p>

      <h3>Availability logic</h3>
      <p>
        A resource is shown as <strong>Available</strong> in a region only when <em>all</em> of its required API
        operations are available in that region. If any single required operation is missing, the resource is marked as{' '}
        <strong>Not Available</strong>. This AND-logic ensures the resource can be fully managed in that region.
      </p>

      <h3>Service attribution</h3>
      <p>
        Operations are attributed to their correct AWS service by cross-referencing against the authoritative API
        operations data — the same dataset shown in the API Operations view. This ensures accurate service ownership
        even when a resource calls operations across multiple services.
      </p>

      <h3>Tree hierarchy</h3>
      <p>
        The expanded view displays a three-level tree: <strong>Resource → SDK Service → API Operation</strong>. This
        lets you see exactly which services and operations a resource depends on and which are missing in a given region.
      </p>

      <h3>Data freshness</h3>
      <p>
        Resource-to-operation mappings are regenerated each time the Terraform overlay sync runs. Operation availability
        data refreshes every 24 hours from the authoritative source.
      </p>
    </HelpPanel>
  );
}
