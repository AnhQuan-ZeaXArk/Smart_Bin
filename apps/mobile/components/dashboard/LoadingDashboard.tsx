import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '../ui/motion';

/** Skeleton layout matching the loaded dashboard (KPIs, bin cards, lists). */
export const LoadingDashboard: React.FC = () => {
  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={104} radius={12} style={styles.kpi} />
        ))}
      </View>
      <Skeleton height={190} radius={12} />
      <Skeleton height={190} radius={12} />
      <Skeleton height={150} radius={12} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  kpi: {
    width: '48%',
    flexGrow: 1,
  },
});
