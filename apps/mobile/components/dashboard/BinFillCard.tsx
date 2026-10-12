import React from 'react';
import { View } from 'react-native';
import { DashboardBin } from '../../types/dashboard';
import { SectionHeader } from '../ui/kit';
import { BinOverviewCard } from '../bins/BinOverviewCard';
import { formatRelativeTime } from '../../utils/formatters';

interface BinFillCardProps {
  bins: DashboardBin[];
  onSelectBin?: (bin: DashboardBin) => void;
  onViewAllBins?: () => void;
}

const CATEGORY_ORDER = ['ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE'] as const;

export const BinFillCard: React.FC<BinFillCardProps> = ({
  bins,
  onSelectBin,
  onViewAllBins,
}) => {
  // Sort bins in the canonical order: ORGANIC, RECYCLABLE, NON_RECYCLABLE
  const sortedBins = [...bins].sort((a, b) => {
    const idxA = CATEGORY_ORDER.indexOf(a.binCode as typeof CATEGORY_ORDER[number]);
    const idxB = CATEGORY_ORDER.indexOf(b.binCode as typeof CATEGORY_ORDER[number]);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    return a.binCode.localeCompare(b.binCode);
  });

  return (
    <View>
      <SectionHeader
        title="Mức đầy thùng rác"
        subtitle="Dữ liệu từ cảm biến siêu âm"
        actionLabel={onViewAllBins ? 'Xem tất cả' : undefined}
        onAction={onViewAllBins}
      />
      {sortedBins.map((bin, index) => (
        <BinOverviewCard
          key={bin.id || bin.binCode}
          binCode={bin.binCode}
          name={bin.name}
          fillLevel={bin.currentFillLevel}
          fillCategory={bin.fillCategory}
          status={bin.status}
          distanceCm={bin.distanceCm}
          capacity={bin.capacity}
          lastSeenLabel={formatRelativeTime(bin.lastSeen)}
          index={index}
          onPress={onSelectBin ? () => onSelectBin(bin) : undefined}
        />
      ))}
    </View>
  );
};
