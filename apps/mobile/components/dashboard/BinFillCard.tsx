import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { DashboardBin, FillCategory } from '../../types/dashboard';

interface BinFillCardProps {
  bins: DashboardBin[];
  onSelectBin?: (bin: DashboardBin) => void;
  onViewAllBins?: () => void;
}

const CATEGORY_ORDER = ['ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE'] as const;

const CATEGORY_NAMES: Record<string, string> = {
  ORGANIC: 'Rác hữu cơ',
  RECYCLABLE: 'Rác tái chế',
  NON_RECYCLABLE: 'Rác không tái chế',
};

function getCategoryColor(fillLevel: number, fillCategory: FillCategory) {
  if (fillLevel > 90 || fillCategory === 'CRITICAL') {
    return {
      bar: Colors.error,
      bg: 'rgba(239, 68, 68, 0.15)',
      text: Colors.error,
      label: 'Đầy (> 90%)',
    };
  }
  if (fillLevel > 75 || fillCategory === 'NEARLY_FULL') {
    return {
      bar: '#F97316',
      bg: 'rgba(249, 115, 22, 0.15)',
      text: '#FB923C',
      label: 'Gần đầy (76% – 90%)',
    };
  }
  if (fillLevel > 50 || fillCategory === 'MONITOR') {
    return {
      bar: Colors.warning,
      bg: 'rgba(245, 158, 11, 0.15)',
      text: Colors.warning,
      label: 'Cần chú ý (51% – 75%)',
    };
  }
  return {
    bar: Colors.brandHighlight,
    bg: 'rgba(16, 185, 129, 0.15)',
    text: Colors.brandHighlight,
    label: 'Bình thường (≤ 50%)',
  };
}

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
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>MỨC ĐẦY THÙNG RÁC</Text>
          <Text style={styles.subTitle}>Dữ liệu từ cảm biến siêu âm</Text>
        </View>
        {onViewAllBins && (
          <TouchableOpacity
            style={styles.viewAllButton}
            activeOpacity={0.7}
            onPress={onViewAllBins}
          >
            <Text style={styles.viewAllText}>Xem tất cả →</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.list}>
        {sortedBins.map((bin) => {
          const fillPercentage = Math.min(100, Math.max(0, bin.currentFillLevel));
          const colorMeta = getCategoryColor(fillPercentage, bin.fillCategory);
          const displayName = CATEGORY_NAMES[bin.binCode] || bin.name || bin.binCode;

          const ItemWrapper = onSelectBin ? TouchableOpacity : View;
          const wrapperProps = onSelectBin
            ? { activeOpacity: 0.75, onPress: () => onSelectBin(bin) }
            : {};

          return (
            <ItemWrapper
              key={bin.id || bin.binCode}
              style={styles.binItem}
              {...wrapperProps}
            >

              {/* Item Header */}
              <View style={styles.binHeader}>
                <View style={styles.titleCol}>
                  <Text style={styles.binName}>{displayName}</Text>
                  <Text style={styles.binCodeTag}>
                    Mã: {bin.binCode} • {bin.status === 'ONLINE' ? 'Trực tuyến' : 'Ngoại tuyến'}
                  </Text>
                </View>

                <View style={styles.percentageCol}>
                  <Text style={[styles.percentageText, { color: colorMeta.text }]}>
                    {fillPercentage}%
                  </Text>
                  <Text style={styles.statusLabel}>{colorMeta.label}</Text>
                </View>
              </View>

              {/* Progress Bar Track */}
              <View style={styles.progressBarTrack}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${fillPercentage}%`,
                      backgroundColor: colorMeta.bar,
                    },
                  ]}
                />
              </View>

              {/* Sensor Distance & Capacity Meta */}
              <View style={styles.metaRow}>
                <Text style={styles.metaItem}>
                  Khoảng cách:{' '}
                  <Text style={styles.metaValue}>
                    {bin.distanceCm !== null && bin.distanceCm !== undefined
                      ? `${bin.distanceCm} cm`
                      : 'Đang đo...'}
                  </Text>
                </Text>
                <Text style={styles.metaItem}>
                  Dung tích:{' '}
                  <Text style={styles.metaValue}>{bin.capacity || 240}L</Text>
                </Text>
              </View>
            </ItemWrapper>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  viewAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  viewAllText: {
    fontSize: 12,
    color: Colors.brandHighlight,
    fontWeight: '700',
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1.2,
  },
  subTitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  list: {
    gap: 16,
  },
  binItem: {
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  binHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  titleCol: {
    flex: 1,
  },
  binName: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  binCodeTag: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  percentageCol: {
    alignItems: 'flex-end',
  },
  percentageText: {
    fontSize: 20,
    fontWeight: '900',
  },
  statusLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '600',
    marginTop: 1,
  },
  progressBarTrack: {
    height: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 5,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  metaItem: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  metaValue: {
    color: Colors.textSecondary,
    fontWeight: '600',
  },
});
