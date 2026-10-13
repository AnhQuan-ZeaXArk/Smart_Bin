import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { realDeviceService } from '../demo/real-device.service.js';

const router = Router();

const deviceHeartbeatSchema = z.object({
  deviceId: z.string().min(1, 'deviceId không được để trống'),
  status: z.string().optional().default('ONLINE'),
  uptimeSeconds: z.coerce.number().nonnegative('uptimeSeconds phải là số không âm'),
  cpuTempC: z.coerce.number().optional().nullable(),
  sentAt: z.string().optional()
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
 * Endpoint nhận heartbeat từ Raspberry Pi 5 thật
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

export default router;
