import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { DashboardDevice, DeviceStatus, DeviceType } from '../../types/dashboard';
import { formatTime } from '../../utils/formatters';

interface DeviceHealthCardProps {
  devices: DashboardDevice[];
  onViewAllDevices?: () => void;
}

const DEVICE_LABELS: Record<DeviceType, string> = {
  RASPBERRY_PI: 'Raspberry Pi 5 Gateway',
  ULTRASONIC_SENSOR: 'Cảm biến siêu âm',
  CAMERA: 'Camera AI',
  MQTT: 'Kết nối MQTT Broker',
};

function getStatusBadge(status: DeviceStatus) {
  switch (status) {
    case 'ONLINE':
      return {
        label: 'Đang hoạt động',
        color: Colors.success,
        bg: Colors.successLight,
        border: Colors.successBorder,
      };
    case 'WARNING':
      return {
        label: 'Cần kiểm tra',
        color: Colors.warning,
        bg: Colors.warningLight,
        border: Colors.warningBorder,
      };
    case 'OFFLINE':
      return {
        label: 'Mất kết nối',
        color: Colors.error,
        bg: Colors.errorLight,
        border: Colors.errorBorder,
      };
    default:
      return {
        label: status,
        color: Colors.textMuted,
        bg: Colors.surfaceCardElevated,
        border: Colors.border,
      };
  }
}

export const DeviceHealthCard: React.FC<DeviceHealthCardProps> = ({
  devices,
  onViewAllDevices,
}) => {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>TRẠNG THÁI THIẾT BỊ IOT</Text>
          <Text style={styles.subtitle}>Giám sát phần cứng và truyền thông</Text>
        </View>
        {onViewAllDevices && (
          <TouchableOpacity
            style={styles.viewAllButton}
            activeOpacity={0.7}
            onPress={onViewAllDevices}
          >
            <Text style={styles.viewAllText}>Xem tất cả →</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.list}>
        {devices.map((device) => {
          const badgeMeta = getStatusBadge(device.status);
          const displayName = DEVICE_LABELS[device.deviceType] || device.deviceName || device.deviceId;

          return (
            <View key={device.id || device.deviceId} style={styles.deviceRow}>
              <View style={styles.deviceInfo}>
                <View style={styles.nameRow}>
                  <View style={[styles.statusDot, { backgroundColor: badgeMeta.color }]} />
                  <Text style={styles.deviceName}>{displayName}</Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.deviceIdText}>ID: {device.deviceId}</Text>
                  {device.lastHeartbeat && (
                    <Text style={styles.heartbeatText}>
                      • Nhịp tim: {formatTime(new Date(device.lastHeartbeat))}
                    </Text>
                  )}
                </View>
              </View>

              <View
                style={[
                  styles.badge,
                  { backgroundColor: badgeMeta.bg, borderColor: badgeMeta.border },
                ]}
              >
                <Text style={[styles.badgeText, { color: badgeMeta.color }]}>
                  {badgeMeta.label}
                </Text>
              </View>
            </View>
          );
        })}

        {devices.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Chưa có thông tin thiết bị từ hệ thống.</Text>
          </View>
        )}
      </View>
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
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  viewAllButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  viewAllText: {
    fontSize: 12,
    color: Colors.brandHighlight,
    fontWeight: '700',
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1.2,
  },
  subtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  list: {
    gap: 8,
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  deviceInfo: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  deviceName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    flexWrap: 'wrap',
  },
  deviceIdText: {
    fontSize: 10,
    color: Colors.textMuted,
    fontFamily: 'monospace',
  },
  heartbeatText: {
    fontSize: 10,
    color: Colors.textMuted,
    marginLeft: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
});
