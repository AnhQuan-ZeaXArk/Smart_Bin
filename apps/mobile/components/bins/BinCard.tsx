import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { Bin } from '../../types/bin';
import { BinStatusBadge } from './BinStatusBadge';
import { BinFillIndicator } from './BinFillIndicator';
import { formatRelativeTime } from '../../utils/formatters';

interface BinCardProps {
  bin: Bin;
  onPress: (bin: Bin) => void;
}

const CATEGORY_NAMES: Record<string, string> = {
  ORGANIC: 'Rác hữu cơ',
  RECYCLABLE: 'Rác tái chế',
  NON_RECYCLABLE: 'Rác không tái chế',
};

export const BinCard: React.FC<BinCardProps> = ({ bin, onPress }) => {
  const displayName = CATEGORY_NAMES[bin.binCode] || bin.name || bin.binCode;
  const relativeTime = formatRelativeTime(bin.lastSeen || bin.updatedAt);

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.75}
      onPress={() => onPress(bin)}
    >
      {/* Top Header Row */}
      <View style={styles.headerRow}>
        <View style={styles.titleContainer}>
          <Text style={styles.categoryLabel}>{displayName}</Text>
          <Text style={styles.binCodeText}>Mã: {bin.binCode}</Text>
        </View>
        <View style={styles.badgeContainer}>
          <BinStatusBadge status={bin.status} />
        </View>
      </View>

      {/* Location and Capacity Meta */}
      <View style={styles.metaRow}>
        <Text style={styles.locationText} numberOfLines={1}>
          📍 {bin.location || 'Vị trí SmartBin'}
        </Text>
        <Text style={styles.capacityText}>Dung tích: {bin.capacity}L</Text>
      </View>

      {/* Ultrasonic Distance if available */}
      {bin.distanceCm !== undefined && bin.distanceCm !== null && (
        <View style={styles.sensorRow}>
          <Text style={styles.sensorLabel}>Khoảng cách cảm biến:</Text>
          <Text style={styles.sensorValue}>{bin.distanceCm} cm</Text>
        </View>
      )}

      {/* Fill Level Section */}
      <View style={styles.fillSection}>
        <BinFillIndicator
          fillLevel={bin.currentFillLevel}
          fillCategory={bin.fillCategory}
          barHeight={9}
        />
      </View>

      {/* Footer Row */}
      <View style={styles.footerRow}>
        <Text style={styles.lastSeenText}>Cập nhật: {relativeTime}</Text>
        <View style={styles.actionPrompt}>
          <Text style={styles.actionText}>Chi tiết</Text>
          <Text style={styles.arrowIcon}>→</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  titleContainer: {
    flex: 1,
    marginRight: 8,
  },
  categoryLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  binCodeText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '600',
    marginTop: 2,
  },
  badgeContainer: {
    alignItems: 'flex-end',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.4)',
  },
  locationText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1,
    marginRight: 8,
  },
  capacityText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  sensorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  sensorLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  sensorValue: {
    fontSize: 11,
    color: Colors.brandHighlight,
    fontWeight: '700',
  },
  fillSection: {
    marginBottom: 12,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(51, 65, 85, 0.4)',
  },
  lastSeenText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  actionPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionText: {
    fontSize: 12,
    color: Colors.brandHighlight,
    fontWeight: '700',
    marginRight: 4,
  },
  arrowIcon: {
    fontSize: 14,
    color: Colors.brandHighlight,
    fontWeight: '800',
  },
});
