import type { AlertSeverity, AlertType, DeviceStatusEnum, DeviceType } from '@prisma/client';

/**
 * Standardized Socket.IO Realtime Event Names
 */
export const REALTIME_EVENTS = {
  DEVICE_STATUS: 'device:status',
  BIN_TELEMETRY: 'bin:telemetry',
  TELEMETRY: 'telemetry',
  ALERT_CREATED: 'alert:created',
  ALERT_RESOLVED: 'alert:resolved',
  ALERT_UPDATED: 'alert:updated',
  ALERT: 'alert',
  CONNECTED: 'realtime:connected'
} as const;

export type RealtimeEventName = typeof REALTIME_EVENTS[keyof typeof REALTIME_EVENTS];

/**
 * Standardized payload for `device:status` event
 */
export interface DeviceStatusPayload {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  status: DeviceStatusEnum;
  lastSeen: Date | string;
  lastHeartbeat?: Date | string | null;
  firmwareVersion?: string | null;
  ipAddress?: string | null;
  uptime?: number | null;
  metadata?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Standardized payload for `bin:telemetry` and `telemetry` events
 */
export interface RealtimeTelemetryPayload {
  binCode: string;
  fillLevel: number;
  currentFillLevel: number;
  fillCategory: string;
  distanceCm: number;
  distance: number;
  deviceId?: string;
  timestamp: string;
}

/**
 * Standardized payload for `alert:created`, `alert:resolved`, `alert:updated`, `alert` events
 */
export interface RealtimeAlertPayload {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  binId?: string | null;
  deviceId?: string | null;
  isResolved: boolean;
  createdAt: Date | string;
  resolvedAt?: Date | string | null;
}
