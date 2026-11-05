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
  CONNECTED: 'realtime:connected',
  DEVICE_HEARTBEAT: 'device:heartbeat',
  DEVICE_TELEMETRY: 'device:telemetry',
  DEVICE_COMMAND: 'device:command',
  DEVICE_COMMAND_ACK: 'device:command:ack',
  DEVICE_COMMAND_STATUS: 'device:command:status'
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

/**
 * Payload sent from Backend to Pi to dispatch a command
 */
export interface DeviceCommandPayload {
  commandId: string;
  deviceId: string;
  action: 'PING' | 'TRIGGER_ULTRASONIC';
  params?: Record<string, unknown>;
  issuedAt: string;
}

/**
 * Payload sent from Pi back to Backend to acknowledge a command
 */
export interface DeviceCommandAckPayload {
  commandId: string;
  deviceId: string;
  action: string;
  status: 'RECEIVED' | 'COMPLETED' | 'FAILED';
  message?: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  executedAt?: string;
}

/**
 * Payload emitted by Backend to Web clients to inform of command status
 */
export interface DeviceCommandStatusPayload {
  commandId: string;
  deviceId: string;
  action: string;
  status: 'PENDING' | 'RECEIVED' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
  message?: string;
  latencyMs?: number;
  result?: Record<string, unknown> | null;
  error?: string | null;
  updatedAt: string;
}

/**
 * Dữ liệu đo mức đầy của một ngăn rác cụ thể
 */
export interface CompartmentFillData {
  distanceCm?: number | null;
  fillLevel?: number | null;
  status?: 'OK' | 'OUT_OF_RANGE' | 'SENSOR_ERROR' | 'STALE' | 'NOT_ATTACHED' | string;
  updatedAt?: string | null;
}

/**
 * Cấu trúc dữ liệu cảm biến siêu âm đa ngăn (Multi-Compartment)
 */
export interface MultiCompartmentSensorsData {
  distanceCm?: number | null;
  fillLevel?: number | null;
  organic?: CompartmentFillData | null;
  recyclable?: CompartmentFillData | null;
  nonRecyclable?: CompartmentFillData | null;
}

/**
 * Trạng thái hoạt động của các hệ thống con trên Raspberry Pi 5
 */
export interface SubsystemStatus {
  yolo?: 'RUNNING' | 'STOPPED' | 'ERROR' | 'UNAVAILABLE' | string;
  camera?: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | string;
  esp32?: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | string;
}

/**
 * Kết quả nhận diện gần nhất từ mô hình thị giác máy tính YOLO
 * confidence: số thực trong khoảng [0, 1] (ví dụ 0.958 = 95.8%).
 * Được kiểm tra bởi aiDetectionStrictSchema (ai-detection.schema.ts).
 */
export interface AiDetectionResult {
  class: string;
  rawClass?: string;
  confidence: number;
  inferenceTimeMs?: number | null;
  timestamp: string;
}


