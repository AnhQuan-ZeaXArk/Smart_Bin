export const DEVICE_HEALTH_CONFIG = {
  ONLINE_THRESHOLD_MS: 15_000,    // elapsed < 15s -> ONLINE
  WARNING_THRESHOLD_MS: 30_000,   // 15s <= elapsed < 30s -> WARNING
  OFFLINE_THRESHOLD_MS: 30_000,   // elapsed >= 30s -> OFFLINE
  ONLINE_THRESHOLD_SECONDS: 15,
  WARNING_THRESHOLD_SECONDS: 30,
  OFFLINE_THRESHOLD_SECONDS: 30,
  STALE_THRESHOLD_SECONDS: 15,    // Tương thích ngược với RealDeviceCard frontend (15s cảnh báo)
  CHECK_INTERVAL_MS: 5_000        // Chu kỳ đánh giá sức khỏe thiết bị
} as const;

export type DeviceHealthThresholds = typeof DEVICE_HEALTH_CONFIG;

export {
  CANONICAL_DEVICE_ID,
  LEGACY_DEVICE_ID,
  normalizeDeviceId,
  isRaspberryPiDeviceId
} from './device-id.config.js';


