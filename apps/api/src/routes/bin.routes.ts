import { Router } from 'express';
import type { Response } from 'express';
import { BinStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

import { env } from '../config/env.js';
import { demoService } from '../demo/demo.service.js';
import { settingsService, type SystemThresholds } from '../services/settings.service.js';
import { syncBinWithRealDevice, syncBinsWithRealDevice } from '../services/bin-sync.service.js';

const router = Router();
const idSchema = z.string().min(1);
const coordinateSchema = z.number().finite().optional().nullable();
const createBinSchema = z.object({
  stationId: z.string().trim().optional(),
  stationCode: z.string().trim().optional(),
  binCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().min(1).max(200),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  capacity: z.coerce.number().int().positive(),
  currentFillLevel: z.coerce.number().int().min(0).max(100).default(0),
  installed: z.boolean().optional().default(true)
});
const updateBinSchema = z.object({
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().min(1).max(200),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  capacity: z.coerce.number().int().positive(),
  installed: z.boolean().optional()
});
const querySchema = z.object({
  stationId: z.string().trim().optional(),
  stationCode: z.string().trim().optional(),
  search: z.string().trim().optional(),
  status: z.nativeEnum(BinStatus).optional(),
  fillCategory: z.enum(['NORMAL', 'MONITOR', 'NEARLY_FULL', 'CRITICAL']).optional()
});

type FillCategory = 'NORMAL' | 'MONITOR' | 'NEARLY_FULL' | 'CRITICAL';

export function getFillCategory(fillLevel: number | null | undefined, thresholds?: Partial<SystemThresholds>): FillCategory {
  if (fillLevel === null || fillLevel === undefined || Number.isNaN(fillLevel)) {
    return 'NORMAL';
  }
  const t = thresholds ?? settingsService.getCachedThresholds();
  const warning = t.warningThreshold ?? 50;
  const nearFull = t.nearFullThreshold ?? 70;
  const full = t.fullThreshold ?? 90;

  if (fillLevel < warning) return 'NORMAL';
  if (fillLevel < nearFull) return 'MONITOR';
  if (fillLevel < full) return 'NEARLY_FULL';
  return 'CRITICAL';
}

function serializeBin(bin: Prisma.BinGetPayload<object>) {
  return { ...bin, fillCategory: getFillCategory(bin.currentFillLevel) };
}

function notFound(response: Response) {
  return response.status(404).json({ error: { code: 'BIN_NOT_FOUND', message: 'Bin not found' } });
}

function validationError(response: Response, message: string) {
  return response.status(400).json({ error: { code: 'BIN_VALIDATION_ERROR', message } });
}

function parseId(value: unknown) {
  const result = idSchema.safeParse(value);
  return result.success ? result.data : null;
}

router.get('/', async (request, response, next) => {
  try {
    const queryResult = querySchema.safeParse(request.query);
    if (!queryResult.success) return validationError(response, 'Invalid bin filters');

    if (env.isDemoMode) {
      const bins = demoService.getAllBins(queryResult.data);
      return response.json({ bins });
    }

    const query = queryResult.data;
    let targetStationId = query.stationId;
    if (!targetStationId && query.stationCode) {
      const station = await prisma.station.findUnique({ where: { code: query.stationCode } });
      if (station) targetStationId = station.id;
    }

    const bins = await prisma.bin.findMany({
      where: {
        isActive: true,
        ...(targetStationId ? { stationId: targetStationId } : {}),
        ...(query.search ? { OR: [{ binCode: { contains: query.search } }, { name: { contains: query.search } }, { location: { contains: query.search } }] } : {})
      },
      include: { station: true },
      orderBy: [{ stationId: 'asc' }, { binCode: 'asc' }]
    });

    // Đồng bộ hóa trạng thái cảm biến phần cứng thực tế với Database Bins
    const synchronized = syncBinsWithRealDevice(bins, undefined, targetStationId);
    let filtered = synchronized;
    if (query.status) {
      filtered = filtered.filter((b) => b.status === query.status);
    }
    if (query.fillCategory) {
      filtered = filtered.filter((b) => b.fillCategory === query.fillCategory);
    }
    return response.json({ bins: filtered });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (request, response, next) => {
  try {
    const id = parseId(request.params.id);
    if (!id) return notFound(response);

    if (env.isDemoMode) {
      const bin = demoService.getBinById(id);
      return bin ? response.json({ bin }) : notFound(response);
    }

    const stationId = typeof request.query.stationId === 'string' ? request.query.stationId : undefined;
    const bin = await prisma.bin.findFirst({
      where: {
        isActive: true,
        ...(stationId ? { stationId } : {}),
        OR: [{ id }, { binCode: id }]
      },
      include: { station: true }
    });
    if (!bin) return notFound(response);

    const synchronized = syncBinWithRealDevice(bin);
    return response.json({ bin: synchronized });
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_READ_ONLY',
          message: 'Hệ thống SmartBin đang hoạt động ở chế độ Demo mô phỏng. Thao tác ghi dữ liệu bị vô hiệu hóa.'
        }
      });
    }

    const inputResult = createBinSchema.safeParse(request.body);
    if (!inputResult.success) return validationError(response, 'Invalid bin data');
    const input = inputResult.data;

    let resolvedStationId = input.stationId;
    if (!resolvedStationId && input.stationCode) {
      const station = await prisma.station.findUnique({ where: { code: input.stationCode } });
      if (station) resolvedStationId = station.id;
    }
    if (!resolvedStationId) {
      const stationA = await prisma.station.findFirst({ where: { code: 'STATION_A' } });
      resolvedStationId = stationA?.id;
    }

    const { stationCode: _sc, ...binData } = input;
    const bin = await prisma.bin.create({
      data: {
        ...binData,
        stationId: resolvedStationId,
        status: input.installed === false ? BinStatus.MAINTENANCE : BinStatus.OFFLINE
      },
      include: { station: true }
    });
    return response.status(201).json({ bin: serializeBin(bin) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return response.status(409).json({ error: { code: 'BIN_CODE_EXISTS', message: 'binCode must be unique per station' } });
    return next(error);
  }
});

router.put('/:id', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_READ_ONLY',
          message: 'Hệ thống SmartBin đang hoạt động ở chế độ Demo mô phỏng. Thao tác ghi dữ liệu bị vô hiệu hóa.'
        }
      });
    }

    const id = parseId(request.params.id);
    if (!id) return notFound(response);
    const inputResult = updateBinSchema.safeParse(request.body);
    if (!inputResult.success) return validationError(response, 'Invalid bin data');
    const input = inputResult.data;
    const existing = await prisma.bin.findFirst({ where: { id, isActive: true } });
    if (!existing) return notFound(response);
    const bin = await prisma.bin.update({ where: { id }, data: input });
    return response.json({ bin: serializeBin(bin) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', requireAuth, requireRole('ADMIN'), async (request, response, next) => {
  try {
    if (env.isDemoMode) {
      return response.status(403).json({
        error: {
          code: 'DEMO_MODE_READ_ONLY',
          message: 'Hệ thống SmartBin đang hoạt động ở chế độ Demo mô phỏng. Thao tác ghi dữ liệu bị vô hiệu hóa.'
        }
      });
    }

    const id = parseId(request.params.id);
    if (!id) return notFound(response);
    const existing = await prisma.bin.findFirst({ where: { id, isActive: true } });
    if (!existing) return notFound(response);
    const bin = await prisma.bin.update({ where: { id }, data: { isActive: false } });
    return response.json({ bin: serializeBin(bin), message: 'Bin deactivated' });
  } catch (error) {
    return next(error);
  }
});

export default router;