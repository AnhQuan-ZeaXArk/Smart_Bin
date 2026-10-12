import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getFillCategory } from './bin.routes.js';

import { env } from '../config/env.js';
import { demoService } from '../demo/demo.service.js';

const router = Router();
const dateQuery = z.string().datetime({ offset: true }).optional();
const historyQuery = z.object({ binCode: z.string().optional(), from: dateQuery, to: dateQuery, fillMin: z.coerce.number().min(0).max(100).optional(), fillMax: z.coerce.number().min(0).max(100).optional() });

router.get('/summary', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'WORKER'), async (_request: AuthenticatedRequest, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.json(demoService.getDashboardSummary());
    }

    const bins = await prisma.bin.findMany({ where: { isActive: true }, orderBy: { binCode: 'asc' } });
    const latest = await Promise.all(bins.map(async (bin) => {
      const reading = await prisma.sensorReading.findFirst({ where: { binId: bin.id }, orderBy: { timestamp: 'desc' } });
      return { ...bin, distanceCm: reading?.distance ?? null, fillCategory: getFillCategory(bin.currentFillLevel) };
    }));
    const recentSensorReadings = await prisma.sensorReading.findMany({ include: { bin: { select: { binCode: true, name: true } } }, orderBy: { timestamp: 'desc' }, take: 8 });
    const devices = await prisma.deviceStatus.findMany({ orderBy: { createdAt: 'asc' } });
    const alerts = await prisma.alert.findMany({ include: { bin: { select: { binCode: true } } }, where: { isResolved: false }, orderBy: { createdAt: 'desc' }, take: 8 });
    return response.json({
      summary: {
        total: latest.length,
        normal: latest.filter((bin) => bin.fillCategory === 'NORMAL').length,
        warning: latest.filter((bin) => ['MONITOR', 'NEARLY_FULL'].includes(bin.fillCategory)).length,
        full: latest.filter((bin) => bin.fillCategory === 'CRITICAL').length,
        offline: latest.filter((bin) => bin.status === 'OFFLINE').length
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

router.get('/sensor-readings', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'WORKER'), async (request, response, next) => {
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

router.get('/alerts', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'WORKER'), async (_request, response, next) => {
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
