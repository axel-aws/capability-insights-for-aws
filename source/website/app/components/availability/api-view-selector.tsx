import SegmentedControl from '@cloudscape-design/components/segmented-control';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';

export type ApiViewMode = 'api-operations' | 'terraform-aws';

interface ApiViewSelectorProps {
  selectedView: ApiViewMode;
  onChange: (view: ApiViewMode) => void;
  disabled?: boolean;
  loading?: boolean;
}

export default function ApiViewSelector({ selectedView, onChange, disabled = false, loading = false }: ApiViewSelectorProps) {
  return (
    <SpaceBetween direction="horizontal" size="xs">
      <SegmentedControl
        selectedId={selectedView}
        onChange={({ detail }) => onChange(detail.selectedId as ApiViewMode)}
        options={[
          { id: 'api-operations', text: 'API Operations' },
          { id: 'terraform-aws', text: 'Terraform AWS', disabled: disabled || loading },
        ]}
      />
      {loading && <Spinner />}
    </SpaceBetween>
  );
}
