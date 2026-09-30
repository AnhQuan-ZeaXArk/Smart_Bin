import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { BinStatus, FillCategory } from '../../types/dashboard';

interface BinStatusBadgeProps {
  status?: BinStatus;
  fillCategory?: FillCategory;
  showDot?: boolean;
}

const STATUS_CONFIG: Record<
  BinStatus,
  { label: string; text: string; bg: string; dot: string }
> = {
  ONLINE: {
    label: 'Trực tuyến',
    text: Colors.brandHighlight,
    bg: 'rgba(16, 185, 129, 0.15)',
    dot: Colors.brandHighlight,
  },
  OFFLINE: {
    label: 'Ngoại tuyến',
    text: Colors.textMuted,
    bg: 'rgba(100, 116, 139, 0.2)',
    dot: Colors.textMuted,
  },
  MAINTENANCE: {
    label: 'Bảo trì',
    text: Colors.warning,
    bg: 'rgba(245, 158, 11, 0.15)',
    dot: Colors.warning,
  },
};

const CATEGORY_CONFIG: Record<
  FillCategory,
  { label: string; text: string; bg: string; dot: string }
> = {
  NORMAL: {
    label: 'Bình thường',
    text: Colors.brandHighlight,
    bg: 'rgba(16, 185, 129, 0.15)',
    dot: Colors.brandHighlight,
  },
  MONITOR: {
    label: 'Cần chú ý',
    text: Colors.warning,
    bg: 'rgba(245, 158, 11, 0.15)',
    dot: Colors.warning,
  },
  NEARLY_FULL: {
    label: 'Gần đầy',
    text: '#FB923C',
    bg: 'rgba(249, 115, 22, 0.15)',
    dot: '#F97316',
  },
  CRITICAL: {
    label: 'Đầy / Nguy hiểm',
    text: Colors.error,
    bg: 'rgba(239, 68, 68, 0.15)',
    dot: Colors.error,
  },
};

export const BinStatusBadge: React.FC<BinStatusBadgeProps> = ({
  status,
  fillCategory,
  showDot = true,
}) => {
  if (status) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.OFFLINE;
    return (
      <View style={[styles.badge, { backgroundColor: config.bg }]}>
        {showDot && <View style={[styles.dot, { backgroundColor: config.dot }]} />}
        <Text style={[styles.label, { color: config.text }]}>{config.label}</Text>
      </View>
    );
  }

  if (fillCategory) {
    const config = CATEGORY_CONFIG[fillCategory] || CATEGORY_CONFIG.NORMAL;
    return (
      <View style={[styles.badge, { backgroundColor: config.bg }]}>
        {showDot && <View style={[styles.dot, { backgroundColor: config.dot }]} />}
        <Text style={[styles.label, { color: config.text }]}>{config.label}</Text>
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
