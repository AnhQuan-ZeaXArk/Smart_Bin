import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { DeviceHealthSummary } from '../../types/device';

interface DeviceHealthSummaryCardsProps {
  summary: DeviceHealthSummary;
}

export const DeviceHealthSummaryCards: React.FC<DeviceHealthSummaryCardsProps> = ({ summary }) => {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.value}>{summary.total}</Text>
        <Text style={styles.label}>Tổng thiết bị</Text>
      </View>

      <View style={[styles.card, styles.cardOnline]}>
        <Text style={[styles.value, { color: Colors.success }]}>{summary.online}</Text>
        <Text style={styles.label}>Hoạt động</Text>
      </View>

      {summary.warning > 0 && (
        <View style={[styles.card, styles.cardWarning]}>
          <Text style={[styles.value, { color: Colors.warning }]}>{summary.warning}</Text>
          <Text style={styles.label}>Cần kiểm tra</Text>
        </View>
      )}

      {summary.offline > 0 && (
        <View style={[styles.card, styles.cardOffline]}>
          <Text style={[styles.value, { color: Colors.error }]}>{summary.offline}</Text>
          <Text style={styles.label}>Mất kết nối</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  card: {
    flex: 1,
    backgroundColor: Colors.surfaceCard,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardOnline: {
    borderColor: Colors.successBorder,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  cardWarning: {
    borderColor: Colors.warningBorder,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  cardOffline: {
    borderColor: Colors.errorBorder,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  value: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  label: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
  },
});
