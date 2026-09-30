import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { Config } from '../constants/config';

export const Header: React.FC = () => {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.brandBadge}>
          <Text style={styles.brandBadgeText}>SMARTBIN</Text>
        </View>
        <View style={styles.envTag}>
          <Text style={styles.envTagText}>MOBILE CLIENT</Text>
        </View>
      </View>

      <Text style={styles.title}>OPERATIONS</Text>
      <Text style={styles.subtitle}>SmartBin Mobile • Giám Sát & Vận Hành</Text>
      <Text style={styles.version}>{Config.version}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 18,
    paddingHorizontal: 20,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  brandBadge: {
    backgroundColor: Colors.brandPrimary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  brandBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  envTag: {
    backgroundColor: Colors.surfaceCard,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  envTagText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 2,
    marginTop: 4,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  version: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'monospace',
  },
});
