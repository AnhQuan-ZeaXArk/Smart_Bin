import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { DeviceItem, DEVICE_TYPE_LABELS, DeviceType } from '../../types/device';
import { DeviceStatusBadge } from './DeviceStatusBadge';
import { formatRelativeTime, formatDateTime, formatUptime } from '../../utils/formatters';

interface DeviceHealthCardProps {
  device: DeviceItem;
}

function getDeviceIcon(type: DeviceType): string {
  switch (type) {
    case 'RASPBERRY_PI':
      return '🖥️';
    case 'ULTRASONIC_SENSOR':
      return '📡';
    case 'CAMERA':
      return '📷';
    case 'MQTT':
      return '🔄';
    default:
      return '⚡';
  }
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

export const DeviceHealthCard: React.FC<DeviceHealthCardProps> = ({ device }) => {
  const displayName = DEVICE_TYPE_LABELS[device.deviceType] || device.deviceName || device.deviceId;
  const icon = getDeviceIcon(device.deviceType);
  const metadata = parseDeviceMetadata(device.metadata);

  return (
    <View style={styles.card}>
      {/* Header Row: Icon + Name + Status Badge */}
      <View style={styles.headerRow}>
        <View style={styles.iconContainer}>
          <Text style={styles.iconText}>{icon}</Text>
        </View>

        <View style={styles.titleContainer}>
          <Text style={styles.deviceName}>{displayName}</Text>
          <Text style={styles.deviceIdText}>Mã thiết bị: {device.deviceId}</Text>
        </View>

        <DeviceStatusBadge status={device.status} />
      </View>

      {/* Main Status & Heartbeat Box */}
      <View style={styles.statusBox}>
        <View style={styles.statusCol}>
          <Text style={styles.metaLabel}>Nhịp tim gần nhất (Heartbeat)</Text>
          <Text style={styles.metaValueHighlight}>
            {device.lastHeartbeat ? formatRelativeTime(device.lastHeartbeat) : 'Chưa nhận tín hiệu'}
          </Text>
          <Text style={styles.metaSub}>
            {device.lastHeartbeat ? formatDateTime(device.lastHeartbeat) : '--:-- --/--/----'}
          </Text>
        </View>

        <View style={styles.statusDivider} />

        <View style={styles.statusCol}>
          <Text style={styles.metaLabel}>Hoạt động liên tục (Uptime)</Text>
          <Text style={styles.metaValueHighlight}>
            {formatUptime(device.uptime)}
          </Text>
          <Text style={styles.metaSub}>
            Tín hiệu cuối: {formatRelativeTime(device.lastSeen)}
          </Text>
        </View>
      </View>

      {/* Hardware Details & Specs Grid */}
      <View style={styles.specsGrid}>
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Phân loại thiết bị</Text>
          <Text style={styles.specValue}>{device.deviceType}</Text>
        </View>

        {device.firmwareVersion && (
          <View style={styles.specItem}>
            <Text style={styles.specLabel}>Phiên bản Firmware</Text>
            <Text style={styles.specValue}>v{device.firmwareVersion}</Text>
          </View>
        )}

        {device.ipAddress && (
          <View style={styles.specItem}>
            <Text style={styles.specLabel}>Địa chỉ IP</Text>
            <Text style={styles.specValue}>{device.ipAddress}</Text>
          </View>
        )}
      </View>

      {/* Device-Specific Telemetry Metadata */}
      {metadata && Object.keys(metadata).length > 0 && (
        <View style={styles.metadataBox}>
          <Text style={styles.metadataTitle}>THÔNG SỐ HOẠT ĐỘNG THỰC TẾ</Text>
          <View style={styles.metadataList}>
            {metadata.distanceCm !== undefined && (
              <View style={styles.metaRow}>
                <Text style={styles.metaRowLabel}>Khoảng cách đo siêu âm:</Text>
                <Text style={styles.metaRowValue}>{String(metadata.distanceCm)} cm</Text>
              </View>
            )}
            {metadata.fillLevel !== undefined && (
              <View style={styles.metaRow}>
                <Text style={styles.metaRowLabel}>Mức đầy tính toán:</Text>
                <Text style={styles.metaRowValue}>{String(metadata.fillLevel)}%</Text>
              </View>
            )}
            {metadata.aiModel !== undefined && (
              <View style={styles.metaRow}>
                <Text style={styles.metaRowLabel}>Mô hình AI thị giác:</Text>
                <Text style={styles.metaRowValue}>
                  {String(metadata.aiModel)}
                  {metadata.confidence !== undefined
                    ? ` (${(Number(metadata.confidence) * 100).toFixed(0)}%)`
                    : ''}
                </Text>
              </View>
            )}
            {metadata.broker !== undefined && (
              <View style={styles.metaRow}>
                <Text style={styles.metaRowLabel}>Địa chỉ Broker:</Text>
                <Text style={styles.metaRowValue}>{String(metadata.broker)}</Text>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconText: {
    fontSize: 20,
  },
  titleContainer: {
    flex: 1,
    marginRight: 8,
  },
  deviceName: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.2,
  },
  deviceIdText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  statusBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.4)',
    marginBottom: 12,
  },
  statusCol: {
    flex: 1,
  },
  statusDivider: {
    width: 1,
    backgroundColor: 'rgba(51, 65, 85, 0.5)',
    marginHorizontal: 10,
  },
  metaLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    marginBottom: 3,
  },
  metaValueHighlight: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.brandHighlight,
  },
  metaSub: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  specsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  specItem: {
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.3)',
  },
  specLabel: {
    fontSize: 9,
    color: Colors.textMuted,
  },
  specValue: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textPrimary,
    marginTop: 1,
  },
  metadataBox: {
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.3)',
  },
  metadataTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  metadataList: {
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaRowLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  metaRowValue: {
    fontSize: 11,
    color: Colors.brandHighlight,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});
