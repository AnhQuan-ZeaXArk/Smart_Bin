import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Colors } from '../../constants/colors';

export const LoadingCollectionHistory: React.FC = () => {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color={Colors.brandHighlight} />
        <Text style={styles.loadingTitle}>ĐANG TẢI DỮ LIỆU THU GOM</Text>
        <Text style={styles.loadingSub}>
          Đang kết nối API bảo mật để lấy lịch sử thu gom rác thực tế...
        </Text>
      </View>

      {/* Skeleton placeholders */}
      <View style={styles.skeletonCard}>
        <View style={styles.skeletonHeader} />
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, { width: '60%' }]} />
      </View>
      <View style={styles.skeletonCard}>
        <View style={styles.skeletonHeader} />
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, { width: '45%' }]} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTitle: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  loadingSub: {
    marginTop: 6,
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  skeletonCard: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    padding: 16,
    gap: 10,
    opacity: 0.6,
  },
  skeletonHeader: {
    height: 16,
    width: '40%',
    backgroundColor: Colors.border,
    borderRadius: 4,
  },
  skeletonLine: {
    height: 12,
    width: '80%',
    backgroundColor: Colors.borderLight,
    borderRadius: 3,
  },
});
