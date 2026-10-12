import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Tones } from '../../constants/colors';
import {
  DEVICE_ICON,
  DEVICE_STATUS_LABEL,
  DEVICE_STATUS_TONE,
  FontSize,
  Mono,
  Radius,
  Spacing,
} from '../../constants/theme';
import { DashboardDevice } from '../../types/dashboard';
import { DEVICE_TYPE_LABELS } from '../../types/device';
import { formatRelativeTime } from '../../utils/formatters';
import { Badge, Card, SectionHeader, StateCard } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { FadeIn } from '../ui/motion';

interface DeviceHealthCardProps {
  devices: DashboardDevice[];
  onViewAllDevices?: () => void;
}

export const DeviceHealthCard: React.FC<DeviceHealthCardProps> = ({
  devices,
  onViewAllDevices,
}) => {
  return (
    <Card style={styles.card}>
      <SectionHeader
        title="Tình trạng thiết bị"
        subtitle="Giám sát phần cứng và truyền thông"
        actionLabel={onViewAllDevices ? 'Xem tất cả' : undefined}
        onAction={onViewAllDevices}
      />

      {devices.length === 0 ? (
        <StateCard kind="empty" icon="cpu" title="Chưa có thiết bị" message="Chưa có thông tin thiết bị từ hệ thống." />
      ) : (
        <View style={styles.list}>
          {devices.map((device, index) => {
            const tone = DEVICE_STATUS_TONE[device.status] ?? 'neutral';
            const t = Tones[tone];
            const displayName = DEVICE_TYPE_LABELS[device.deviceType] || device.deviceName || device.deviceId;

            return (
              <FadeIn key={device.id || device.deviceId} delay={index * 50}>
                <View style={[styles.deviceRow, { borderLeftColor: t.solid }]}>
                  <View style={[styles.iconBox, { backgroundColor: t.bg, borderColor: t.border }]}>
                    <Icon name={DEVICE_ICON[device.deviceType] ?? 'activity'} size={16} color={t.text} />
                  </View>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName} numberOfLines={1}>
                      {displayName}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {device.deviceId} • {formatRelativeTime(device.lastSeen)}
                    </Text>
                  </View>
                  <Badge tone={tone} label={DEVICE_STATUS_LABEL[device.status] ?? device.status} dot pulse={device.status === 'ONLINE'} />
                </View>
              </FadeIn>
            );
          })}
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
  },
  list: {
    gap: Spacing.sm,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: Colors.border,
    backgroundColor: '#111F2F',
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceInfo: {
    flex: 1,
    minWidth: 0,
  },
  deviceName: {
    fontSize: FontSize.body,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  meta: {
    fontSize: FontSize.micro,
    color: Colors.textMuted,
    fontFamily: Mono,
    marginTop: 2,
  },
});
