import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import ExpandableSection from '@cloudscape-design/components/expandable-section';

import type { PolicyPartDetailResponse } from '@capability-insights/shared/types/policy-enforcer/policy-configuration';

export interface PartDetailViewerProps {
  detail: PolicyPartDetailResponse;
}

/**
 * Displays the detail view for a selected policy part, including
 * the full JSON policy document and service action groups.
 */
export default function PartDetailViewer({ detail }: PartDetailViewerProps) {
  const formattedDocument = JSON.stringify(detail.document, null, 2);

  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h3"
            description={`ARN: ${detail.part.arn}`}
            actions={
              <Badge color={detail.part.partType === 'blanket-deny' ? 'blue' : 'green'}>
                {detail.part.statementItemCount} statement items
              </Badge>
            }
          >
            Part {detail.part.partIndex} —{' '}
            {detail.part.partType === 'blanket-deny'
              ? 'Blanket Deny'
              : 'Specific API Deny'}
          </Header>
        }
      >
        <Box>
          <Box variant="awsui-key-label" margin={{ bottom: 'xs' }}>
            Policy Document
          </Box>
          <Box variant="code">
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '500px',
                overflow: 'auto',
                fontSize: '12px',
                lineHeight: '1.5',
              }}
            >
              {formattedDocument}
            </pre>
          </Box>
        </Box>
      </Container>

      {detail.services.length > 0 && (
        <Container
          header={
            <Header
              variant="h3"
              counter={`(${detail.services.length})`}
            >
              Service Action Groups
            </Header>
          }
        >
          <SpaceBetween size="s">
            {detail.services.map((group) => (
              <ExpandableSection
                key={group.servicePrefix}
                headerText={
                  `${group.servicePrefix} (${group.actions.length} action${group.actions.length === 1 ? '' : 's'})`
                }
                variant="footer"
              >
                <Box variant="code">
                  <ul style={{ margin: 0, paddingLeft: '20px' }}>
                    {group.actions.map((action) => (
                      <li key={action}>{action}</li>
                    ))}
                  </ul>
                </Box>
              </ExpandableSection>
            ))}
          </SpaceBetween>
        </Container>
      )}
    </SpaceBetween>
  );
}
