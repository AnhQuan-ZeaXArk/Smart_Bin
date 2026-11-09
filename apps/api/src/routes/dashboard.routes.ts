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
const historyQuery = z.object({
  stationId: z.string().optional(),
  stationCode: z.string().optional(),
  binCode: z.string().optional(),
  from: dateQuery,
  to: dateQuery,
  fillMin: z.coerce.number().min(0).max(100).optional(),
  fillMax: z.coerce.number().min(0).max(100).optional()
});

router.get('/summary', async (request, response, next) => {
  try {
    const rawStationId = typeof request.query.stationId === 'string' ? request.query.stationId : undefined;
    const rawStationCode = typeof request.query.stationCode === 'string' ? request.query.stationCode : undefined;

    let targetStationId = rawStationId;
    if (!targetStationId && rawStationCode) {
      const station = await prisma.station.findUnique({ where: { code: rawStationCode } });
      if (station) targetStationId = station.id;
    }

    const realStatus = realDeviceService.getStatus();

    if (env.isDemoMode) {
      return response.json(demoService.getDashboardSummary());
    }

    const isStationAFilter = targetStationId === 'station_a_canonical_id' || rawStationCode?.toUpperCase() === 'STATION_A';

    const bins = await prisma.bin.findMany({
      where: {
        isActive: true,
        ...(targetStationId
          ? isStationAFilter
            ? {
                OR: [
                  { stationId: targetStationId },
                  { stationId: null }
                ]
              }
            : { stationId: targetStationId }
          : {})
      },
      include: { station: true },
      orderBy: [{ stationId: 'asc' }, { binCode: 'asc' }]
    });

    const latest = syncBinsWithRealDevice(bins, realStatus, targetStationId);

    const installedBins = latest.filter((bin) => bin.installed !== false);
    const uninstalledCount = latest.filter((bin) => bin.installed === false).length;

    const recentSensorReadings: any[] = [];
    const devices = await prisma.deviceStatus.findMany({ orderBy: { createdAt: 'asc' } });
    const alerts = await prisma.alert.findMany({
      include: { bin: { select: { binCode: true, stationId: true } } },
      where: {
        isResolved: false,
        ...(targetStationId
          ? isStationAFilter
            ? {
                OR: [
                  { bin: { stationId: targetStationId } },
                  { bin: { stationId: null } }
                ]
              }
            : { bin: { stationId: targetStationId } }
          : {})
      },
      orderBy: { createdAt: 'desc' },
      take: 8
    });

    return response.json({
      summary: {
        total: installedBins.length,
        uninstalled: uninstalledCount,
        normal: installedBins.filter((bin) => bin.currentFillLevel !== null && bin.fillCategory === 'NORMAL').length,
        warning: installedBins.filter((bin) => bin.currentFillLevel !== null && ['MONITOR', 'NEARLY_FULL'].includes(bin.fillCategory)).length,
        full: installedBins.filter((bin) => bin.currentFillLevel !== null && bin.fillCategory === 'CRITICAL').length,
        offline: installedBins.filter((bin) => bin.status === 'OFFLINE' || bin.currentFillLevel === null).length
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

    let targetStationId = query.stationId;
    if (!targetStationId && query.stationCode) {
      const station = await prisma.station.findUnique({ where: { code: query.stationCode } });
      if (station) targetStationId = station.id;
    }

    const readings = await prisma.sensorReading.findMany({
      include: { bin: { select: { binCode: true, name: true, stationId: true } } },
      where: {
        ...(targetStationId ? { bin: { stationId: targetStationId } } : {}),
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

router.get('/alerts', async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.json({ alerts: demoService.getAllAlerts() });
    }

    const rawStationId = typeof request.query.stationId === 'string' ? request.query.stationId : undefined;
    const rawStationCode = typeof request.query.stationCode === 'string' ? request.query.stationCode : undefined;

    let targetStationId = rawStationId;
    if (!targetStationId && rawStationCode) {
      const station = await prisma.station.findUnique({ where: { code: rawStationCode } });
      if (station) targetStationId = station.id;
    }

    const alerts = await prisma.alert.findMany({
      include: { bin: { select: { binCode: true, name: true, stationId: true } } },
      where: {
        ...(targetStationId ? { bin: { stationId: targetStationId } } : {})
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    return response.json({ alerts });
  } catch (error) {
    return next(error);
  }
});

export default router;
