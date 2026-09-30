import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { DashboardBin } from '../../types/dashboard';

interface BinStatusBreakdownProps {
  bins: DashboardBin[];
}

export const BinStatusBreakdown: React.FC<BinStatusBreakdownProps> = ({ bins }) => {
  const normalCount = bins.filter((b) => b.fillCategory === 'NORMAL').length;
  const monitorCount = bins.filter((b) => b.fillCategory === 'MONITOR').length;
  const nearlyFullCount = bins.filter((b) => b.fillCategory === 'NEARLY_FULL').length;
  const criticalCount = bins.filter((b) => b.fillCategory === 'CRITICAL').length;
  const offlineCount = bins.filter((b) => b.status === 'OFFLINE').length;

  const statusItems = [
    {
      label: 'Bình thường (≤ 50%)',
      count: normalCount,
      dotColor: Colors.success,
      badgeBg: Colors.successLight,
      badgeText: Colors.success,
    },
    {
      label: 'Cần chú ý (51% – 75%)',
      count: monitorCount,
      dotColor: Colors.warning,
      badgeBg: Colors.warningLight,
      badgeText: Colors.warning,
    },
    {
      label: 'Gần đầy (76% – 90%)',
      count: nearlyFullCount,
      dotColor: '#F97316', // Orange
      badgeBg: 'rgba(249, 115, 22, 0.15)',
      badgeText: '#FB923C',
    },
    {
      label: 'Đầy (> 90%)',
      count: criticalCount,
      dotColor: Colors.error,
      badgeBg: Colors.errorLight,
      badgeText: Colors.error,
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>TÌNH TRẠNG THÙNG RÁC</Text>
        <Text style={styles.totalBadge}>Tổng: {bins.length}</Text>
      </View>

      <View style={styles.list}>
        {statusItems.map((item, index) => (
          <View
            key={index}
            style={[
              styles.row,
              index !== statusItems.length - 1 && styles.rowBorder,
            ]}
          >
            <View style={styles.labelCol}>
              <View style={[styles.dot, { backgroundColor: item.dotColor }]} />
              <Text style={styles.labelText}>{item.label}</Text>
            </View>

            <View style={[styles.countBadge, { backgroundColor: item.badgeBg }]}>
              <Text style={[styles.countText, { color: item.badgeText }]}>
                {item.count}
              </Text>
            </View>
          </View>
        ))}

        {offlineCount > 0 && (
          <View style={[styles.row, styles.offlineRow]}>
            <View style={styles.labelCol}>
              <View style={[styles.dot, { backgroundColor: Colors.textMuted }]} />
              <Text style={styles.labelText}>Ngoại tuyến (Offline)</Text>
            </View>
            <View style={[styles.countBadge, { backgroundColor: Colors.surfaceCardElevated }]}>
              <Text style={[styles.countText, { color: Colors.textMuted }]}>
                {offlineCount}
              </Text>
            </View>
          </View>
        )}
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
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1.2,
  },
  totalBadge: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  list: {
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  offlineRow: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  labelCol: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 10,
  },
  labelText: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    minWidth: 32,
    alignItems: 'center',
  },
  countText: {
    fontSize: 13,
    fontWeight: '800',
  },
});
