import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Tones } from '../../constants/colors';
import { FILL_LABEL, FILL_TONE, FontSize } from '../../constants/theme';
import { DashboardBin, FillCategory } from '../../types/dashboard';
import { Card, SectionHeader } from '../ui/kit';

interface BinStatusBreakdownProps {
  bins: DashboardBin[];
}

const ORDER: FillCategory[] = ['NORMAL', 'MONITOR', 'NEARLY_FULL', 'CRITICAL'];

/** Distribution of bins by backend fillCategory (no data is invented; hidden when there are no bins). */
export const BinStatusBreakdown: React.FC<BinStatusBreakdownProps> = ({ bins }) => {
  if (bins.length === 0) return null;

  const counts = ORDER.map((category) => ({
    category,
    count: bins.filter((b) => b.fillCategory === category).length,
  }));

  return (
    <Card style={styles.card}>
      <SectionHeader title="Biểu đồ trạng thái" subtitle={`Tổng ${bins.length} thùng`} />
      <View style={styles.bar}>
        {counts
          .filter((item) => item.count > 0)
          .map((item) => (
            <View key={item.category} style={{ flex: item.count, backgroundColor: Tones[FILL_TONE[item.category]].solid }} />
          ))}
      </View>
      <View style={styles.legend}>
        {counts.map((item) => {
          const t = Tones[FILL_TONE[item.category]];
          return (
            <View key={item.category} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: t.solid }]} />
              <Text style={styles.legendLabel} numberOfLines={1}>
                {FILL_LABEL[item.category]}
              </Text>
              <Text style={[styles.legendCount, { color: t.text }]}>{item.count}</Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
  },
  bar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    gap: 2,
    backgroundColor: '#26394B',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 10,
    marginTop: 14,
  },
  legendItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    flex: 1,
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  legendCount: {
    fontSize: FontSize.base,
    fontWeight: '800',
  },
});
