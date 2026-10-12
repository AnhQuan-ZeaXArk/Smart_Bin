import React from 'react';
import { Bin } from '../../types/bin';
import { BinOverviewCard } from './BinOverviewCard';
import { formatRelativeTime } from '../../utils/formatters';

interface BinCardProps {
  bin: Bin;
  onPress: (bin: Bin) => void;
  index?: number;
}

export const BinCard: React.FC<BinCardProps> = ({ bin, onPress, index = 0 }) => (
  <BinOverviewCard
    binCode={bin.binCode}
    name={bin.name}
    fillLevel={bin.currentFillLevel}
    fillCategory={bin.fillCategory}
    status={bin.status}
    distanceCm={bin.distanceCm}
    capacity={bin.capacity}
    location={bin.location}
    lastSeenLabel={formatRelativeTime(bin.lastSeen || bin.updatedAt)}
    index={index}
    onPress={() => onPress(bin)}
  />
);
