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

export const nfcScanSchema = z.object({
  binCode,
  uid: z.string().trim().min(1),
  timestamp: isoTimestamp,
  deviceId: z.string().trim().min(1).optional()
});
export type NfcScan = z.infer<typeof nfcScanSchema>;

export const deviceStatusSchema = z.object({
  binCode,
  status: z.enum(['ONLINE', 'OFFLINE', 'MAINTENANCE']),
  deviceId: z.string().trim().min(1).optional(),
  timestamp: isoTimestamp
});
export type DeviceStatusMessage = z.infer<typeof deviceStatusSchema>;

export const lockCommandSchema = z.object({
  action: z.enum(['OPEN', 'CLOSE']),
  requestId: z.string().trim().min(1),
  timestamp: isoTimestamp
});
export type LockCommand = z.infer<typeof lockCommandSchema>;

export const nfcResultSchema = z.object({
  result: z.enum(['ALLOWED', 'DENIED']),
  reason: z.string(),
  action: z.literal('AUTHENTICATE'),
  uid: z.string(),
  timestamp: isoTimestamp
});
export type NfcResultMessage = z.infer<typeof nfcResultSchema>;
