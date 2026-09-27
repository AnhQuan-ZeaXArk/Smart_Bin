export const DEVICE_HEALTH_CONFIG = {
  ONLINE_THRESHOLD_MS: 15_000,    // lastSeen < 15s -> ONLINE
  WARNING_THRESHOLD_MS: 30_000,   // 15s <= lastSeen < 30s -> WARNING
  OFFLINE_THRESHOLD_MS: 30_000,   // lastSeen >= 30s -> OFFLINE
  CHECK_INTERVAL_MS: 5_000        // Interval for evaluating device health status
} as const;

export type DeviceHealthThresholds = typeof DEVICE_HEALTH_CONFIG;
