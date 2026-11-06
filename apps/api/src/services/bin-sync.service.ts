import { realDeviceService, type RealDeviceStatus } from '../demo/real-device.service.js';
import { settingsService } from './settings.service.js';

export type FillCategory = 'NORMAL' | 'MONITOR' | 'NEARLY_FULL' | 'CRITICAL';

export function computeFillCategory(fillLevel: number | null | undefined): FillCategory {
  if (fillLevel === null || fillLevel === undefined || Number.isNaN(fillLevel)) {
    return 'NORMAL';
  }
  const t = settingsService.getCachedThresholds();
  const warning = t.warningThreshold ?? 50;
  const nearFull = t.nearFullThreshold ?? 70;
  const full = t.fullThreshold ?? 90;

  if (fillLevel < warning) return 'NORMAL';
  if (fillLevel < nearFull) return 'MONITOR';
  if (fillLevel < full) return 'NEARLY_FULL';
  return 'CRITICAL';
}

/**
 * Hàm chuẩn hóa duy nhất kết nối thực tế giữa Raspberry Pi 5 / ESP32 với mọi thực thể Bin.
 * Được sử dụng thống nhất bởi:
 * - GET /api/bins
 * - GET /api/bins/:id
 * - GET /api/dashboard/summary
 * - demoService.getAllBins()
 */
export function syncBinWithRealDevice<T extends {
  binCode: string;
  currentFillLevel?: number | null;
  status?: any;
  lastSeen?: any;
  distanceCm?: number | null;
  fillCategory?: any;
}>(
  bin: T,
  realStatus: RealDeviceStatus = realDeviceService.getStatus()
): T & {
  currentFillLevel: number | null;
  distanceCm: number | null;
  status: 'ONLINE' | 'OFFLINE';
  fillCategory: FillCategory;
  lastSeen: string | null;
} {
  const isPiOnline = realStatus.status === 'ONLINE' || realStatus.status === 'WARNING';
  const sensors = isPiOnline ? realStatus.sensors : null;

  // Ánh xạ chuẩn: HC1 -> RECYCLABLE, HC2 -> NON_RECYCLABLE, HC3 -> ORGANIC
  let comp: any = null;
  if (bin.binCode === 'ORGANIC') comp = sensors?.organic;
  else if (bin.binCode === 'RECYCLABLE') comp = sensors?.recyclable;
  else if (bin.binCode === 'NON_RECYCLABLE') comp = sensors?.nonRecyclable;

  const hasValidReading = comp &&
    typeof comp.fillLevel === 'number' &&
    !Number.isNaN(comp.fillLevel) &&
    comp.status !== 'STALE' &&
    isPiOnline;

  if (hasValidReading) {
    return {
      ...bin,
      currentFillLevel: comp.fillLevel,
      distanceCm: typeof comp.distanceCm === 'number' && !Number.isNaN(comp.distanceCm) ? comp.distanceCm : null,
      fillCategory: computeFillCategory(comp.fillLevel),
      status: 'ONLINE' as const,
      lastSeen: comp.updatedAt || realStatus.lastHeartbeat || (typeof realStatus.sentAt === 'string' ? realStatus.sentAt : new Date().toISOString())
    };
  }

  return {
    ...bin,
    currentFillLevel: null,
    distanceCm: null,
    fillCategory: 'NORMAL' as const,
    status: 'OFFLINE' as const,
    lastSeen: comp?.updatedAt || realStatus.lastHeartbeat || null
  };
}

export function syncBinsWithRealDevice<T extends {
  binCode: string;
  currentFillLevel?: number | null;
  status?: any;
  lastSeen?: any;
  distanceCm?: number | null;
  fillCategory?: any;
}>(
  bins: T[],
  realStatus: RealDeviceStatus = realDeviceService.getStatus()
) {
  return bins.map((bin) => syncBinWithRealDevice(bin, realStatus));
}

