/**
 * SmartBin Mobile Device Health Types
 * Matching API contracts from:
 * - GET /api/devices
 * - GET /api/devices/:id
 * - GET /api/devices/:id/health
 * - prisma/schema.prisma (DeviceStatus, DeviceType, DeviceStatusEnum)
 */

export type DeviceType = 'RASPBERRY_PI' | 'ULTRASONIC_SENSOR' | 'CAMERA' | 'MQTT';

export type DeviceStatus = 'ONLINE' | 'WARNING' | 'OFFLINE';

export interface DeviceItem {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  status: DeviceStatus;
  lastSeen: string;
  lastHeartbeat: string | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
  uptime: number | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceHealthSummary {
  total: number;
  online: number;
  warning: number;
  offline: number;
}

export interface DeviceFilters {
  status?: DeviceStatus | 'ALL';
  type?: DeviceType | 'ALL';
  search?: string;
}

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  RASPBERRY_PI: 'Raspberry Pi 5 Gateway',
  ULTRASONIC_SENSOR: 'Cảm biến siêu âm',
  CAMERA: 'Camera AI',
  MQTT: 'Kết nối MQTT Broker',
};

export const DEVICE_STATUS_LABELS: Record<DeviceStatus, string> = {
  ONLINE: 'Đang hoạt động',
  WARNING: 'Cần kiểm tra',
  OFFLINE: 'Mất kết nối',
};
