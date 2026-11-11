import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getFillCategory } from './bin.routes.js';

import { env } from '../config/env.js';
import { demoService } from '../demo/demo.service.js';
import { RealDeviceService, realDeviceService } from '../demo/real-device.service.js';
import { ensureStationBBinsIfMissing, syncBinsWithRealDevice } from '../services/bin-sync.service.js';

function isLidAlert(msg: string): boolean {
  return (
    msg === RealDeviceService.LID_ALERT_MESSAGE ||
    msg === RealDeviceService.LID_ALERT_BANNER_MESSAGE ||
    msg.includes('LỖI NẮP') ||
    msg.includes('lỗi nắp')
  );
}

function mergeAndDeduplicateLidAlert<T extends { id: string; message: string; isResolved: boolean; binId?: string | null; bin?: any; deviceId?: string | null; stationCode?: string; stationName?: string }>(
  dbAlerts: T[]
): T[] {
  const result: T[] = [];
  let seenUnresolvedLidAlert = false;

  for (const item of dbAlerts) {
    if (isLidAlert(item.message) && !item.isResolved) {
      if (seenUnresolvedLidAlert) {
        console.log(`[DashboardRoutes] [LID ALERT] mergeAndDeduplicate: omitting duplicate DB alert id=${item.id}`);
        continue;
      }
      seenUnresolvedLidAlert = true;
      result.push({
        ...item,
        binId: null,
        bin: null,
        deviceId: null,
        stationCode: 'STATION_A',
        stationName: 'Trạm A',
        message: RealDeviceService.LID_ALERT_MESSAGE
      });
    } else {
      result.push(item);
    }
  }

  const activeLidRecord = realDeviceService.getActiveLidAlertRecord();
  if (activeLidRecord && !seenUnresolvedLidAlert) {
    console.log('[DashboardRoutes] [LID ALERT] mergeAndDeduplicate: unshifting active in-memory lid alert record to alerts list');
    result.unshift(activeLidRecord as unknown as T);
  }

  return result;
}

const router = Router();
const dateQuery = z.string().datetime({ offset: true }).optional();
const historyQuery = z.object({
  stationId: z.string().optional(),
  stationCode: z.string().optional(),
  binId: z.string().optional(),
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
    const isStationBUnmigratedFilter = !targetStationId && rawStationCode?.toUpperCase() === 'STATION_B';

    const bins = isStationBUnmigratedFilter
      ? []
      : await prisma.bin.findMany({
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

    const latest = ensureStationBBinsIfMissing(
      syncBinsWithRealDevice(bins, realStatus, targetStationId),
      realStatus,
      { stationCode: rawStationCode, stationId: targetStationId }
    );

    const installedBins = latest.filter((bin) => bin.installed !== false);
    const uninstalledCount = latest.filter((bin) => bin.installed === false).length;

    const recentSensorReadings: any[] = [];
    const devices = await prisma.deviceStatus.findMany({ orderBy: { createdAt: 'asc' } });
    const rawAlerts = await prisma.alert.findMany({
      include: { bin: { select: { binCode: true, stationId: true } } },
      where: {
        isResolved: false,
        ...(targetStationId
          ? isStationAFilter
            ? {
                OR: [
                  { bin: { stationId: targetStationId } },
                  { bin: { stationId: null } },
                  { binId: null }
                ]
              }
            : {
                OR: [
                  { bin: { stationId: targetStationId } },
                  { binId: null }
                ]
              }
          : {})
      },
      orderBy: { createdAt: 'desc' },
      take: 8
    });
    const alerts = mergeAndDeduplicateLidAlert(rawAlerts).slice(0, 8);

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

    const rawStationCode = query.stationCode?.trim().toUpperCase();
    let targetStationId = query.stationId;
    if (!targetStationId && rawStationCode) {
      const station = await prisma.station.findUnique({ where: { code: rawStationCode } });
      if (station) targetStationId = station.id;
    }

    const isStationAFilter = targetStationId === 'station_a_canonical_id' || rawStationCode === 'STATION_A';
    const isStationBUnmigratedFilter = !targetStationId && rawStationCode === 'STATION_B';
    if (isStationBUnmigratedFilter) {
      return response.json({ readings: [] });
    }

    const binFilter: Record<string, any> = {};
    if (query.binCode) {
      binFilter.binCode = query.binCode;
    }
    if (targetStationId) {
      if (isStationAFilter) {
        binFilter.OR = [{ stationId: targetStationId }, { stationId: null }];
      } else {
        binFilter.stationId = targetStationId;
      }
    }

    const readings = await prisma.sensorReading.findMany({
      include: {
        bin: {
          select: {
            binCode: true,
            name: true,
            stationId: true,
            station: { select: { id: true, code: true, name: true } }
          }
        }
      },
      where: {
        ...(query.binId ? { binId: query.binId } : {}),
        ...(Object.keys(binFilter).length > 0 ? { bin: binFilter } : {}),
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

    const rawAlerts = await prisma.alert.findMany({
      include: { bin: { select: { binCode: true, name: true, stationId: true } } },
      where: {
        ...(targetStationId
          ? {
              OR: [
                { bin: { stationId: targetStationId } },
                { binId: null }
              ]
            }
          : {})
      },
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    const alerts = mergeAndDeduplicateLidAlert(rawAlerts);
    const hasLidAlert = alerts.some((a) => a.message === RealDeviceService.LID_ALERT_MESSAGE && !a.isResolved);
    console.log(`[DashboardRoutes] [LID ALERT] GET /api/dashboard/alerts: returned ${alerts.length} alerts (hasLidAlert=${hasLidAlert})`);
    return response.json({ alerts });
  } catch (error) {
    return next(error);
  }
});

export default router;
