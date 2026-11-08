import { DeviceType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { UltrasonicTelemetry } from '../integrations/mqtt/contracts.js';
import { updateFillAlert } from './alert.service.js';
import type { DeviceHealthService } from './device-health.service.js';

export type TelemetryIngestResult = { accepted: boolean; reason: 'ACCEPTED' | 'UNKNOWN_BIN' | 'OUT_OF_ORDER' | 'NOT_INSTALLED'; binCode: string; alert?: Awaited<ReturnType<typeof updateFillAlert>> };

export async function ingestUltrasonicTelemetry(
  message: UltrasonicTelemetry & { stationId?: string; stationCode?: string },
  deviceHealthService?: DeviceHealthService
): Promise<TelemetryIngestResult> {
  let bin = null;
  if (message.stationId) {
    bin = await prisma.bin.findFirst({ where: { stationId: message.stationId, binCode: message.binCode } });
  } else if (message.stationCode) {
    const station = await prisma.station.findUnique({ where: { code: message.stationCode } });
    if (station) {
      bin = await prisma.bin.findFirst({ where: { stationId: station.id, binCode: message.binCode } });
    }
  }

  if (!bin) {
    // Default fallback to Station A canonical bin
    bin = await prisma.bin.findFirst({ where: { binCode: message.binCode, isActive: true } });
  }

  if (!bin || !bin.isActive) return { accepted: false, reason: 'UNKNOWN_BIN', binCode: message.binCode };
  if (!bin.installed) return { accepted: false, reason: 'NOT_INSTALLED', binCode: message.binCode };

  const timestamp = new Date(message.timestamp);
  const latest = await prisma.sensorReading.findFirst({ where: { binId: bin.id }, orderBy: { timestamp: 'desc' } });
  if (latest && timestamp < latest.timestamp) return { accepted: false, reason: 'OUT_OF_ORDER', binCode: message.binCode };

  await prisma.$transaction([
    prisma.sensorReading.create({ data: { binId: bin.id, distance: message.distanceCm, fillLevel: message.fillLevel, timestamp } }),
    prisma.bin.update({ where: { id: bin.id }, data: { currentFillLevel: message.fillLevel, lastSeen: timestamp, status: 'ONLINE' } })
  ]);
  const alert = await updateFillAlert(bin.id, bin.binCode, message.fillLevel);

  if (deviceHealthService) {
    await deviceHealthService.recordDeviceActivity(
      message.deviceId ?? 'ultrasonic-01',
      DeviceType.ULTRASONIC_SENSOR,
      'Cảm biến siêu âm',
      { distanceCm: message.distanceCm, fillLevel: message.fillLevel }
    );
  } else {
    const now = new Date();
    await prisma.deviceStatus.upsert({
      where: { deviceId: message.deviceId ?? 'ultrasonic-01' },
      create: {
        deviceId: message.deviceId ?? 'ultrasonic-01',
        deviceName: 'Cảm biến siêu âm',
        deviceType: DeviceType.ULTRASONIC_SENSOR,
        status: 'ONLINE',
        lastSeen: now,
        metadata: JSON.stringify({ distanceCm: message.distanceCm, fillLevel: message.fillLevel })
      },
      update: {
        status: 'ONLINE',
        lastSeen: now,
        metadata: JSON.stringify({ distanceCm: message.distanceCm, fillLevel: message.fillLevel })
      }
    });
  }

  return { accepted: true, reason: 'ACCEPTED', binCode: message.binCode, alert };
}
