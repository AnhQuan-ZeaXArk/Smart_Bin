import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { SensorReadingItem } from '../../types/dashboard';
import { formatDateTime } from '../../utils/formatters';

interface SensorHistoryCardProps {
  readings: SensorReadingItem[];
}

function getFillStatusTone(fillLevel: number) {
  if (fillLevel > 90) return { color: Colors.error, label: 'Đầy' };
  if (fillLevel > 75) return { color: '#FB923C', label: 'Gần đầy' };
  if (fillLevel > 50) return { color: Colors.warning, label: 'Cần chú ý' };
  return { color: Colors.brandHighlight, label: 'Bình thường' };
}

export const SensorHistoryCard: React.FC<SensorHistoryCardProps> = ({ readings }) => {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>LỊCH SỬ CẢM BIẾN</Text>
          <Text style={styles.subTitle}>Dữ liệu đo siêu âm từ thiết bị IoT</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{readings.length} bản ghi</Text>
        </View>
      </View>

      {readings.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>Chưa có bản ghi đo cảm biến nào.</Text>
        </View>
      ) : (
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, styles.colTime]}>Thời gian</Text>
            <Text style={[styles.thText, styles.colDistance]}>Khoảng cách</Text>
            <Text style={[styles.thText, styles.colFill]}>Mức đầy</Text>
            <Text style={[styles.thText, styles.colStatus]}>Trạng thái</Text>
          </View>

          {/* Table Rows */}
          {readings.map((item, index) => {
            const tone = getFillStatusTone(item.fillLevel);
            const isLast = index === readings.length - 1;

            return (
              <View
                key={item.id || `${item.timestamp}-${index}`}
                style={[styles.tableRow, isLast && styles.tableRowLast]}
              >
                <View style={styles.colTime}>
                  <Text style={styles.timeText}>
                    {formatDateTime(item.timestamp)}
                  </Text>
                </View>
                <View style={styles.colDistance}>
                  <Text style={styles.distanceText}>
                    {item.distance !== undefined ? `${item.distance} cm` : '--'}
                  </Text>
                </View>
                <View style={styles.colFill}>
                  <Text style={[styles.fillText, { color: tone.color }]}>
                    {item.fillLevel}%
                  </Text>
                </View>
                <View style={styles.colStatus}>
                  <View style={[styles.statusTag, { borderColor: tone.color }]}>
                    <Text style={[styles.statusTagText, { color: tone.color }]}>
                      {tone.label}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
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
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  subTitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  badge: {
    backgroundColor: 'rgba(51, 65, 85, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  emptyState: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
  table: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.4)',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.6)',
  },
  thText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.25)',
    backgroundColor: Colors.surfaceCard,
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  colTime: {
    flex: 3,
  },
  colDistance: {
    flex: 2,
    alignItems: 'center',
  },
  colFill: {
    flex: 2,
    alignItems: 'center',
  },
  colStatus: {
    flex: 2.2,
    alignItems: 'flex-end',
  },
  timeText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  distanceText: {
    fontSize: 11,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  fillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  statusTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
