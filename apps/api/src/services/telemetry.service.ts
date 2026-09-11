import { prisma } from '../lib/prisma.js';
import type { UltrasonicTelemetry } from '../integrations/mqtt/contracts.js';
import { updateFillAlert } from './alert.service.js';

export type TelemetryIngestResult = { accepted: boolean; reason: 'ACCEPTED' | 'UNKNOWN_BIN' | 'OUT_OF_ORDER'; binCode: string; alert?: Awaited<ReturnType<typeof updateFillAlert>> };

export async function ingestUltrasonicTelemetry(message: UltrasonicTelemetry): Promise<TelemetryIngestResult> {
  const bin = await prisma.bin.findUnique({ where: { binCode: message.binCode } });
  if (!bin || !bin.isActive) return { accepted: false, reason: 'UNKNOWN_BIN', binCode: message.binCode };

  const timestamp = new Date(message.timestamp);
  const latest = await prisma.sensorReading.findFirst({ where: { binId: bin.id }, orderBy: { timestamp: 'desc' } });
  if (latest && timestamp < latest.timestamp) return { accepted: false, reason: 'OUT_OF_ORDER', binCode: message.binCode };

  await prisma.$transaction([
    prisma.sensorReading.create({ data: { binId: bin.id, distance: message.distanceCm, fillLevel: message.fillLevel, timestamp } }),
    prisma.bin.update({ where: { id: bin.id }, data: { currentFillLevel: message.fillLevel, lastSeen: timestamp, status: 'ONLINE' } })
  ]);
  const alert = await updateFillAlert(bin.id, bin.binCode, message.fillLevel);
  return { accepted: true, reason: 'ACCEPTED', binCode: message.binCode, alert };
}
