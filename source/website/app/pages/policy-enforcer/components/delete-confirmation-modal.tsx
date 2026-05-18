import { useState } from 'react';
import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';

import type { PolicyConfiguration } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

export interface DeleteConfirmationModalProps {
  policy: PolicyConfiguration;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

/**
 * Builds the complete list of ARNs (primary + additional) for a policy configuration.
 */
export function buildDeleteConfirmationArns(policy: PolicyConfiguration): string[] {
  const arns: string[] = [];
  if (policy.policyArn) {
    arns.push(policy.policyArn);
  }
  if (policy.additionalPolicyArns) {
    for (const arn of policy.additionalPolicyArns) {
      if (!arns.includes(arn)) {
        arns.push(arn);
      }
    }
  }
  return arns;
}

/**
 * Modal for confirming cascading deletion of a policy configuration.
 * Lists all ARNs that will be deleted and requires the user to type the policy name to confirm.
 */
export default function DeleteConfirmationModal({
  policy,
  onConfirm,
  onCancel,
  loading = false,
}: DeleteConfirmationModalProps) {
  const [confirmationText, setConfirmationText] = useState('');

  const arns = buildDeleteConfirmationArns(policy);
  const hasArns = arns.length > 0;
  const isConfirmed = confirmationText === policy.policyName;

  return (
    <Modal
      visible={true}
      onDismiss={onCancel}
      header="Delete policy configuration"
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onConfirm}
              disabled={!isConfirmed || loading}
              loading={loading}
            >
              Delete
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Alert type="warning" header="This action cannot be undone">
          {hasArns ? (
            <>
              Deleting this policy configuration will permanently remove the DynamoDB record
              and attempt to delete the following IAM managed{' '}
              {arns.length === 1 ? 'policy' : 'policies'}:
            </>
          ) : (
            <>
              This policy configuration has no IAM policies (it has not been refreshed yet).
              Only the DynamoDB configuration record will be deleted.
            </>
          )}
        </Alert>

        {hasArns && (
          <SpaceBetween size="xs">
            <Box variant="awsui-key-label">
              IAM policies to be deleted ({arns.length})
            </Box>
            {arns.map((arn) => (
              <Box key={arn} variant="code" fontSize="body-s">
                {arn}
              </Box>
            ))}
          </SpaceBetween>
        )}

        <FormField
          label={
            <>
              To confirm deletion, type <strong>{policy.policyName}</strong> below
            </>
          }
        >
          <Input
            value={confirmationText}
            onChange={({ detail }) => setConfirmationText(detail.value)}
            placeholder={policy.policyName}
            disabled={loading}
            ariaLabel="Type policy name to confirm deletion"
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
