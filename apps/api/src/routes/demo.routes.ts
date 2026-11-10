import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { DeviceType } from '@prisma/client';
import { realDeviceService } from '../demo/real-device.service.js';
import { deviceHealthService } from '../services/device-health.service.js';
import { authenticateDeviceToken, requireAuth, requireRole } from '../middleware/auth.js';
import { handleDeviceCommand } from './device.routes.js';
import { normalizeDeviceId } from '../config/device-id.config.js';
import { aiDetectionInputSchema } from '../integrations/realtime/ai-detection.schema.js';

const router = Router();

const compartmentFillHeartbeatSchema = z.object({
  distanceCm: z.coerce.number().optional().nullable(),
  fillLevel: z.coerce.number().optional().nullable(),
  fillPercent: z.coerce.number().optional().nullable(),
  status: z.string().optional().default('OK'),
  updatedAt: z.string().optional().nullable()
}).transform((data) => ({
  ...data,
  fillLevel: data.fillLevel ?? data.fillPercent ?? null
}));

const deviceHeartbeatSchema = z.object({
  deviceId: z.string().min(1, 'deviceId không được để trống'),
  deviceName: z.string().optional(),
  status: z.string().optional().default('ONLINE'),
  uptimeSeconds: z.coerce.number().nonnegative('uptimeSeconds phải là số không âm'),
  cpuTempC: z.coerce.number().optional().nullable(),
  firmwareVersion: z.string().optional().nullable(),
  ipAddress: z.string().optional().nullable(),
  sentAt: z.string().optional(),
  subsystems: z.object({
    yolo: z.string().optional(),
    camera: z.string().optional(),
    esp32: z.string().optional()
  }).optional().nullable(),
  aiDetection: aiDetectionInputSchema,
  sensors: z.object({
    distanceCm: z.coerce.number().optional().nullable(),
    fillLevel: z.coerce.number().optional().nullable(),
    organic: compartmentFillHeartbeatSchema.optional().nullable(),
    recyclable: compartmentFillHeartbeatSchema.optional().nullable(),
    nonRecyclable: compartmentFillHeartbeatSchema.optional().nullable()
  }).optional().nullable(),
  lidAlert: z.boolean().optional().default(false),
  metadata: z.record(z.string(), z.unknown()).optional().nullable()
});

/**
 * POST /api/demo/device-heartbeat
 * Endpoint nhận heartbeat từ Raspberry Pi 5 thật (tương thích ngược & HTTP fallback)
 */
router.post('/device-heartbeat', authenticateDeviceToken, (req: Request, res: Response) => {
  const parseResult = deviceHeartbeatSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return res.status(400).json({
      error: 'Bad Request',
      message: `Dữ liệu heartbeat không hợp lệ: ${errorDetails}`,
      details: parseResult.error.issues
    });
  }

  const io = req.app.get('io');
  const normalizedDeviceId = normalizeDeviceId(parseResult.data.deviceId);
  const normalizedData = {
    ...parseResult.data,
    deviceId: normalizedDeviceId
  };

  if (parseResult.data.lidAlert) {
    realDeviceService.triggerLidAlert({
      deviceId: normalizedDeviceId,
      stationCode: 'STATION_A',
      lidAlert: true
    });
  }

  // 1. Cập nhật RealDeviceService trong RAM và phát Socket.IO 'device:heartbeat' (0ms)
  const recordedStatus = realDeviceService.recordHeartbeat(normalizedData, io);

  // 2. Chuyển tiếp tới DeviceHealthService để xử lý logic heartbeat thống nhất (throttling 15s + PostgreSQL)
  void deviceHealthService.processHeartbeat({
    deviceId: normalizedDeviceId,
    deviceName: parseResult.data.deviceName,
    deviceType: DeviceType.RASPBERRY_PI,
    uptimeSeconds: parseResult.data.uptimeSeconds,
    cpuTempC: parseResult.data.cpuTempC,
    firmwareVersion: parseResult.data.firmwareVersion,
    ipAddress: parseResult.data.ipAddress,
    sentAt: parseResult.data.sentAt,
    sensors: parseResult.data.sensors,
    metadata: parseResult.data.metadata
  }).catch((err) => {
    console.error(`[DemoRoutes] Error processing HTTP heartbeat in DeviceHealthService:`, err);
  });

  return res.status(200).json({
    success: true,
    message: 'Nhận heartbeat thành công từ thiết bị',
    data: recordedStatus
  });
});

/**
 * GET /api/demo/device-status
 * Endpoint công khai cho Web/Mobile lấy trạng thái live của Pi thật
 */
router.get('/device-status', (_req: Request, res: Response) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');

  const status = realDeviceService.getStatus();
  return res.status(200).json({
    success: true,
    data: status
  });
});

/**
 * POST /api/demo/device-command
 * Backward-compatible alias cho POST /api/devices/command:
 * Cùng dùng requireAuth, requireRole('ADMIN', 'SUPERVISOR'), và handleDeviceCommand
 */
router.post('/device-command', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), handleDeviceCommand);

export default router;
