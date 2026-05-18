import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import ExpandableSection from '@cloudscape-design/components/expandable-section';

import type { PolicyPart } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

export interface AttachmentInstructionsProps {
  parts: PolicyPart[];
  policyType: 'IAM' | 'SCP';
  policyName: string;
}

/**
 * Generate a CDK TypeScript snippet that attaches multiple managed policy ARNs to a role.
 */
function generateMultiPolicyCdkSnippet(arns: string[], policyName: string): string {
  const imports = `import * as iam from 'aws-cdk-lib/aws-iam';`;
  const arnLines = arns
    .map(
      (arn, i) =>
        `  role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, '${policyName}-${i}', '${arn}'));`,
    )
    .join('\n');

  return `${imports}\n\n// Attach all policy parts to the role for complete coverage\n${arnLines}\n`;
}

/**
 * Generate a CloudFormation YAML snippet that includes all ARNs in ManagedPolicyArns.
 */
function generateMultiPolicyCfnSnippet(arns: string[]): string {
  const arnLines = arns.map((arn) => `        - ${arn}`).join('\n');

  return `Resources:\n  MyRole:\n    Type: AWS::IAM::Role\n    Properties:\n      ManagedPolicyArns:\n${arnLines}\n`;
}

/**
 * Extracts the SCP ID from an SCP ARN.
 * SCP ARN format: arn:aws:organizations::ACCOUNT_ID:policy/o-ORGID/service_control_policy/p-SCPID
 */
function extractScpId(arn: string): string {
  const parts = arn.split('/');
  return parts[parts.length - 1] || arn;
}

/**
 * Displays attachment instructions for policy parts.
 * Shows multi-part warnings, copyable ARN lists, and type-specific
 * code snippets (CDK/CloudFormation for IAM, OU instructions for SCP).
 */
export default function AttachmentInstructions({
  parts,
  policyType,
  policyName,
}: AttachmentInstructionsProps) {
  const arns = parts.map((part) => part.arn);
  const isMultiPart = parts.length > 1;

  if (parts.length === 0) {
    return (
      <Container header={<Header variant="h3">Attachment Instructions</Header>}>
        <Alert type="info">
          No policy parts are available yet. Trigger a refresh to generate the IAM managed
          policies before attaching them.
        </Alert>
      </Container>
    );
  }

  return (
    <Container header={<Header variant="h3">Attachment Instructions</Header>}>
      <SpaceBetween size="l">
        {isMultiPart && (
          <Alert type="warning" header="Multiple policy parts must be attached">
            This policy configuration has been split into {parts.length} managed policies due
            to IAM size limits. You must attach <strong>all</strong> policy parts to the target
            IAM role for complete regional governance coverage. Missing any part will leave gaps
            in your deny policy.
          </Alert>
        )}

        {!isMultiPart && policyType === 'IAM' && (
          <Alert type="info">
            Attach this managed policy to your target IAM role to enforce regional governance.
          </Alert>
        )}

        {/* Copyable ARN list */}
        <SpaceBetween size="xs">
          <Box variant="awsui-key-label">
            Policy ARN{isMultiPart ? 's' : ''}
          </Box>
          {arns.map((arn, index) => (
            <CopyToClipboard
              key={arn}
              variant="inline"
              textToCopy={arn}
              copySuccessText="ARN copied"
              copyErrorText="Failed to copy ARN"
              copyButtonAriaLabel={`Copy policy ARN ${index + 1}`}
            />
          ))}
        </SpaceBetween>

        {/* IAM-specific: CDK and CloudFormation snippets */}
        {policyType === 'IAM' && (
          <>
            <ExpandableSection headerText="CDK snippet" variant="footer">
              <SpaceBetween size="s">
                <Box variant="code">
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '12px',
                      lineHeight: '1.5',
                    }}
                  >
                    {generateMultiPolicyCdkSnippet(arns, policyName)}
                  </pre>
                </Box>
                <CopyToClipboard
                  variant="button"
                  textToCopy={generateMultiPolicyCdkSnippet(arns, policyName)}
                  copyButtonText="Copy CDK snippet"
                  copySuccessText="CDK snippet copied"
                  copyErrorText="Failed to copy snippet"
                  copyButtonAriaLabel="Copy CDK code snippet"
                />
              </SpaceBetween>
            </ExpandableSection>

            <ExpandableSection headerText="CloudFormation snippet" variant="footer">
              <SpaceBetween size="s">
                <Box variant="code">
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '12px',
                      lineHeight: '1.5',
                    }}
                  >
                    {generateMultiPolicyCfnSnippet(arns)}
                  </pre>
                </Box>
                <CopyToClipboard
                  variant="button"
                  textToCopy={generateMultiPolicyCfnSnippet(arns)}
                  copyButtonText="Copy CloudFormation snippet"
                  copySuccessText="CloudFormation snippet copied"
                  copyErrorText="Failed to copy snippet"
                  copyButtonAriaLabel="Copy CloudFormation code snippet"
                />
              </SpaceBetween>
            </ExpandableSection>
          </>
        )}

        {/* SCP-specific: Attachment instructions */}
        {policyType === 'SCP' && (
          <SpaceBetween size="m">
            <Box variant="awsui-key-label">SCP Attachment</Box>
            {arns.map((arn) => {
              const scpId = extractScpId(arn);
              return (
                <SpaceBetween key={arn} size="xs">
                  <Box>
                    <strong>SCP ID:</strong>{' '}
                    <CopyToClipboard
                      variant="inline"
                      textToCopy={scpId}
                      copySuccessText="SCP ID copied"
                      copyErrorText="Failed to copy SCP ID"
                      copyButtonAriaLabel={`Copy SCP ID ${scpId}`}
                    />
                  </Box>
                </SpaceBetween>
              );
            })}
            <Alert type="info" header="Attaching to an Organizational Unit">
              To apply this Service Control Policy, navigate to the{' '}
              <strong>AWS Organizations</strong> console, select the target organizational unit
              (OU) or account, and attach the policy using the SCP ID above. Note that SCPs
              affect all accounts within the targeted OU and its children.
            </Alert>
          </SpaceBetween>
        )}
      </SpaceBetween>
    </Container>
  );
}
