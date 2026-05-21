import HelpPanel from '@cloudscape-design/components/help-panel';

export default function InfrastructurePlanningHelpPanel() {
  return (
    <HelpPanel header={<h2>Infrastructure Planning</h2>}>
      <h3>What is this?</h3>
      <p>
        Upload CloudFormation or Terraform templates (or connect a GitHub repo) to extract
        the AWS services your infrastructure depends on. The extracted services become a
        filter on the Capabilities by Region page, showing you exactly where your stack
        will work.
      </p>

      <h3>Supported sources</h3>
      <ul>
        <li><strong>CloudFormation</strong> — YAML or JSON templates. Resource types are extracted directly.</li>
        <li><strong>Terraform</strong> — HCL files. AWS provider resources are mapped to their CloudFormation equivalents.</li>
        <li><strong>GitHub</strong> — Provide a repository URL to scan for templates automatically.</li>
      </ul>

      <h3>Using plans as filters</h3>
      <p>
        After creating a plan, go to the Capabilities by Region page and add a
        &ldquo;Plan&rdquo; filter token. The table will show only the services and resources
        your plan uses, making it easy to check regional availability for your specific stack.
      </p>
    </HelpPanel>
  );
}
