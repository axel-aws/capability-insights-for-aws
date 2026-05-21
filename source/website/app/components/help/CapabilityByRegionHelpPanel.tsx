import HelpPanel from '@cloudscape-design/components/help-panel';

export default function CapabilityByRegionHelpPanel() {
  return (
    <HelpPanel header={<h2>Capabilities by Region</h2>}>
      <h3>What is this?</h3>
      <p>
        A searchable matrix showing which AWS services, APIs, and CloudFormation resource
        types are available in which regions.
      </p>

      <h3>Status values</h3>
      <ul>
        <li><strong>Available</strong> — Generally available in that region.</li>
        <li><strong>Not Expanding</strong> — No plans to launch there.</li>
        <li><strong>Planning (date)</strong> — Launch is in progress for that quarter.</li>
        <li><strong>Not Available</strong> — Not yet available.</li>
      </ul>

      <h3>Filters</h3>
      <ul>
        <li><strong>Name</strong> — Filter by service or resource name.</li>
        <li><strong>Region status</strong> — Filter by availability in a specific region.</li>
        <li><strong>Plan</strong> — Show only services your Infrastructure Plan uses.</li>
        <li><strong>Stack</strong> — Show only resources in a deployed CloudFormation stack.</li>
      </ul>

      <h3>Export</h3>
      <p>Download the current view as JSON or CSV using the Export button above the table.</p>
    </HelpPanel>
  );
}
