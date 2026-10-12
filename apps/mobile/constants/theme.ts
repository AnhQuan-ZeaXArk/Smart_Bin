import { Platform, ViewStyle } from 'react-native';
import { Colors, Tones, ToneName } from './colors';
import type { IconName } from '../components/ui/Icon';
import { BinStatus, DeviceStatus, DeviceType, FillCategory, AlertSeverity } from '../types/dashboard';
import { CollectionStatus } from '../types/collection';

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const Radius = { sm: 6, md: 8, lg: 12, pill: 999 } as const;

export const FontSize = {
  micro: 10,
  caption: 11,
  small: 12,
  body: 13,
  base: 14,
  title: 17,
  heading: 22,
  display: 30,
} as const;

export const Mono = Platform.select({ android: 'monospace', default: 'Menlo' });

export const Shadow: Record<'card' | 'raised', ViewStyle> = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  raised: {
    shadowColor: '#10B981',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
};

/** Fill-level tone from the backend fillCategory (same mapping as web translateFillCategory). */
export const FILL_TONE: Record<FillCategory, ToneName> = {
  NORMAL: 'normal',
  MONITOR: 'monitor',
  NEARLY_FULL: 'nearlyFull',
  CRITICAL: 'critical',
};

export const FILL_LABEL: Record<FillCategory, string> = {
  NORMAL: 'Bình thường',
  MONITOR: 'Cần theo dõi',
  NEARLY_FULL: 'Gần đầy',
  CRITICAL: 'Đầy',
};

export const BIN_STATUS_TONE: Record<BinStatus, ToneName> = {
  ONLINE: 'normal',
  OFFLINE: 'critical',
  MAINTENANCE: 'neutral',
};

export const BIN_STATUS_LABEL: Record<BinStatus, string> = {
  ONLINE: 'Trực tuyến',
  OFFLINE: 'Ngoại tuyến',
  MAINTENANCE: 'Bảo trì',
};

export const DEVICE_STATUS_TONE: Record<DeviceStatus, ToneName> = {
  ONLINE: 'normal',
  WARNING: 'monitor',
  OFFLINE: 'critical',
};

export const DEVICE_ICON: Record<DeviceType, IconName> = {
  RASPBERRY_PI: 'cpu',
  ULTRASONIC_SENSOR: 'radio',
  CAMERA: 'camera',
  MQTT: 'server',
};

export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  ONLINE: 'Đang hoạt động',
  WARNING: 'Cần kiểm tra',
  OFFLINE: 'Mất kết nối',
};

export const SEVERITY_TONE: Record<AlertSeverity, ToneName> = {
  CRITICAL: 'critical',
  WARNING: 'monitor',
  INFO: 'info',
};

export const COLLECTION_TONE: Record<CollectionStatus, ToneName> = {
  COMPLETED: 'normal',
  IN_PROGRESS: 'info',
  PENDING: 'monitor',
  CANCELLED: 'neutral',
};

export function tone(name: ToneName) {
  return Tones[name];
}

export { Colors };
