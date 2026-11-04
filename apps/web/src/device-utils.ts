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

export const CANONICAL_PI_DEVICE_ID = 'raspberry-pi-5';
export const LEGACY_PI_DEVICE_ID = 'raspberry-pi-01';

/**
 * Chuẩn hóa Device ID về ID canonical ('raspberry-pi-5').
 * Nếu ID là 'raspberry-pi-01' hoặc 'raspberry-pi-5', luôn trả về 'raspberry-pi-5'.
 * Các thiết bị khác ('ultrasonic-01', 'camera-01', 'mqtt-broker-01', ...) được giữ nguyên.
 */
export function normalizeDeviceId(deviceId: string | null | undefined): string {
  if (!deviceId) return '';
  const trimmed = deviceId.trim();
  if (trimmed === LEGACY_PI_DEVICE_ID || trimmed === CANONICAL_PI_DEVICE_ID) {
    return CANONICAL_PI_DEVICE_ID;
  }
  return trimmed;
}

/**
 * Kiểm tra xem một Device ID hoặc type có thuộc về thiết bị cổng Raspberry Pi 5 hay không.
 */
export function isRaspberryPiDevice(deviceId: string | null | undefined, deviceType?: string | null): boolean {
  if (deviceType === 'RASPBERRY_PI') return true;
  if (!deviceId) return false;
  return normalizeDeviceId(deviceId) === CANONICAL_PI_DEVICE_ID;
}

export function parseTimestamp(value: string | Date | null | undefined): number {
  if (!value) return 0;
  try {
    const d = typeof value === 'string' ? new Date(value) : value;
    const time = d.getTime();
    return isNaN(time) ? 0 : time;
  } catch {
    return 0;
  }
}

/**
 * Timestamp guard quyết định xem một gói tin mới (từ Socket hoặc REST) có bị loại bỏ hay không.
 *
 * Quy tắc:
 * 1. Nếu state hiện tại chưa có timestamp hợp lệ (currentTs <= 0):
 *    -> Tiếp nhận gói tin đầu tiên (dù có hay không có timestamp) để khởi tạo giao diện.
 * 2. Nếu state hiện tại đã có timestamp hợp lệ (currentTs > 0):
 *    -> Nếu gói tin mới không có timestamp hợp lệ (incomingTs <= 0): BỎ QUA (không cho phép ghi đè dữ liệu mới hơn).
 *    -> Nếu gói tin mới có timestamp nhỏ hơn timestamp hiện tại (incomingTs < currentTs): BỎ QUA (sự kiện trễ đến muộn).
 *    -> Nếu incomingTs >= currentTs: TIẾP NHẬN.
 */
export function shouldDropIncoming(currentTs: number, incomingTs: number): boolean {
  if (currentTs <= 0) {
    return false;
  }
  if (incomingTs <= 0 || incomingTs < currentTs) {
    return true;
  }
  return false;
}

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
