import { Router } from 'express';
import type { Response } from 'express';
import { deviceHealthService } from '../services/device-health.service.js';
import { deviceHeartbeatSchema } from '../integrations/mqtt/contracts.js';
import { DEVICE_HEALTH_CONFIG } from '../config/device-health.config.js';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

import { env } from '../config/env.js';
import { demoService } from '../demo/demo.service.js';

const router = Router();

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

router.get('/', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'WORKER'), async (_request, response, next) => {
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

router.post('/heartbeat', async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_READ_ONLY',
          message: 'Hệ thống SmartBin đang hoạt động ở chế độ Demo mô phỏng. Thao tác ghi dữ liệu bị vô hiệu hóa.'
        }
      });
    }

    const parsed = deviceHeartbeatSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid heartbeat data';
      return validationError(response, message);
    }

    const existing = await prisma.deviceStatus.findUnique({
      where: { deviceId: parsed.data.deviceId }
    });
    if (!existing) {
      return notFound(response, `Device ${parsed.data.deviceId} not registered`);
    }

    const device = await deviceHealthService.recordHeartbeat(parsed.data);
    return response.json({ device });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'WORKER'), async (request, response, next) => {
  try {
    const id = request.params.id;
    if (!id || typeof id !== 'string') return notFound(response);

    if (env.isDemoMode) {
      const device = demoService.getDeviceById(id);
      if (!device) return notFound(response);
      return response.json({ device });
    }

    const device = await deviceHealthService.getDeviceById(id);
    if (!device) return notFound(response);

    return response.json({ device });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/health', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'WORKER'), async (request, response, next) => {
  try {
    const id = request.params.id;
    if (!id || typeof id !== 'string') return notFound(response);

    if (env.isDemoMode) {
      const device = demoService.getDeviceById(id);
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
        deviceId: device.deviceId,
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

    const device = await deviceHealthService.getDeviceById(id);
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
      deviceId: device.deviceId,
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
