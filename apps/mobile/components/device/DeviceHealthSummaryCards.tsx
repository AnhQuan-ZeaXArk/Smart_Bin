import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Tones } from '../../constants/colors';
import { FontSize, Radius, Spacing } from '../../constants/theme';
import { DeviceHealthSummary } from '../../types/device';
import { FadeIn } from '../ui/motion';

interface DeviceHealthSummaryCardsProps {
  summary: DeviceHealthSummary;
}

export const DeviceHealthSummaryCards: React.FC<DeviceHealthSummaryCardsProps> = ({ summary }) => {
  const items = [
    { key: 'total', label: 'Tổng', value: summary.total, color: Colors.textPrimary, border: Colors.border },
    { key: 'online', label: 'Hoạt động', value: summary.online, color: Tones.normal.text, border: Tones.normal.border },
    { key: 'warning', label: 'Cần kiểm tra', value: summary.warning, color: Tones.monitor.text, border: Tones.monitor.border },
    { key: 'offline', label: 'Mất kết nối', value: summary.offline, color: Tones.critical.text, border: Tones.critical.border },
  ];

  return (
    <View style={styles.container}>
      {items.map((item, index) => (
        <FadeIn key={item.key} delay={index * 45} style={styles.cell}>
          <View style={[styles.card, { borderTopColor: item.border }]}>
            <Text style={[styles.value, { color: item.color }]}>{item.value}</Text>
            <Text style={styles.label} numberOfLines={1}>
              {item.label}
            </Text>
          </View>
        </FadeIn>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  cell: {
    flex: 1,
  },
  card: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.md,
    paddingHorizontal: 4,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderTopWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceCard,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
  },
  label: {
    fontSize: FontSize.micro,
    color: Colors.textMuted,
    fontWeight: '700',
  },
});
