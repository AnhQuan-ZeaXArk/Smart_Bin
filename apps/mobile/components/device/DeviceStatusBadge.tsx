import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { DeviceStatus, DEVICE_STATUS_LABELS } from '../../types/device';

interface DeviceStatusBadgeProps {
  status: DeviceStatus;
  size?: 'small' | 'medium';
}

const STATUS_CONFIG: Record<
  DeviceStatus,
  {
    label: string;
    icon: string;
    text: string;
    bg: string;
    border: string;
  }
> = {
  ONLINE: {
    label: DEVICE_STATUS_LABELS.ONLINE,
    icon: '✓',
    text: Colors.success,
    bg: Colors.successLight,
    border: Colors.successBorder,
  },
  WARNING: {
    label: DEVICE_STATUS_LABELS.WARNING,
    icon: '▲',
    text: Colors.warning,
    bg: Colors.warningLight,
    border: Colors.warningBorder,
  },
  OFFLINE: {
    label: DEVICE_STATUS_LABELS.OFFLINE,
    icon: '✕',
    text: Colors.error,
    bg: Colors.errorLight,
    border: Colors.errorBorder,
  },
};

export const DeviceStatusBadge: React.FC<DeviceStatusBadgeProps> = ({
  status,
  size = 'medium',
}) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.OFFLINE;
  const isSmall = size === 'small';

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: config.bg, borderColor: config.border },
        isSmall && styles.badgeSmall,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Trạng thái: ${config.label}`}
    >
      <View style={[styles.iconContainer, { backgroundColor: config.text }]}>
        <Text style={styles.iconText}>{config.icon}</Text>
      </View>
      <Text
        style={[
          styles.labelText,
          { color: config.text },
          isSmall && styles.labelTextSmall,
        ]}
      >
        {config.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  badgeSmall: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  iconContainer: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: '#0B1120',
    fontSize: 9,
    fontWeight: '900',
  },
  labelText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  labelTextSmall: {
    fontSize: 10,
  },
});
