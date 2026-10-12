import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Tones } from '../../constants/colors';
import { DEVICE_ICON, DEVICE_STATUS_TONE, FontSize, Mono, Radius, Shadow, Spacing } from '../../constants/theme';
import { DeviceItem, DEVICE_TYPE_LABELS } from '../../types/device';
import { DeviceStatusBadge } from './DeviceStatusBadge';
import { formatRelativeTime, formatDateTime, formatUptime } from '../../utils/formatters';
import { Icon } from '../ui/Icon';
import { FadeIn } from '../ui/motion';

interface DeviceHealthCardProps {
  device: DeviceItem;
  index?: number;
}

function parseDeviceMetadata(metadataStr: string | null): Record<string, unknown> | null {
  if (!metadataStr) return null;
  try {
    const parsed = JSON.parse(metadataStr);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const Row: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={2}>
      {value}
    </Text>
  </View>
);

export const DeviceHealthCard: React.FC<DeviceHealthCardProps> = ({ device, index = 0 }) => {
  const displayName = DEVICE_TYPE_LABELS[device.deviceType] || device.deviceName || device.deviceId;
  const metadata = parseDeviceMetadata(device.metadata);
  const tone = Tones[DEVICE_STATUS_TONE[device.status] ?? 'critical'];

  return (
    <FadeIn delay={Math.min(index, 5) * 60} style={styles.wrapper}>
      <View style={[styles.card, { borderTopColor: tone.solid }]}>
        <View style={styles.headerRow}>
          <View style={[styles.iconContainer, { backgroundColor: tone.bg, borderColor: tone.border }]}>
            <Icon name={DEVICE_ICON[device.deviceType] ?? 'activity'} size={18} color={tone.text} />
          </View>
          <View style={styles.titleContainer}>
            <Text style={styles.deviceName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.deviceIdText} numberOfLines={1}>
              {device.deviceId}
            </Text>
          </View>
          <DeviceStatusBadge status={device.status} />
        </View>

        <View style={styles.list}>
          <Row label="Loại thiết bị" value={DEVICE_TYPE_LABELS[device.deviceType] || device.deviceType} />
          <Row label="Lần hoạt động cuối" value={formatRelativeTime(device.lastSeen)} />
          <Row
            label="Heartbeat cuối"
            value={device.lastHeartbeat ? formatDateTime(device.lastHeartbeat) : 'Chưa có dữ liệu'}
          />
          <Row label="Uptime" value={formatUptime(device.uptime)} />
          {device.ipAddress ? <Row label="Địa chỉ IP" value={device.ipAddress} mono /> : null}
          {device.firmwareVersion ? <Row label="Firmware" value={`v${device.firmwareVersion}`} /> : null}
        </View>

        {metadata && Object.keys(metadata).length > 0 && (
          <View style={styles.metadataBox}>
            <Text style={styles.metadataTitle}>THÔNG SỐ HOẠT ĐỘNG</Text>
            {metadata.distanceCm !== undefined && <Row label="Khoảng cách đo siêu âm" value={`${String(metadata.distanceCm)} cm`} mono />}
            {metadata.fillLevel !== undefined && <Row label="Mức đầy" value={`${String(metadata.fillLevel)}%`} mono />}
            {metadata.aiModel !== undefined && (
              <Row
                label="Mô hình AI"
                value={`${String(metadata.aiModel)}${metadata.confidence !== undefined ? ` (${(Number(metadata.confidence) * 100).toFixed(0)}%)` : ''}`}
                mono
              />
            )}
            {metadata.broker !== undefined && <Row label="Địa chỉ Broker" value={String(metadata.broker)} mono />}
          </View>
        )}
      </View>
    </FadeIn>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: Spacing.md,
  },
  card: {
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderTopWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceCard,
    ...Shadow.card,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
    minWidth: 0,
  },
  deviceName: {
    fontSize: FontSize.base,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  deviceIdText: {
    fontSize: FontSize.micro,
    color: '#9AB1C4',
    fontFamily: Mono,
    marginTop: 2,
  },
  list: {
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: 6,
  },
  rowLabel: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
  },
  rowValue: {
    flexShrink: 1,
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    fontWeight: '700',
    textAlign: 'right',
  },
  mono: {
    fontFamily: Mono,
    color: Colors.brandHighlight,
  },
  metadataBox: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#111F2F',
  },
  metadataTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: Colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
});
