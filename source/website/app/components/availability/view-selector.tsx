import SegmentedControl from '@cloudscape-design/components/segmented-control';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import type { NamingConvention } from '@capability-insights/shared/types/terraform-overlay';

interface ViewSelectorProps {
  selectedConvention: NamingConvention;
  onChange: (convention: NamingConvention) => void;
  disabled?: boolean;
  loading?: boolean;
}

export default function ViewSelector({ selectedConvention, onChange, disabled = false, loading = false }: ViewSelectorProps) {
  return (
    <SpaceBetween direction="horizontal" size="xs">
      <SegmentedControl
        selectedId={selectedConvention}
        onChange={({ detail }) => onChange(detail.selectedId as NamingConvention)}
        options={[
          { id: 'cloudformation', text: 'CloudFormation' },
          { id: 'terraform-awscc', text: 'Terraform AWSCC' },
        ]}
        disabled={disabled || loading}
      />
      {loading && <Spinner />}
    </SpaceBetween>
  );
}
