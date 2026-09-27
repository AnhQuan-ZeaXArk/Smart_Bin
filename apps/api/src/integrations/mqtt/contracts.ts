import { z } from 'zod';

const isoTimestamp = z.string().datetime({ offset: true });
const binCode = z.string().trim().min(1).max(40);

export const ultrasonicTelemetrySchema = z.object({
  binCode,
  distanceCm: z.number().finite().min(0),
  fillLevel: z.number().int().min(0).max(100),
  timestamp: isoTimestamp,
  deviceId: z.string().trim().min(1).optional()
});
export type UltrasonicTelemetry = z.infer<typeof ultrasonicTelemetrySchema>;

export const deviceStatusSchema = z.object({
  binCode,
  status: z.enum(['ONLINE', 'OFFLINE', 'MAINTENANCE']),
  deviceId: z.string().trim().min(1).optional(),
  timestamp: isoTimestamp
});
export type DeviceStatusMessage = z.infer<typeof deviceStatusSchema>;

export const deviceHeartbeatSchema = z.object({
  deviceId: z.string().trim().min(1).max(64),
  deviceName: z.string().trim().min(1).max(120).optional(),
  deviceType: z.enum(['RASPBERRY_PI', 'ULTRASONIC_SENSOR', 'CAMERA', 'MQTT']).optional(),
  status: z.enum(['ONLINE', 'WARNING', 'OFFLINE']).default('ONLINE'),
  ipAddress: z.string().trim().max(45).optional().nullable(),
  uptime: z.number().int().nonnegative().optional().nullable(),
  firmwareVersion: z.string().trim().max(32).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  timestamp: isoTimestamp.optional()
});
export type DeviceHeartbeat = z.infer<typeof deviceHeartbeatSchema>;

export * from '../realtime/realtime.contract.js';
