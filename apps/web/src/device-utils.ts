export type DeviceType = 'RASPBERRY_PI' | 'ULTRASONIC_SENSOR' | 'CAMERA' | 'MQTT';
export type DeviceStatusEnum = 'ONLINE' | 'WARNING' | 'OFFLINE';

export interface DeviceItem {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  status: DeviceStatusEnum;
  lastSeen: string;
  lastHeartbeat: string | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
  uptime: number | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeviceHealthDetail {
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  status: DeviceStatusEnum;
  lastSeen: string;
  lastHeartbeat: string | null;
  uptime: number | null;
  firmwareVersion: string | null;
  ipAddress: string | null;
  metadata: unknown;
  health?: {
    onlineThresholdMs: number;
    warningThresholdMs: number;
    offlineThresholdMs: number;
  };
}

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  RASPBERRY_PI: 'Raspberry Pi 5',
  ULTRASONIC_SENSOR: 'Cảm biến siêu âm',
  CAMERA: 'Camera AI',
  MQTT: 'MQTT Broker'
};

export const STATUS_LABELS: Record<DeviceStatusEnum, string> = {
  ONLINE: 'Đang hoạt động',
  WARNING: 'Cần kiểm tra',
  OFFLINE: 'Mất kết nối'
};

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return 'Chưa có dữ liệu';
  try {
    const d = typeof value === 'string' ? new Date(value) : value;
    if (isNaN(d.getTime())) return 'Chưa có dữ liệu';
    return d.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch {
    return 'Chưa có dữ liệu';
  }
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return 'Chưa có dữ liệu';
  if (seconds < 60) return `${seconds} giây`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes} phút ${remainingSeconds > 0 ? `${remainingSeconds}s` : ''}`.trim();
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return `${hours} giờ ${remainingMinutes > 0 ? `${remainingMinutes}p` : ''}`.trim();
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days} ngày ${remainingHours > 0 ? `${remainingHours}h` : ''}`.trim();
}
