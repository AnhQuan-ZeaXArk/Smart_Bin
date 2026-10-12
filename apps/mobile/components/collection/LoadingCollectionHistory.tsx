import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '../ui/motion';

export const LoadingCollectionHistory: React.FC = () => {
  return (
    <View style={styles.container}>
      <Skeleton height={150} radius={12} />
      <Skeleton height={150} radius={12} />
      <Skeleton height={150} radius={12} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 12,
  },
});
