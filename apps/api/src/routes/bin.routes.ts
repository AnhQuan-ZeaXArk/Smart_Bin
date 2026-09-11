import { Router } from 'express';
import type { Response } from 'express';
import { BinStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
const idSchema = z.string().cuid();
const coordinateSchema = z.number().finite().optional().nullable();
const createBinSchema = z.object({
  binCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().min(1).max(200),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  capacity: z.coerce.number().int().positive(),
  currentFillLevel: z.coerce.number().int().min(0).max(100).default(0)
});
const updateBinSchema = z.object({
  name: z.string().trim().min(1).max(120),
  location: z.string().trim().min(1).max(200),
  latitude: coordinateSchema,
  longitude: coordinateSchema,
  capacity: z.coerce.number().int().positive()
});
const querySchema = z.object({
  search: z.string().trim().optional(),
  status: z.nativeEnum(BinStatus).optional(),
  fillCategory: z.enum(['NORMAL', 'MONITOR', 'NEARLY_FULL', 'CRITICAL']).optional()
});

type FillCategory = 'NORMAL' | 'MONITOR' | 'NEARLY_FULL' | 'CRITICAL';

function getFillCategory(fillLevel: number): FillCategory {
  if (fillLevel <= 50) return 'NORMAL';
  if (fillLevel <= 75) return 'MONITOR';
  if (fillLevel <= 90) return 'NEARLY_FULL';
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

router.get('/', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'WORKER'), async (request, response, next) => {
  try {
    const queryResult = querySchema.safeParse(request.query);
    if (!queryResult.success) return validationError(response, 'Invalid bin filters');
    const query = queryResult.data;
    const bins = await prisma.bin.findMany({ where: { isActive: true, ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ binCode: { contains: query.search } }, { name: { contains: query.search } }, { location: { contains: query.search } }] } : {}) }, orderBy: { binCode: 'asc' } });
    const filtered = query.fillCategory ? bins.filter((bin) => getFillCategory(bin.currentFillLevel) === query.fillCategory) : bins;
    return response.json({ bins: filtered.map(serializeBin) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', requireAuth, requireRole('ADMIN', 'SUPERVISOR', 'WORKER'), async (request, response, next) => {
  try {
    const id = parseId(request.params.id);
    if (!id) return notFound(response);
    const bin = await prisma.bin.findFirst({ where: { id, isActive: true } });
    return bin ? response.json({ bin: serializeBin(bin) }) : notFound(response);
  } catch (error) {
    return next(error);
  }
});

router.post('/', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), async (request, response, next) => {
  try {
    const inputResult = createBinSchema.safeParse(request.body);
    if (!inputResult.success) return validationError(response, 'Invalid bin data');
    const input = inputResult.data;
    const bin = await prisma.bin.create({ data: { ...input, status: BinStatus.OFFLINE } });
    return response.status(201).json({ bin: serializeBin(bin) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return response.status(409).json({ error: { code: 'BIN_CODE_EXISTS', message: 'binCode must be unique' } });
    return next(error);
  }
});

router.put('/:id', requireAuth, requireRole('ADMIN', 'SUPERVISOR'), async (request, response, next) => {
  try {
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

export { getFillCategory };
export default router;