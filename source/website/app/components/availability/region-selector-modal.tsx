import { useState, useMemo, useCallback } from 'react';
import Modal from '@cloudscape-design/components/modal';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Checkbox from '@cloudscape-design/components/checkbox';
import Box from '@cloudscape-design/components/box';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import type { Region } from '@capability-insights/shared/types/capability/region';
import { getRegionCluster, sortRegionsByCluster } from '~/constants/region-clusters';

interface RegionSelectorModalProps {
  regions: Region[];
  selectedRegionCodes: Set<string>;
  onSelectionChange: (codes: Set<string>) => void;
}

export default function RegionSelectorModal({
  regions,
  selectedRegionCodes,
  onSelectionChange,
}: RegionSelectorModalProps) {
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const sorted = sortRegionsByCluster(regions);
    const map = new Map<string, Region[]>();
    for (const r of sorted) {
      const cluster = getRegionCluster(r);
      if (!map.has(cluster)) map.set(cluster, []);
      map.get(cluster)!.push(r);
    }
    return map;
  }, [regions]);

  const handleOpen = useCallback(() => {
    setDraft(new Set(selectedRegionCodes));
    setVisible(true);
  }, [selectedRegionCodes]);

  const handleDismiss = useCallback(() => {
    setVisible(false);
  }, []);

  const handleConfirm = useCallback(() => {
    onSelectionChange(new Set(draft));
    setVisible(false);
  }, [draft, onSelectionChange]);

  const toggleRegion = (code: string, checked: boolean) => {
    setDraft(prev => {
      const next = new Set(prev);
      if (checked) next.add(code); else next.delete(code);
      return next;
    });
  };

  const toggleCluster = (clusterRegions: Region[], checked: boolean) => {
    setDraft(prev => {
      const next = new Set(prev);
      for (const r of clusterRegions) {
        if (checked) next.add(r.Region); else next.delete(r.Region);
      }
      return next;
    });
  };

  return (
    <>
      <Button variant="primary" onClick={handleOpen}>Select Regions</Button>
      <Modal
        visible={visible}
        onDismiss={handleDismiss}
        header="Select regions to display"
        size="large"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => setDraft(new Set(regions.map(r => r.Region)))}>Select all</Button>
              <Button variant="link" onClick={() => setDraft(new Set())}>Clear all</Button>
              <Button variant="link" onClick={handleDismiss}>Cancel</Button>
              <Button variant="primary" onClick={handleConfirm}>Apply ({draft.size} regions)</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <ColumnLayout columns={3}>
          {[...grouped.entries()].map(([cluster, clusterRegions]) => {
            const allChecked = clusterRegions.every(r => draft.has(r.Region));
            const someChecked = clusterRegions.some(r => draft.has(r.Region));
            return (
              <div key={cluster}>
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked && !allChecked}
                  onChange={({ detail }) => toggleCluster(clusterRegions, detail.checked)}
                >
                  <Box variant="strong">{cluster}</Box>
                </Checkbox>
                <Box padding={{ left: 'l' }}>
                  <SpaceBetween size="xxs">
                    {clusterRegions.map(r => (
                      <Checkbox
                        key={r.Region}
                        checked={draft.has(r.Region)}
                        onChange={({ detail }) => toggleRegion(r.Region, detail.checked)}
                      >
                        {r.Region}
                      </Checkbox>
                    ))}
                  </SpaceBetween>
                </Box>
              </div>
            );
          })}
        </ColumnLayout>
      </Modal>
    </>
  );
}
