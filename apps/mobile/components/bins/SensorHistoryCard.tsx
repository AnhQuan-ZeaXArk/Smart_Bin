import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { FontSize, Radius, Spacing } from '../../constants/theme';
import { SensorReadingItem } from '../../types/dashboard';
import { formatDateTime } from '../../utils/formatters';
import { Card, StateCard } from '../ui/kit';
import { SensorChart } from './SensorChart';

interface SensorHistoryCardProps {
  readings: SensorReadingItem[];
}

export const SensorHistoryCard: React.FC<SensorHistoryCardProps> = ({ readings }) => {
  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>TELEMETRY</Text>
          <Text style={styles.title}>Lịch sử cảm biến</Text>
          <Text style={styles.subTitle}>Dữ liệu đo siêu âm từ thiết bị IoT</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{readings.length} bản ghi</Text>
        </View>
      </View>

      {readings.length === 0 ? (
        <StateCard kind="empty" icon="activity" title="Chưa có dữ liệu cảm biến" message="Chưa nhận được bản ghi lịch sử cho thùng này." />
      ) : (
        <>
          <SensorChart readings={readings} />
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.thText, styles.colTime]}>Thời gian</Text>
              <Text style={[styles.thText, styles.colFill]}>Mức đầy</Text>
              <Text style={[styles.thText, styles.colDistance]}>Khoảng cách</Text>
            </View>
            {readings.map((item, index) => (
              <View
                key={item.id || `${item.timestamp}-${index}`}
                style={[styles.tableRow, index === readings.length - 1 && styles.tableRowLast]}
              >
                <Text style={[styles.timeText, styles.colTime]}>{formatDateTime(item.timestamp)}</Text>
                <Text style={[styles.fillText, styles.colFill]}>{item.fillLevel}%</Text>
                <Text style={[styles.distanceText, styles.colDistance]}>
                  {item.distance !== undefined ? `${item.distance} cm` : '--'}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#39CFA0',
  },
  title: {
    fontSize: FontSize.title,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  subTitle: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
    marginTop: 2,
  },
  badge: {
    backgroundColor: '#293E52',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: FontSize.caption,
    color: '#B9CAD7',
    fontWeight: '700',
  },
  table: {
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#17283A',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  thText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#8FA4B6',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    backgroundColor: '#122033',
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  colTime: {
    flex: 3.2,
  },
  colFill: {
    flex: 1.5,
    textAlign: 'center',
  },
  colDistance: {
    flex: 1.8,
    textAlign: 'right',
  },
  timeText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  distanceText: {
    fontSize: FontSize.caption,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  fillText: {
    fontSize: FontSize.small,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
});
