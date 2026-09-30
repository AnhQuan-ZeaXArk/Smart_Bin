import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { RealtimeConnectionStatus } from '../../types/alert';

interface RealtimeStatusBadgeProps {
  status: RealtimeConnectionStatus;
}

const STATUS_CONFIG: Record<
  RealtimeConnectionStatus,
  { label: string; dot: string; color: string; bg: string; border: string }
> = {
  connected: {
    label: 'Realtime: Đã kết nối',
    dot: Colors.success,
    color: Colors.success,
    bg: Colors.successLight,
    border: Colors.successBorder,
  },
  connecting: {
    label: 'Realtime: Đang kết nối...',
    dot: Colors.warning,
    color: Colors.warning,
    bg: Colors.warningLight,
    border: Colors.warningBorder,
  },
  reconnecting: {
    label: 'Realtime: Đang thử lại...',
    dot: Colors.warning,
    color: Colors.warning,
    bg: Colors.warningLight,
    border: Colors.warningBorder,
  },
  disconnected: {
    label: 'Realtime: Mất kết nối',
    dot: Colors.textMuted,
    color: Colors.textMuted,
    bg: 'rgba(100, 116, 139, 0.15)',
    border: Colors.border,
  },
  error: {
    label: 'Realtime: Lỗi kết nối',
    dot: Colors.error,
    color: Colors.error,
    bg: Colors.errorLight,
    border: Colors.errorBorder,
  },
};

export const RealtimeStatusBadge: React.FC<RealtimeStatusBadgeProps> = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;

  return (
    <View style={[styles.badge, { backgroundColor: config.bg, borderColor: config.border }]}>
      <View style={[styles.dot, { backgroundColor: config.dot }]} />
      <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
