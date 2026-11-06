import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getFillCategory } from './bin.routes.js';

import { env } from '../config/env.js';
import { demoService } from '../demo/demo.service.js';
import { realDeviceService } from '../demo/real-device.service.js';

const router = Router();
const dateQuery = z.string().datetime({ offset: true }).optional();
const historyQuery = z.object({ binCode: z.string().optional(), from: dateQuery, to: dateQuery, fillMin: z.coerce.number().min(0).max(100).optional(), fillMax: z.coerce.number().min(0).max(100).optional() });

router.get('/summary', async (_request, response, next) => {
  try {
    const realStatus = realDeviceService.getStatus();
    const isPiOnline = realStatus.status === 'ONLINE' || realStatus.status === 'WARNING';
    const sensors = isPiOnline ? realStatus.sensors : null;

    if (env.isDemoMode) {
      return response.json(demoService.getDashboardSummary());
    }

    const bins = await prisma.bin.findMany({ where: { isActive: true }, orderBy: { binCode: 'asc' } });
    const latest = bins.map((bin) => {
      let sensorData: any = null;
      if (bin.binCode === 'ORGANIC') sensorData = sensors?.organic;
      else if (bin.binCode === 'RECYCLABLE') sensorData = sensors?.recyclable;
      else if (bin.binCode === 'NON_RECYCLABLE') sensorData = sensors?.nonRecyclable;

      if (sensorData && typeof sensorData.fillLevel === 'number' && sensorData.status !== 'STALE' && isPiOnline) {
        return {
          ...bin,
          currentFillLevel: sensorData.fillLevel,
          distanceCm: typeof sensorData.distanceCm === 'number' ? sensorData.distanceCm : null,
          status: 'ONLINE',
          lastSeen: sensorData.updatedAt || realStatus.lastHeartbeat,
          fillCategory: getFillCategory(sensorData.fillLevel)
        };
      }

      // Khi không có dữ liệu cảm biến thực tế hoặc Pi mất kết nối -> Trả về null
      return {
        ...bin,
        currentFillLevel: null,
        distanceCm: null,
        status: 'OFFLINE',
        lastSeen: realStatus.lastHeartbeat || null,
        fillCategory: 'NORMAL'
      };
    });

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
