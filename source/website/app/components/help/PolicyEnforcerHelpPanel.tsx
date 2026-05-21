import HelpPanel from '@cloudscape-design/components/help-panel';

export default function PolicyEnforcerHelpPanel() {
  return (
    <HelpPanel header={<h2>Policy Enforcer</h2>}>
      <h3>What is this?</h3>
      <p>
        Generate IAM policies scoped to specific regions. When attached to a role, they
        prevent your workload from calling APIs that don&apos;t exist in your target regions —
        catching region expansion failures before deploy time.
      </p>

      <h3>Workflow</h3>
      <ol>
        <li>Select your target regions.</li>
        <li>Choose <strong>Intersection</strong> (strict — only APIs available in ALL regions) or <strong>Union</strong> (permissive — APIs available in ANY region).</li>
        <li>Add exceptions for actions you always want allowed.</li>
        <li>Pick IAM Policy or SCP output format.</li>
        <li>Generate and attach the policy to your IAM roles.</li>
      </ol>

      <h3>Key concepts</h3>
      <ul>
        <li><strong>Intersection mode</strong> — Only allows actions available in every selected region. Use when your workload must run identically everywhere.</li>
        <li><strong>Union mode</strong> — Allows actions available in at least one selected region. Use when different regions serve different purposes.</li>
        <li><strong>Policy parts</strong> — If the allow-list exceeds IAM size limits (6,144 chars), it&apos;s automatically split into multiple managed policies.</li>
      </ul>
    </HelpPanel>
  );
}
