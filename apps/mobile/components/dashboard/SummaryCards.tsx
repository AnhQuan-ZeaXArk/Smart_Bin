import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Colors, Tones, ToneName } from '../../constants/colors';
import { FontSize, Radius, Shadow, Spacing } from '../../constants/theme';
import { DashboardSummary, DashboardDevice, DashboardBin } from '../../types/dashboard';
import { Icon, IconName } from '../ui/Icon';
import { FadeIn, useReducedMotion } from '../ui/motion';

interface SummaryCardsProps {
  summary: DashboardSummary;
  bins: DashboardBin[];
  devices: DashboardDevice[];
}

/** Number that eases in whenever its value changes (opacity/transform only). */
const KpiValue: React.FC<{ value: number; color: string }> = ({ value, color }) => {
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reduced) return;
    pop.setValue(0);
    const anim = Animated.timing(pop, { toValue: 1, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [value, reduced, pop]);

  return (
    <Animated.Text
      style={[
        styles.number,
        { color },
        { opacity: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }), transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] },
      ]}
    >
      {value}
    </Animated.Text>
  );
};

export const SummaryCards: React.FC<SummaryCardsProps> = ({ summary, bins, devices }) => {
  // Same grouping as the web dashboard, taken from backend fillCategory / device status.
  const attention = bins.filter((b) => b.fillCategory === 'MONITOR').length;
  const fullish = bins.filter((b) => b.fillCategory === 'NEARLY_FULL' || b.fillCategory === 'CRITICAL').length;
  const offlineDevices = devices.filter((d) => d.status === 'OFFLINE').length;

  const items: Array<{ key: string; label: string; value: number; tone: ToneName; icon: IconName; neutral?: boolean }> = [
    { key: 'total', label: 'Tổng số thùng', value: summary.total, tone: 'info', icon: 'trash', neutral: true },
    { key: 'normal', label: 'Bình thường', value: summary.normal, tone: 'normal', icon: 'check-circle' },
    { key: 'attention', label: 'Cần chú ý', value: attention, tone: 'monitor', icon: 'alert-triangle' },
    { key: 'full', label: 'Gần đầy / Đầy', value: fullish, tone: 'critical', icon: 'x-circle' },
    { key: 'offline', label: 'Thiết bị offline', value: offlineDevices, tone: 'neutral', icon: 'cpu' },
  ];

  return (
    <View style={styles.grid}>
      {items.map((item, index) => {
        const t = Tones[item.tone];
        const last = index === items.length - 1;
        return (
          <FadeIn key={item.key} delay={index * 55} style={[styles.cell, last && styles.cellFull]}>
            <View style={[styles.card, { borderTopColor: t.solid }]}>
              <View style={[styles.iconBox, { backgroundColor: t.bg, borderColor: t.border }]}>
                <Icon name={item.icon} size={16} color={t.text} />
              </View>
              <KpiValue value={item.value} color={item.neutral ? Colors.textPrimary : t.text} />
              <Text style={styles.label} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
          </FadeIn>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm + 2,
    marginBottom: Spacing.lg,
  },
  cell: {
    width: '48%',
    flexGrow: 1,
  },
  cellFull: {
    width: '100%',
  },
  card: {
    gap: 8,
    padding: Spacing.md + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 2,
    backgroundColor: Colors.surfaceCard,
    ...Shadow.card,
  },
  iconBox: {
    width: 30,
    height: 30,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
  },
  label: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    color: Colors.textMuted,
  },
});
