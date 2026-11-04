import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { deviceHealthService } from '../services/device-health.service.js';
import { deviceHeartbeatSchema } from '../integrations/mqtt/contracts.js';
import { DEVICE_HEALTH_CONFIG } from '../config/device-health.config.js';
import { CANONICAL_DEVICE_ID, LEGACY_DEVICE_ID, normalizeDeviceId } from '../config/device-id.config.js';
import { prisma } from '../lib/prisma.js';
import { authenticateDeviceToken, requireAuth, requireRole } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { demoService } from '../demo/demo.service.js';
import { realDeviceService } from '../demo/real-device.service.js';

const router = Router();

export const deviceCommandSchema = z.object({
  deviceId: z.string().min(1).default(CANONICAL_DEVICE_ID),
  action: z.enum(['PING', 'TRIGGER_ULTRASONIC'], {
    message: 'Chỉ cho phép các lệnh an toàn: PING hoặc TRIGGER_ULTRASONIC trong giai đoạn này'
  }),
  params: z.record(z.string(), z.unknown()).optional().default({})
});

export const SUPPORTED_COMMAND_DEVICE_IDS = [CANONICAL_DEVICE_ID];

export async function handleDeviceCommand(req: Request, res: Response) {
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

  const { deviceId: rawDeviceId, action, params } = parseResult.data;
  const deviceId = normalizeDeviceId(rawDeviceId);

  if (!SUPPORTED_COMMAND_DEVICE_IDS.includes(deviceId)) {
    return res.status(400).json({
      success: false,
      error: 'UNSUPPORTED_DEVICE',
      message: `Thiết bị '${rawDeviceId}' không hỗ trợ nhận lệnh điều khiển. Hiện chỉ hỗ trợ: ${SUPPORTED_COMMAND_DEVICE_IDS.join(', ')}`
    });
  }

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

function notFound(response: Response, message = 'Device not found') {
  return response.status(404).json({
    error: {
      code: 'DEVICE_NOT_FOUND',
      message
    }
  });
}

function validationError(response: Response, message: string) {
  return response.status(400).json({
    error: {
      code: 'DEVICE_VALIDATION_ERROR',
      message
    }
  });
}

router.get('/', async (_request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.json({ devices: demoService.getAllDevices() });
    }
    const devices = await deviceHealthService.getAllDevices();
    return response.json({ devices });
  } catch (error) {
    return next(error);
  }
});

router.post(
  '/heartbeat',
  authenticateDeviceToken,
  (request, response, next) => {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_READ_ONLY',
          message: 'Hệ thống SmartBin đang hoạt động ở chế độ Demo mô phỏng. Thao tác ghi dữ liệu bị vô hiệu hóa.'
        }
      });
    }
    return next();
  },
  async (request, response, next) => {
    try {
      const parsed = deviceHeartbeatSchema.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const message = issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid heartbeat data';
        return validationError(response, message);
      }

      const normalizedDeviceId = normalizeDeviceId(parsed.data.deviceId);
      const existing = await prisma.deviceStatus.findFirst({
        where: {
          OR: [
            { deviceId: normalizedDeviceId },
            ...(normalizedDeviceId === CANONICAL_DEVICE_ID ? [{ deviceId: LEGACY_DEVICE_ID }] : [])
          ]
        }
      });
      if (!existing) {
        return notFound(response, `Device ${parsed.data.deviceId} not registered`);
      }

      const device = await deviceHealthService.recordHeartbeat({
        ...parsed.data,
        deviceId: normalizedDeviceId
      });
      return response.json({
        device: {
          ...device,
          deviceId: CANONICAL_DEVICE_ID
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.post('/command', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), handleDeviceCommand);

router.get('/:id', async (request, response, next) => {
  try {
    const id = request.params.id;
    if (!id || typeof id !== 'string') return notFound(response);
    const normalizedId = normalizeDeviceId(id);

    if (env.isDemoMode) {
      const device = demoService.getDeviceById(normalizedId);
      if (!device) return notFound(response);
      return response.json({
        device: {
          ...device,
          deviceId: normalizeDeviceId(device.deviceId)
        }
      });
    }

    const device = await deviceHealthService.getDeviceById(normalizedId);
    if (!device) return notFound(response);

    return response.json({
      device: {
        ...device,
        deviceId: normalizeDeviceId(device.deviceId)
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/health', async (request, response, next) => {
  try {
    const id = request.params.id;
    if (!id || typeof id !== 'string') return notFound(response);
    const normalizedId = normalizeDeviceId(id);

    if (env.isDemoMode) {
      const device = demoService.getDeviceById(normalizedId);
      if (!device) return notFound(response);

      let parsedMetadata: unknown = null;
      if (device.metadata) {
        try {
          parsedMetadata = JSON.parse(device.metadata);
        } catch {
          parsedMetadata = device.metadata;
        }
      }

      return response.json({
        deviceId: normalizeDeviceId(device.deviceId),
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        status: device.status,
        lastSeen: device.lastSeen,
        lastHeartbeat: device.lastHeartbeat,
        uptime: device.uptime,
        firmwareVersion: device.firmwareVersion,
        ipAddress: device.ipAddress,
        metadata: parsedMetadata,
        health: {
          onlineThresholdMs: DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS,
          warningThresholdMs: DEVICE_HEALTH_CONFIG.WARNING_THRESHOLD_MS,
          offlineThresholdMs: DEVICE_HEALTH_CONFIG.OFFLINE_THRESHOLD_MS
        }
      });
    }

    const device = await deviceHealthService.getDeviceById(normalizedId);
    if (!device) return notFound(response);

    let parsedMetadata: unknown = null;
    if (device.metadata) {
      try {
        parsedMetadata = JSON.parse(device.metadata);
      } catch {
        parsedMetadata = device.metadata;
      }
    }

    return response.json({
      deviceId: normalizeDeviceId(device.deviceId),
      deviceName: device.deviceName,
      deviceType: device.deviceType,
      status: device.status,
      lastSeen: device.lastSeen,
      lastHeartbeat: device.lastHeartbeat,
      uptime: device.uptime,
      firmwareVersion: device.firmwareVersion,
      ipAddress: device.ipAddress,
      metadata: parsedMetadata,
      health: {
        onlineThresholdMs: DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS,
        warningThresholdMs: DEVICE_HEALTH_CONFIG.WARNING_THRESHOLD_MS,
        offlineThresholdMs: DEVICE_HEALTH_CONFIG.OFFLINE_THRESHOLD_MS
      }
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
