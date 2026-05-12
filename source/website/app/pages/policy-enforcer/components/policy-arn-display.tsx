import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Alert from '@cloudscape-design/components/alert';
import Badge from '@cloudscape-design/components/badge';
import ExpandableSection from '@cloudscape-design/components/expandable-section';

export interface PolicyArnDisplayProps {
  /** The primary policy ARN (undefined if not yet generated) */
  policyArn: string | undefined;
  /** Additional policy ARNs if the policy was split into multiple documents */
  additionalPolicyArns: string[] | undefined;
  /** The policy type (IAM or SCP) */
  policyType: 'IAM' | 'SCP';
  /** The policy name for display in code snippets */
  policyName: string;
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
 * Generates a CDK code snippet for attaching an IAM managed policy by ARN.
 */
function getCdkSnippet(arn: string, policyName: string): string {
  const sanitizedName = policyName.replace(/[^a-zA-Z0-9]/g, '');
  return `iam.ManagedPolicy.fromManagedPolicyArn(this, '${sanitizedName || 'PolicyEnforcer'}', '${arn}')`;
}

/**
 * Generates a CloudFormation snippet for attaching an IAM managed policy by ARN.
 */
function getCfnSnippet(arns: string[]): string {
  if (arns.length === 1) {
    return `ManagedPolicyArns:\n  - '${arns[0]}'`;
  }
  return `ManagedPolicyArns:\n${arns.map(a => `  - '${a}'`).join('\n')}`;
}

/**
 * Displays the Policy ARN with copy-to-clipboard functionality and
 * code snippets for attaching the policy in CDK and CloudFormation.
 * Handles multiple ARNs when a policy is split, SCP-specific guidance,
 * and a pending state when no ARN exists yet.
 */
export default function PolicyArnDisplay({
  policyArn,
  additionalPolicyArns,
  policyType,
  policyName,
}: PolicyArnDisplayProps) {
  if (!policyArn) {
    return (
      <Container header={<Header variant="h3">Policy ARN</Header>}>
        <Alert type="info">
          The policy ARN will be available after the first refresh execution. Deploy the
          CloudFormation template and wait for the initial refresh to complete.
        </Alert>
      </Container>
    );
  }

  const allArns = [policyArn, ...(additionalPolicyArns ?? [])];
  const hasSplit = allArns.length > 1;

  if (policyType === 'SCP') {
    const scpId = extractScpId(policyArn);
    return (
      <Container header={<Header variant="h3">Service Control Policy</Header>}>
        <SpaceBetween size="l">
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">SCP ID</Box>
            <CopyToClipboard
              variant="inline"
              textToCopy={scpId}
              copySuccessText="SCP ID copied"
              copyErrorText="Failed to copy SCP ID"
              copyButtonAriaLabel="Copy SCP ID"
            />
          </SpaceBetween>

          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Policy ARN</Box>
            <CopyToClipboard
              variant="inline"
              textToCopy={policyArn}
              copySuccessText="ARN copied"
              copyErrorText="Failed to copy ARN"
              copyButtonAriaLabel="Copy policy ARN"
            />
          </SpaceBetween>

          <Alert type="info" header="Attaching to an Organizational Unit">
            To apply this SCP, attach it to an organizational unit (OU) or account in AWS
            Organizations. Navigate to the AWS Organizations console, select the target OU, and
            attach the policy using SCP ID <strong>{scpId}</strong>. Note that SCPs affect all
            accounts within the targeted OU.
          </Alert>
        </SpaceBetween>
      </Container>
    );
  }

  // IAM policy type
  const cdkSnippet = getCdkSnippet(policyArn, policyName);
  const cfnSnippet = getCfnSnippet(allArns);

  return (
    <Container header={<Header variant="h3">Policy ARN</Header>}>
      <SpaceBetween size="l">
        <SpaceBetween size="xs">
          <Box variant="awsui-key-label">
            Primary ARN {hasSplit && <Badge color="blue">{allArns.length} policies</Badge>}
          </Box>
          <CopyToClipboard
            variant="inline"
            textToCopy={policyArn}
            copySuccessText="ARN copied"
            copyErrorText="Failed to copy ARN"
            copyButtonAriaLabel="Copy primary policy ARN"
          />
        </SpaceBetween>

        {hasSplit && (
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">Additional ARNs (policy was split)</Box>
            {additionalPolicyArns!.map((arn, index) => (
              <CopyToClipboard
                key={arn}
                variant="inline"
                textToCopy={arn}
                copySuccessText="ARN copied"
                copyErrorText="Failed to copy ARN"
                copyButtonAriaLabel={`Copy additional policy ARN ${index + 1}`}
              />
            ))}
          </SpaceBetween>
        )}

        <ExpandableSection headerText="CDK snippet" variant="footer">
          <SpaceBetween size="s">
            <Box variant="code">{cdkSnippet}</Box>
            <CopyToClipboard
              variant="button"
              textToCopy={cdkSnippet}
              copyButtonText="Copy CDK snippet"
              copySuccessText="CDK snippet copied"
              copyErrorText="Failed to copy snippet"
              copyButtonAriaLabel="Copy CDK code snippet"
            />
          </SpaceBetween>
        </ExpandableSection>

        <ExpandableSection headerText="CloudFormation snippet" variant="footer">
          <SpaceBetween size="s">
            <Box variant="code">{cfnSnippet}</Box>
            <CopyToClipboard
              variant="button"
              textToCopy={cfnSnippet}
              copyButtonText="Copy CloudFormation snippet"
              copySuccessText="CloudFormation snippet copied"
              copyErrorText="Failed to copy snippet"
              copyButtonAriaLabel="Copy CloudFormation code snippet"
            />
          </SpaceBetween>
        </ExpandableSection>
      </SpaceBetween>
    </Container>
  );
}
