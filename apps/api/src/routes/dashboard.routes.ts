import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getFillCategory } from './bin.routes.js';

import { env } from '../config/env.js';
import { demoService } from '../demo/demo.service.js';
import { realDeviceService } from '../demo/real-device.service.js';
import { syncBinsWithRealDevice } from '../services/bin-sync.service.js';

const router = Router();
const dateQuery = z.string().datetime({ offset: true }).optional();
const historyQuery = z.object({ binCode: z.string().optional(), from: dateQuery, to: dateQuery, fillMin: z.coerce.number().min(0).max(100).optional(), fillMax: z.coerce.number().min(0).max(100).optional() });

router.get('/summary', async (_request, response, next) => {
  try {
    const realStatus = realDeviceService.getStatus();

    if (env.isDemoMode) {
      return response.json(demoService.getDashboardSummary());
    }

    const bins = await prisma.bin.findMany({ where: { isActive: true }, orderBy: { binCode: 'asc' } });
    const latest = syncBinsWithRealDevice(bins, realStatus);

    const recentSensorReadings: any[] = [];
    const devices = await prisma.deviceStatus.findMany({ orderBy: { createdAt: 'asc' } });
    const alerts = await prisma.alert.findMany({ include: { bin: { select: { binCode: true } } }, where: { isResolved: false }, orderBy: { createdAt: 'desc' }, take: 8 });
    return response.json({
      summary: {
        total: latest.length,
        normal: latest.filter((bin) => bin.currentFillLevel !== null && bin.fillCategory === 'NORMAL').length,
        warning: latest.filter((bin) => bin.currentFillLevel !== null && ['MONITOR', 'NEARLY_FULL'].includes(bin.fillCategory)).length,
        full: latest.filter((bin) => bin.currentFillLevel !== null && bin.fillCategory === 'CRITICAL').length,
        offline: latest.filter((bin) => bin.status === 'OFFLINE' || bin.currentFillLevel === null).length
      },
      bins: latest,
      recentSensorReadings,
      devices,
      alerts
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/sensor-readings', async (request, response, next) => {
  try {
    const query = historyQuery.parse(request.query);

    if (env.isDemoMode) {
      return response.json({ readings: demoService.getSensorReadings(query) });
    }

    // Khi Pi mất kết nối (OFFLINE), không trả về dữ liệu mẫu/seed cũ
    const realStatus = realDeviceService.getStatus();
    const isPiOnline = realStatus.status === 'ONLINE' || realStatus.status === 'WARNING';
    if (!isPiOnline) {
      return response.json({ readings: [] });
    }

    const readings = await prisma.sensorReading.findMany({
      include: { bin: { select: { binCode: true, name: true } } },
      where: {
        ...(query.binCode ? { bin: { binCode: query.binCode } } : {}),
        ...(query.from || query.to ? { timestamp: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
        ...(query.fillMin !== undefined || query.fillMax !== undefined ? { fillLevel: { ...(query.fillMin !== undefined ? { gte: query.fillMin } : {}), ...(query.fillMax !== undefined ? { lte: query.fillMax } : {}) } } : {})
      },
      orderBy: { timestamp: 'desc' },
      take: 200
    });
    return response.json({ readings });
  } catch (error) {
    return next(error);
  }
});

router.get('/alerts', async (_request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.json({ alerts: demoService.getAllAlerts() });
    }

    const alerts = await prisma.alert.findMany({ include: { bin: { select: { binCode: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return response.json({ alerts });
  } catch (error) {
    return next(error);
  }
});

export default router;
