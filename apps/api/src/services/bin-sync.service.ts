import { realDeviceService, type RealDeviceStatus } from '../demo/real-device.service.js';
import { settingsService } from './settings.service.js';
import { DEVICE_HEALTH_CONFIG } from '../config/device-health.config.js';

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
 * Hàm chuẩn hóa kết nối thực tế giữa Raspberry Pi 5 / ESP32 với mọi thực thể Bin.
 * ĐẢM BẢO CÁCH LY TRẠM:
 * - Cảm biến thực tế của Raspberry Pi 5 (Serial A / YOLO IPC) CHỈ đồng bộ cho Trạm A.
 * - Tuyệt đối không ghi đè dữ liệu lên các thùng rác của Trạm B.
 * - Thùng rác chưa lắp đặt (installed: false) được giữ nguyên trạng thái MAINTENANCE và không có mức đầy.
 */
export function syncBinWithRealDevice<T extends {
  binCode: string;
  stationId?: string | null;
  installed?: boolean;
  station?: { id?: string; code?: string } | null;
  currentFillLevel?: number | null;
  status?: any;
  lastSeen?: any;
  distanceCm?: number | null;
  fillCategory?: any;
}>(
  bin: T,
  realStatus: RealDeviceStatus = realDeviceService.getStatus(),
  targetStationId?: string
): T & {
  currentFillLevel: number | null;
  distanceCm: number | null;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  fillCategory: FillCategory;
  lastSeen: string | null;
} {
  // 1. Nếu thùng rác chưa lắp đặt phần cứng (NOT_INSTALLED)
  if (bin.installed === false) {
    return {
      ...bin,
      currentFillLevel: null,
      distanceCm: null,
      fillCategory: 'NORMAL' as const,
      status: 'MAINTENANCE' as const,
      lastSeen: bin.lastSeen ? new Date(bin.lastSeen).toISOString() : null
    };
  }

  // 2. Kiểm tra quyền sở hữu Trạm A: Chỉ đồng bộ cảm biến Serial A cho Trạm A
  const isStationB = bin.station?.code === 'STATION_B' || bin.stationId === 'station_b_canonical_id';
  if (isStationB) {
    const lastSeenMs = bin.lastSeen ? new Date(bin.lastSeen).getTime() : 0;
    const isFresh = lastSeenMs > 0 && (Date.now() - lastSeenMs <= DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS);
    const rawFill = isFresh && typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel)
      ? bin.currentFillLevel
      : null;
    const computedStatus = (isFresh && bin.status === 'ONLINE') ? 'ONLINE' : 'OFFLINE';
    return {
      ...bin,
      currentFillLevel: rawFill,
      distanceCm: isFresh ? (bin.distanceCm ?? null) : null,
      fillCategory: computeFillCategory(rawFill),
      status: computedStatus,
      lastSeen: bin.lastSeen ? new Date(bin.lastSeen).toISOString() : null
    };
  }

  // 3. Xử lý đồng bộ Trạm A từ phần cứng thực tế (Serial A / YOLO IPC)
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
    const packetSentMs = realStatus.sentAt ? new Date(realStatus.sentAt).getTime() : 0;
    const sensorMeasurementMs = comp.updatedAt ? new Date(comp.updatedAt).getTime() : 0;
    const delayOnPiMs = (packetSentMs > 0 && sensorMeasurementMs > 0)
      ? Math.max(0, packetSentMs - sensorMeasurementMs)
      : 0;
    const serverReceiveMs = realStatus.lastHeartbeat ? new Date(realStatus.lastHeartbeat).getTime() : Date.now();
    const effectiveSensorMs = Math.max(0, serverReceiveMs - delayOnPiMs);
    const effectiveLastSeen = effectiveSensorMs > 0 ? new Date(effectiveSensorMs).toISOString() : new Date().toISOString();
    return {
      ...bin,
      currentFillLevel: comp.fillLevel,
      distanceCm: typeof comp.distanceCm === 'number' && !Number.isNaN(comp.distanceCm) ? comp.distanceCm : null,
      fillCategory: computeFillCategory(comp.fillLevel),
      status: 'ONLINE' as const,
      lastSeen: effectiveLastSeen
    };
  }

  // 4. Nếu RAM không có reading nhưng Database có reading còn tươi (<= 15s)
  const binLastSeenMs = bin.lastSeen ? new Date(bin.lastSeen).getTime() : 0;
  const isDbFresh = binLastSeenMs > 0 && (Date.now() - binLastSeenMs <= DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS);
  if (isDbFresh && typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel)) {
    return {
      ...bin,
      currentFillLevel: bin.currentFillLevel,
      distanceCm: bin.distanceCm ?? null,
      fillCategory: computeFillCategory(bin.currentFillLevel),
      status: (bin.status === 'ONLINE' ? 'ONLINE' : 'OFFLINE') as any,
      lastSeen: new Date(binLastSeenMs).toISOString()
    };
  }

  return {
    ...bin,
    currentFillLevel: null,
    distanceCm: null,
    fillCategory: 'NORMAL' as const,
    status: 'OFFLINE' as const,
    lastSeen: comp?.updatedAt || realStatus.lastHeartbeat || (bin.lastSeen ? new Date(bin.lastSeen).toISOString() : null)
  };
}

export function syncBinsWithRealDevice<T extends {
  binCode: string;
  stationId?: string | null;
  installed?: boolean;
  station?: { id?: string; code?: string } | null;
  currentFillLevel?: number | null;
  status?: any;
  lastSeen?: any;
  distanceCm?: number | null;
  fillCategory?: any;
}>(
  bins: T[],
  realStatus: RealDeviceStatus = realDeviceService.getStatus(),
  targetStationId?: string
) {
  return bins.map((bin) => syncBinWithRealDevice(bin, realStatus, targetStationId));
}
