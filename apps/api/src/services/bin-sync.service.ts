import { realDeviceService, type RealDeviceStatus } from '../demo/real-device.service.js';
import { settingsService } from './settings.service.js';
import { DEVICE_HEALTH_CONFIG } from '../config/device-health.config.js';

export type FillCategory = 'NORMAL' | 'MONITOR' | 'NEARLY_FULL' | 'CRITICAL';

export interface CanonicalStationBin {
  id: string;
  stationId: string;
  stationCode: string;
  binCode: 'RECYCLABLE' | 'ORGANIC' | 'NON_RECYCLABLE';
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  currentFillLevel: number | null;
  distanceCm: number | null;
  status: 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
  installed: boolean;
  isActive: boolean;
  lastSeen: string | null;
  station: {
    id: string;
    code: string;
    name: string;
  };
}

/**
 * Danh sách 3 thùng chuẩn của Trạm B (STATION_B) phục vụ fallback an toàn trước và sau khi chạy SQL migration:
 * - RECYCLABLE: installed = true (kết nối ESP32-C6 HC1)
 * - ORGANIC: installed = false (NOT_INSTALLED)
 * - NON_RECYCLABLE: installed = false (NOT_INSTALLED)
 */
export const CANONICAL_STATION_B_BINS: CanonicalStationBin[] = [
  {
    id: 'bin_station_b_recyclable_id',
    stationId: 'station_b_canonical_id',
    stationCode: 'STATION_B',
    binCode: 'RECYCLABLE',
    name: 'Thùng Tái chế - Trạm B (HC1)',
    location: 'Khuôn viên phía Đông (Trạm B)',
    latitude: null,
    longitude: null,
    capacity: 100,
    currentFillLevel: null,
    distanceCm: null,
    status: 'OFFLINE',
    installed: true,
    isActive: true,
    lastSeen: null,
    station: {
      id: 'station_b_canonical_id',
      code: 'STATION_B',
      name: 'Trạm Thu gom Mở rộng B'
    }
  },
  {
    id: 'bin_station_b_organic_id',
    stationId: 'station_b_canonical_id',
    stationCode: 'STATION_B',
    binCode: 'ORGANIC',
    name: 'Thùng Hữu cơ - Trạm B (Chưa lắp cảm biến)',
    location: 'Khuôn viên phía Đông (Trạm B)',
    latitude: null,
    longitude: null,
    capacity: 100,
    currentFillLevel: null,
    distanceCm: null,
    status: 'MAINTENANCE',
    installed: false,
    isActive: true,
    lastSeen: null,
    station: {
      id: 'station_b_canonical_id',
      code: 'STATION_B',
      name: 'Trạm Thu gom Mở rộng B'
    }
  },
  {
    id: 'bin_station_b_non_recyclable_id',
    stationId: 'station_b_canonical_id',
    stationCode: 'STATION_B',
    binCode: 'NON_RECYCLABLE',
    name: 'Thùng Không tái chế - Trạm B (Chưa lắp cảm biến)',
    location: 'Khuôn viên phía Đông (Trạm B)',
    latitude: null,
    longitude: null,
    capacity: 100,
    currentFillLevel: null,
    distanceCm: null,
    status: 'MAINTENANCE',
    installed: false,
    isActive: true,
    lastSeen: null,
    station: {
      id: 'station_b_canonical_id',
      code: 'STATION_B',
      name: 'Trạm Thu gom Mở rộng B'
    }
  }
];

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
  // 1. Kiểm tra quyền sở hữu Trạm B vs Trạm A trước tiên
  const explicitCode = bin.station?.code || (bin as any).stationCode;
  const stId = (bin.station?.id || bin.stationId || '').toLowerCase();
  const isStationB =
    explicitCode === 'STATION_B' ||
    stId === 'station_b_canonical_id' ||
    stId === 'st-b' ||
    stId.includes('station_b') ||
    stId.includes('station-b') ||
    (Boolean(targetStationId && bin.stationId && bin.stationId !== targetStationId) && explicitCode !== 'STATION_A');

  const normalizedStationCode = isStationB ? 'STATION_B' : 'STATION_A';
  const normalizedStation = bin.station?.code
    ? bin.station
    : isStationB
      ? { id: bin.stationId || 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm Thu gom Mở rộng B' }
      : { id: bin.stationId || 'station_a_canonical_id', code: 'STATION_A', name: 'Trạm Thu gom Trung tâm A' };

  // 2. Nếu thùng rác chưa lắp đặt phần cứng (NOT_INSTALLED) hoặc là ORGANIC/NON_RECYCLABLE của Trạm B chưa lắp đặt
  if (bin.installed === false || (isStationB && bin.binCode !== 'RECYCLABLE' && bin.installed !== true)) {
    return {
      ...bin,
      installed: false,
      stationCode: normalizedStationCode,
      station: normalizedStation as any,
      currentFillLevel: null,
      distanceCm: null,
      fillCategory: 'NORMAL' as const,
      status: 'MAINTENANCE' as const,
      lastSeen: bin.lastSeen ? new Date(bin.lastSeen).toISOString() : null
    };
  }

  // 3. Đồng bộ Trạm B: kết hợp giữa vùng nhớ RAM tách biệt của Station B (realDeviceService.getStationBStatus) và Database
  if (isStationB) {
    const stationBStatus = realDeviceService.getStationBStatus();
    const isStationBRamOnline = stationBStatus.status === 'ONLINE' || stationBStatus.status === 'WARNING';
    const ramRecyclable = (isStationBRamOnline && bin.binCode === 'RECYCLABLE')
      ? stationBStatus.sensors?.recyclable
      : null;
    const ramFill =
      typeof ramRecyclable?.fillLevel === 'number' && !Number.isNaN(ramRecyclable.fillLevel)
        ? ramRecyclable.fillLevel
        : typeof ramRecyclable?.fillPercent === 'number' && !Number.isNaN(ramRecyclable.fillPercent)
        ? ramRecyclable.fillPercent
        : null;
    const ramHeartbeatMs = stationBStatus.lastHeartbeat ? new Date(stationBStatus.lastHeartbeat).getTime() : 0;

    const lastSeenMs = bin.lastSeen ? new Date(bin.lastSeen).getTime() : 0;
    const isDbFresh = lastSeenMs > 0 && (Date.now() - lastSeenMs <= DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS) && bin.status === 'ONLINE';

    // Nếu RAM của Trạm B có mẫu đo mới hơn hoặc khi DB chưa có bản ghi Trạm B
    if (isStationBRamOnline && ramFill !== null && ramRecyclable?.status !== 'STALE' && ramHeartbeatMs >= lastSeenMs) {
      const effectiveLastSeen = stationBStatus.lastHeartbeat || new Date().toISOString();
      return {
        ...bin,
        installed: true,
        stationCode: 'STATION_B',
        station: normalizedStation as any,
        currentFillLevel: ramFill,
        distanceCm: typeof ramRecyclable?.distanceCm === 'number' && !Number.isNaN(ramRecyclable.distanceCm) ? ramRecyclable.distanceCm : null,
        fillCategory: computeFillCategory(ramFill),
        status: 'ONLINE' as const,
        lastSeen: effectiveLastSeen
      };
    }

    const rawFill = isDbFresh && typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel)
      ? bin.currentFillLevel
      : null;
    const computedStatus = (isDbFresh && rawFill !== null) ? 'ONLINE' : 'OFFLINE';
    return {
      ...bin,
      installed: bin.installed ?? true,
      stationCode: 'STATION_B',
      station: normalizedStation as any,
      currentFillLevel: rawFill,
      distanceCm: isDbFresh ? (bin.distanceCm ?? null) : null,
      fillCategory: computeFillCategory(rawFill),
      status: computedStatus,
      lastSeen: bin.lastSeen ? new Date(bin.lastSeen).toISOString() : (stationBStatus.lastHeartbeat || null)
    };
  }

  // 4. Xử lý đồng bộ Trạm A từ phần cứng thực tế (Serial A / YOLO IPC)
  const isPiOnline = realStatus.status === 'ONLINE' || realStatus.status === 'WARNING';
  const sensors = isPiOnline ? realStatus.sensors : null;

  // Ánh xạ chuẩn: HC1 -> RECYCLABLE, HC2 -> NON_RECYCLABLE, HC3 -> ORGANIC
  let comp: any = null;
  if (bin.binCode === 'ORGANIC') comp = sensors?.organic;
  else if (bin.binCode === 'RECYCLABLE') comp = sensors?.recyclable;
  else if (bin.binCode === 'NON_RECYCLABLE') comp = sensors?.nonRecyclable;

  const rawFillLevel =
    typeof comp?.fillLevel === 'number' && !Number.isNaN(comp.fillLevel)
      ? comp.fillLevel
      : typeof comp?.fillPercent === 'number' && !Number.isNaN(comp.fillPercent)
      ? comp.fillPercent
      : null;

  const effectiveSensorSentAt = (realStatus as any).lastSensorSentAt || realStatus.sentAt;
  const packetSentMs = effectiveSensorSentAt ? new Date(effectiveSensorSentAt).getTime() : 0;
  const sensorMeasurementMs = comp?.updatedAt ? new Date(comp.updatedAt).getTime() : 0;
  const delayOnPiMs = (packetSentMs > 0 && sensorMeasurementMs > 0 && Number.isFinite(packetSentMs) && Number.isFinite(sensorMeasurementMs))
    ? Math.max(0, packetSentMs - sensorMeasurementMs)
    : 0;
  const isSensorFreshOnPi = delayOnPiMs <= DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS;

  const hasValidReading = Boolean(
    comp &&
    rawFillLevel !== null &&
    comp.status !== 'STALE' &&
    isSensorFreshOnPi &&
    isPiOnline
  );

  if (hasValidReading && rawFillLevel !== null) {
    const serverReceiveMs = realStatus.lastHeartbeat
      ? new Date(realStatus.lastHeartbeat).getTime()
      : realStatus.receivedAt
      ? new Date(realStatus.receivedAt).getTime()
      : Date.now();
    const effectiveLastSeen = serverReceiveMs > 0 ? new Date(serverReceiveMs).toISOString() : new Date().toISOString();
    return {
      ...bin,
      stationCode: 'STATION_A',
      station: normalizedStation as any,
      currentFillLevel: rawFillLevel,
      distanceCm: typeof comp.distanceCm === 'number' && !Number.isNaN(comp.distanceCm) ? comp.distanceCm : null,
      fillCategory: computeFillCategory(rawFillLevel),
      status: 'ONLINE' as const,
      lastSeen: effectiveLastSeen
    };
  }

  // 5. Nếu RAM không có reading nhưng Database có reading còn tươi (<= 15s)
  const binLastSeenMs = bin.lastSeen ? new Date(bin.lastSeen).getTime() : 0;
  const isDbFresh = binLastSeenMs > 0 && (Date.now() - binLastSeenMs <= DEVICE_HEALTH_CONFIG.ONLINE_THRESHOLD_MS);
  if (isDbFresh && typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel)) {
    return {
      ...bin,
      stationCode: 'STATION_A',
      station: normalizedStation as any,
      currentFillLevel: bin.currentFillLevel,
      distanceCm: bin.distanceCm ?? null,
      fillCategory: computeFillCategory(bin.currentFillLevel),
      status: (bin.status === 'ONLINE' ? 'ONLINE' : 'OFFLINE') as any,
      lastSeen: new Date(binLastSeenMs).toISOString()
    };
  }

  return {
    ...bin,
    stationCode: 'STATION_A',
    station: normalizedStation as any,
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

/**
 * Đảm bảo mọi API danh sách thùng rác (/api/bins, /api/dashboard/summary) luôn trả về đầy đủ
 * các ngăn của Trạm B (1 ngăn RECYCLABLE installed: true + 2 ngăn ORGANIC, NON_RECYCLABLE installed: false)
 * ngay cả khi SQL migration chưa chạy trên Production DB.
 */
export function ensureStationBBinsIfMissing<T extends {
  id?: string;
  binCode: string;
  stationId?: string | null;
  stationCode?: string;
  installed?: boolean;
  station?: { id?: string; code?: string; name?: string } | null;
  currentFillLevel?: number | null;
  status?: any;
  lastSeen?: any;
  distanceCm?: number | null;
  fillCategory?: any;
}>(
  syncedBins: T[],
  realStatus: RealDeviceStatus = realDeviceService.getStatus(),
  options?: { stationCode?: string; stationId?: string }
): T[] {
  const filterCode = options?.stationCode?.trim().toUpperCase();
  const filterId = options?.stationId?.trim();

  // Nếu người dùng đang lọc riêng Trạm A thì không chèn thêm Trạm B
  if (filterCode === 'STATION_A' || filterId === 'station_a_canonical_id') {
    return syncedBins;
  }

  const existingStationBCodes = new Set(
    syncedBins
      .filter((b) => {
        const code = b.station?.code || b.stationCode;
        const stId = (b.station?.id || b.stationId || '').toLowerCase();
        return code === 'STATION_B' || stId === 'station_b_canonical_id' || stId.includes('station_b');
      })
      .map((b) => b.binCode)
  );

  const missingStationBBins = CANONICAL_STATION_B_BINS
    .filter((canon) => !existingStationBCodes.has(canon.binCode))
    .map((canon) => syncBinWithRealDevice(canon, realStatus) as unknown as T);

  if (missingStationBBins.length === 0) {
    return syncedBins;
  }

  return [...syncedBins, ...missingStationBBins];
}

export function findCanonicalStationBBinById(idOrCode: string): CanonicalStationBin | null {
  const normalized = idOrCode.trim();
  const aliasMap: Record<string, 'RECYCLABLE' | 'ORGANIC' | 'NON_RECYCLABLE'> = {
    bin_station_b_recyclable_id: 'RECYCLABLE',
    station_b_canonical_recyclable: 'RECYCLABLE',
    'STATION_B:RECYCLABLE': 'RECYCLABLE',
    bin_station_b_organic_id: 'ORGANIC',
    station_b_canonical_organic: 'ORGANIC',
    'uninstalled-STATION_B-ORGANIC': 'ORGANIC',
    'STATION_B:ORGANIC': 'ORGANIC',
    bin_station_b_non_recyclable_id: 'NON_RECYCLABLE',
    station_b_canonical_non_recyclable: 'NON_RECYCLABLE',
    'uninstalled-STATION_B-NON_RECYCLABLE': 'NON_RECYCLABLE',
    'STATION_B:NON_RECYCLABLE': 'NON_RECYCLABLE'
  };
  const targetBinCode = aliasMap[normalized];
  if (!targetBinCode) return null;
  return CANONICAL_STATION_B_BINS.find((b) => b.binCode === targetBinCode) ?? null;
}
