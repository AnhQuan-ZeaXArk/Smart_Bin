import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Colors } from '../../constants/colors';

export const LoadingDashboard: React.FC = () => {
  return (
    <View style={styles.container}>
      {/* Loading Indicator Card */}
      <View style={styles.indicatorBox}>
        <ActivityIndicator size="large" color={Colors.brandHighlight} />
        <Text style={styles.title}>ĐANG TẢI DỮ LIỆU DASHBOARD</Text>
        <Text style={styles.subtitle}>Đang kết nối API và đồng bộ trạng thái hệ thống...</Text>
      </View>

      {/* Placeholder Skeleton Cards */}
      <View style={styles.skeletonGrid}>
        <View style={styles.skeletonCard} />
        <View style={styles.skeletonCard} />
        <View style={styles.skeletonCard} />
        <View style={styles.skeletonCard} />
      </View>

      <View style={styles.skeletonLarge} />
      <View style={styles.skeletonLarge} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
  },
  indicatorBox: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 14,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 4,
    textAlign: 'center',
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  skeletonCard: {
    flex: 1,
    minWidth: '47%',
    height: 76,
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    opacity: 0.6,
  },
  skeletonLarge: {
    height: 140,
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    opacity: 0.6,
  },
});
