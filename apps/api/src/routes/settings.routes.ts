import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { settingsService } from '../services/settings.service.js';
import type { RealtimeGateway } from '../integrations/realtime/realtime.gateway.js';

const router = Router();

// Rate limiter bảo vệ endpoint công khai: Tối đa 20 yêu cầu cập nhật trong 1 phút cho mỗi client IP
const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_UPDATES_PER_WINDOW = 20;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function thresholdUpdateRateLimiter(request: Request, response: Response, next: () => void) {
  // Lấy IP client thực sự thông qua Express trust proxy (hỗ trợ Render/reverse proxy an toàn)
  const ip = request.ip || request.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  // Dọn dẹp các IP đã hết hạn khi bộ nhớ cache lớn
  if (rateLimitMap.size > 200) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }

  if (entry.count >= MAX_UPDATES_PER_WINDOW) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    response.setHeader('Retry-After', retryAfter);
    return response.status(429).json({
      success: false,
      message: 'Bạn đang gửi yêu cầu lưu cấu hình quá thường xuyên. Vui lòng thử lại sau giây lát.'
    });
  }

  entry.count += 1;
  return next();
}

const allowedOriginsSet = new Set(env.CORS_ORIGINS.map((o) => o.replace(/\/+$/, '')));

function isAllowedOrigin(origin: string): boolean {
  const clean = origin.trim().replace(/\/+$/, '');
  return (
    allowedOriginsSet.has(clean) ||
    clean.endsWith('.onrender.com') ||
    clean.includes('localhost') ||
    clean.includes('127.0.0.1')
  );
}

/**
 * Phòng chống CSRF và Cross-Origin Abuse:
 * Nếu request từ trình duyệt có header Origin hoặc Referer, bắt buộc phải thuộc danh sách origin được phép.
 */
function verifyOriginAndCsrf(request: Request, response: Response, next: () => void) {
  const origin = request.headers.origin;
  const referer = request.headers.referer;

  if (origin) {
    if (!isAllowedOrigin(origin)) {
      return response.status(403).json({
        success: false,
        message: 'Yêu cầu bị từ chối: Nguồn gốc (Origin) không được cấp phép.'
      });
    }
    return next();
  }

  if (referer) {
    try {
      const parsed = new URL(referer);
      if (!isAllowedOrigin(parsed.origin)) {
        return response.status(403).json({
          success: false,
          message: 'Yêu cầu bị từ chối: Nguồn gốc (Referer) không được cấp phép.'
        });
      }
    } catch {
      return response.status(403).json({
        success: false,
        message: 'Yêu cầu bị từ chối: Header Referer không hợp lệ.'
      });
    }
  }

  // Cho phép các yêu cầu không có Origin/Referer (server-to-server, curl, tests)
  return next();
}

// Schema chấp nhận cả camelCase và snake_case, kiểm tra kiểu số trong khoảng 0-100
const updateThresholdsSchema = z.object({
  warningThreshold: z.coerce.number().int().min(0).max(100).optional(),
  warning_threshold: z.coerce.number().int().min(0).max(100).optional(),
  nearFullThreshold: z.coerce.number().int().min(0).max(100).optional(),
  near_full_threshold: z.coerce.number().int().min(0).max(100).optional(),
  fullThreshold: z.coerce.number().int().min(0).max(100).optional(),
  full_threshold: z.coerce.number().int().min(0).max(100).optional()
}).transform((data) => ({
  warningThreshold: data.warningThreshold ?? data.warning_threshold,
  nearFullThreshold: data.nearFullThreshold ?? data.near_full_threshold,
  fullThreshold: data.fullThreshold ?? data.full_threshold
})).refine(
  (data) =>
    data.warningThreshold !== undefined &&
    data.nearFullThreshold !== undefined &&
    data.fullThreshold !== undefined,
  {
    message: 'Thiếu một hoặc nhiều ngưỡng cảnh báo (warningThreshold, nearFullThreshold, fullThreshold).'
  }
).refine(
  (data) =>
    data.warningThreshold! < data.nearFullThreshold! &&
    data.nearFullThreshold! < data.fullThreshold!,
  {
    message: 'Thứ tự ngưỡng không hợp lệ: phải thỏa mãn 0 <= Cảnh báo < Gần đầy < Đầy <= 100.'
  }
);

/**
 * GET /api/settings/thresholds (hoặc /api/settings)
 * Lấy cấu hình ngưỡng cảnh báo hiện tại từ PostgreSQL.
 * Mọi người dùng đều có quyền truy cập (không yêu cầu đăng nhập/Admin).
 */
async function handleGetThresholds(_request: Request, response: Response): Promise<Response> {
  try {
    const thresholds = await settingsService.getThresholds();
    return response.status(200).json({
      success: true,
      thresholds
    });
  } catch (error) {
    console.error('[SettingsRoutes] Error fetching thresholds:', error);
    return response.status(500).json({
      success: false,
      message: 'Không thể tải cấu hình ngưỡng cảnh báo.'
    });
  }
}

/**
 * PUT/PATCH /api/settings/thresholds (hoặc /api/settings)
 * Cập nhật cấu hình ngưỡng cảnh báo vào PostgreSQL và phát realtime broadcast.
 * Mọi người dùng đều có quyền cập nhật (không yêu cầu đăng nhập/Admin).
 */
async function handleUpdateThresholds(request: Request, response: Response): Promise<Response> {
  const parsed = updateThresholdsSchema.safeParse(request.body);

  if (!parsed.success) {
    const errorMessage = parsed.error.issues[0]?.message || 'Dữ liệu ngưỡng không hợp lệ.';
    return response.status(400).json({
      success: false,
      message: errorMessage,
      errors: parsed.error.issues.map((issue) => issue.message)
    });
  }

  const { warningThreshold, nearFullThreshold, fullThreshold } = parsed.data;

  try {
    // 1. Lưu nguyên tử vào PostgreSQL
    const updated = await settingsService.updateThresholds({
      warningThreshold: warningThreshold!,
      nearFullThreshold: nearFullThreshold!,
      fullThreshold: fullThreshold!
    });

    // 2. Phát thông báo realtime tới toàn bộ trình duyệt đang kết nối
    const realtime = request.app.get('realtime') as RealtimeGateway | undefined;
    if (realtime && typeof realtime.emitThresholdsUpdated === 'function') {
      realtime.emitThresholdsUpdated(updated);
    }

    return response.status(200).json({
      success: true,
      message: 'Lưu cấu hình ngưỡng cảnh báo thành công.',
      thresholds: updated
    });
  } catch (error) {
    console.error('[SettingsRoutes] Error updating thresholds:', error);
    const message = error instanceof Error ? error.message : 'Lỗi hệ thống khi lưu cấu hình.';
    return response.status(400).json({
      success: false,
      message
    });
  }
}

router.get('/thresholds', handleGetThresholds);
router.put('/thresholds', verifyOriginAndCsrf, thresholdUpdateRateLimiter, handleUpdateThresholds);
router.patch('/thresholds', verifyOriginAndCsrf, thresholdUpdateRateLimiter, handleUpdateThresholds);

// Định tuyến cấp gốc /api/settings
router.get('/', handleGetThresholds);
router.put('/', verifyOriginAndCsrf, thresholdUpdateRateLimiter, handleUpdateThresholds);
router.patch('/', verifyOriginAndCsrf, thresholdUpdateRateLimiter, handleUpdateThresholds);

export default router;
