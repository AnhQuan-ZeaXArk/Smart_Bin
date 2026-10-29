import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { realDeviceService } from '../demo/real-device.service.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

const deviceHeartbeatSchema = z.object({
  deviceId: z.string().min(1, 'deviceId không được để trống'),
  status: z.string().optional().default('ONLINE'),
  uptimeSeconds: z.coerce.number().nonnegative('uptimeSeconds phải là số không âm'),
  cpuTempC: z.coerce.number().optional().nullable(),
  sentAt: z.string().optional(),
  sensors: z.object({
    distanceCm: z.coerce.number().optional().nullable(),
    fillLevel: z.coerce.number().optional().nullable()
  }).optional().nullable()
});

const deviceCommandSchema = z.object({
  deviceId: z.string().min(1).default('raspberry-pi-5'),
  action: z.enum(['PING', 'TRIGGER_ULTRASONIC'], {
    message: 'Chỉ cho phép các lệnh an toàn: PING hoặc TRIGGER_ULTRASONIC trong giai đoạn này'
  }),
  params: z.record(z.string(), z.unknown()).optional().default({})
});

/**
 * Middleware: Xác thực thiết bị bằng Bearer Token
 * Đọc token từ process.env.DEVICE_INGEST_TOKEN hoặc env.DEVICE_INGEST_TOKEN
 */
function authenticateDeviceToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Thiếu header Authorization: Bearer <DEVICE_INGEST_TOKEN>'
    });
  }

  const token = authHeader.slice(7).trim();
  const configuredToken = (process.env.DEVICE_INGEST_TOKEN || env.DEVICE_INGEST_TOKEN || '').trim();

  if (!configuredToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'DEVICE_INGEST_TOKEN chưa được cấu hình trên máy chủ'
    });
  }

  if (token !== configuredToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Token xác thực thiết bị không chính xác'
    });
  }

  return next();
}

/**
 * POST /api/demo/device-heartbeat
 * Endpoint nhận heartbeat từ Raspberry Pi 5 thật (tương thích ngược)
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
  const recordedStatus = realDeviceService.recordHeartbeat(parseResult.data, io);

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
 * Gửi lệnh điều khiển an toàn xuống Raspberry Pi 5 (PING hoặc TRIGGER_ULTRASONIC)
 */
router.post(
  '/device-command',
  requireAuth,
  requireRole('ADMIN', 'SUPERVISOR'),
  async (req: Request, res: Response) => {
    const parseResult = deviceCommandSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorDetails = parseResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return res.status(400).json({
        success: false,
        error: 'VALIDATION_ERROR',
        message: `Dữ liệu lệnh không hợp lệ: ${errorDetails}`,
        details: parseResult.error.issues
      });
    }

    const { action, params } = parseResult.data;
    const currentStatus = realDeviceService.getStatus();

    if (currentStatus.status === 'OFFLINE') {
      return res.status(409).json({
        success: false,
        error: 'DEVICE_OFFLINE',
        message: 'Thiết bị Raspberry Pi 5 hiện đang OFFLINE. Không thể gửi lệnh lúc này.'
      });
    }

    try {
      const result = await realDeviceService.dispatchCommand(action, params);
      return res.status(200).json({
        success: true,
        commandId: result.commandId,
        action: result.action,
        status: result.status,
        message: result.message || `Lệnh ${action} đã thực thi thành công trên Raspberry Pi 5`,
        latencyMs: result.latencyMs,
        result: result.result
      });
    } catch (error: any) {
      if (error?.code === 'DEVICE_OFFLINE') {
        return res.status(409).json({
          success: false,
          error: 'DEVICE_OFFLINE',
          message: error.message
        });
      }
      if (error?.code === 'COMMAND_TIMEOUT') {
        return res.status(504).json({
          success: false,
          error: 'COMMAND_TIMEOUT',
          message: error.message
        });
      }
      return res.status(422).json({
        success: false,
        error: error?.code || 'COMMAND_FAILED',
        message: error.message || 'Lệnh thực thi thất bại trên thiết bị',
        details: error?.details
      });
    }
  }
);

export default router;

