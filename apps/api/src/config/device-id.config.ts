export const CANONICAL_DEVICE_ID = 'raspberry-pi-5';
export const LEGACY_DEVICE_ID = 'raspberry-pi-01';

/**
 * Chuẩn hóa Device ID về ID canonical ('raspberry-pi-5').
 * Nếu ID là 'raspberry-pi-01' hoặc 'raspberry-pi-5', luôn trả về 'raspberry-pi-5'.
 * Các thiết bị khác ('ultrasonic-01', 'camera-01', 'mqtt-broker-01', ...) được giữ nguyên.
 */
export function normalizeDeviceId(deviceId: string | null | undefined): string {
  if (!deviceId) return '';
  const trimmed = deviceId.trim();
  if (trimmed === LEGACY_DEVICE_ID || trimmed === CANONICAL_DEVICE_ID) {
    return CANONICAL_DEVICE_ID;
  }
  return trimmed;
}

/**
 * Kiểm tra xem một Device ID hoặc type có thuộc về thiết bị cổng Raspberry Pi 5 hay không.
 */
export function isRaspberryPiDeviceId(deviceId: string | null | undefined, deviceType?: string | null): boolean {
  if (deviceType === 'RASPBERRY_PI') return true;
  if (!deviceId) return false;
  return normalizeDeviceId(deviceId) === CANONICAL_DEVICE_ID;
}

