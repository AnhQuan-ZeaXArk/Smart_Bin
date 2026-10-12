import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tones, ToneName } from '../../constants/colors';
import { RealtimeConnectionStatus } from '../../types/alert';
import { StatusDot } from '../ui/motion';

interface RealtimeStatusBadgeProps {
  status: RealtimeConnectionStatus;
}

const STATUS_CONFIG: Record<RealtimeConnectionStatus, { label: string; tone: ToneName; pulse: boolean }> = {
  connected: { label: 'Realtime: Đã kết nối', tone: 'normal', pulse: true },
  connecting: { label: 'Realtime: Đang kết nối...', tone: 'monitor', pulse: false },
  reconnecting: { label: 'Realtime: Đang thử lại...', tone: 'monitor', pulse: false },
  disconnected: { label: 'Realtime: Mất kết nối', tone: 'neutral', pulse: false },
  error: { label: 'Realtime: Lỗi kết nối', tone: 'critical', pulse: false },
};

export const RealtimeStatusBadge: React.FC<RealtimeStatusBadgeProps> = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;
  const t = Tones[config.tone];

  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]}>
      <StatusDot color={t.solid} pulse={config.pulse} size={5} />
      <Text style={[styles.label, { color: t.text }]} numberOfLines={1}>
        {config.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
});
