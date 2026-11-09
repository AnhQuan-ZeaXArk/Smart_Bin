import type { Bin, FillCategory, BinStatus } from './bins';
import { translateBinStatus, translateFillCategory } from './i18n-labels';
import { parseTimestamp, shouldDropIncoming, isRaspberryPiDevice } from './device-utils';
import { WASTE_CATEGORY_ORDER, WASTE_CATEGORY_LABEL, type WasteCategoryKey } from './waste-category';

export interface BinViewModel {
  isValidReading: boolean;
  isOffline: boolean;
  isStale: boolean;
  isUninstalled?: boolean;
  hasValidFillLevel: boolean;
  fillPct: number;
  displayPercentage: string;
  progressWidth: string;
  tone: 'normal' | 'monitor' | 'nearly_full' | 'critical' | 'unavailable';
  statusBadgeText: string;
  fillCategoryBadgeText: string;
  hasDistance: boolean;
  distanceText: string | null;
  hasCapacity: boolean;
  capacityText: string | null;
  lastSeenText: string;
}

export function secondsAgoLabel(value: string | null, now?: number): string {
  if (!value) return 'Chưa có dữ liệu';
  const baseNow = typeof now === 'number' && now > 0 ? now : Date.now();
  const seconds = Math.max(0, Math.round((baseNow - new Date(value).getTime()) / 1000));
  if (seconds < 5) return 'Vừa xong';
  if (seconds < 60) return `Cập nhật ${seconds} giây trước`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Cập nhật ${minutes} phút trước`;
  return `Cập nhật lúc ${new Date(value).toLocaleTimeString('vi-VN')}`;
}

export function computeBinViewModel(
  bin: (Bin & { distanceCm?: number | null; isReal?: boolean }) | undefined,
  now?: number
): BinViewModel {
  if (!bin) {
    return {
      isValidReading: false,
      isOffline: true,
      isStale: false,
      isUninstalled: false,
      hasValidFillLevel: false,
      fillPct: 0,
      displayPercentage: '—',
      progressWidth: '0%',
      tone: 'unavailable',
      statusBadgeText: 'Chưa có dữ liệu',
      fillCategoryBadgeText: 'Chưa có dữ liệu',
      hasDistance: false,
      distanceText: null,
      hasCapacity: false,
      capacityText: null,
      lastSeenText: 'Chưa có dữ liệu'
    };
  }

  // Ngăn rác chưa được lắp đặt (ví dụ: Trạm B chỉ có ngăn Rác tái chế)
  if (bin.installed === false) {
    return {
      isValidReading: false,
      isOffline: false,
      isStale: false,
      isUninstalled: true,
      hasValidFillLevel: false,
      fillPct: 0,
      displayPercentage: '—',
      progressWidth: '0%',
      tone: 'unavailable',
      statusBadgeText: 'Chưa lắp đặt',
      fillCategoryBadgeText: 'Chưa lắp đặt',
      hasDistance: false,
      distanceText: null,
      hasCapacity: false,
      capacityText: null,
      lastSeenText: 'Chưa lắp đặt'
    };
  }

  const currentNow = typeof now === 'number' && now > 0 ? now : 0;
  const isOffline = bin.status === 'OFFLINE';
  const hasValidFillLevel = typeof bin.currentFillLevel === 'number' && !Number.isNaN(bin.currentFillLevel);

  // Phát hiện dữ liệu cũ quá 15 giây (STALE)
  const lastSeenMs = bin.lastSeen ? new Date(bin.lastSeen).getTime() : 0;
  const isStale = lastSeenMs > 0 && currentNow > 0 ? currentNow - lastSeenMs > 15000 : false;

  const isValidReading = hasValidFillLevel && !isOffline && !isStale;
  const fillPct = hasValidFillLevel ? Math.max(0, Math.min(100, Math.round(bin.currentFillLevel!))) : 0;

  const tone = !isValidReading
    ? 'unavailable'
    : fillPct >= 90
    ? 'critical'
    : fillPct >= 70
    ? 'nearly_full'
    : fillPct >= 50
    ? 'monitor'
    : 'normal';

  const statusBadgeText = isOffline
    ? 'Mất kết nối'
    : isStale
    ? 'Dữ liệu cũ (STALE)'
    : !hasValidFillLevel
    ? 'Chưa có dữ liệu'
    : translateBinStatus(bin.status);

  const fillCategoryBadgeText = isValidReading
    ? translateFillCategory(bin.fillCategory)
    : isOffline
    ? 'Mất kết nối'
    : isStale
    ? 'Cần kiểm tra'
    : 'Chưa có dữ liệu';

  const hasDistance = isValidReading && typeof bin.distanceCm === 'number' && !Number.isNaN(bin.distanceCm);
  const distanceText = hasDistance ? `${bin.distanceCm!.toFixed(1)} cm` : null;

  // Không suy diễn dung tích giả (240L, 360L) khi không có phần cứng xác nhận
  const hasCapacity = false;
  const capacityText = null;

  const lastSeenText = secondsAgoLabel(bin.lastSeen, currentNow);

  return {
    isValidReading,
    isOffline,
    isStale,
    hasValidFillLevel,
    fillPct,
    displayPercentage: isValidReading ? `${fillPct}%` : '—',
    progressWidth: isValidReading ? `${fillPct}%` : '0%',
    tone,
    statusBadgeText,
    fillCategoryBadgeText,
    hasDistance,
    distanceText,
    hasCapacity,
    capacityText,
    lastSeenText
  };
}

export function getFillCategoryForLevel(fillLevel: number | null | undefined): FillCategory {
  if (fillLevel === null || fillLevel === undefined || Number.isNaN(fillLevel)) return 'NORMAL';
  if (fillLevel >= 90) return 'CRITICAL';
  if (fillLevel >= 70) return 'NEARLY_FULL';
  if (fillLevel >= 50) return 'MONITOR';
  return 'NORMAL';
}

/**
 * Hàm chuẩn hóa hợp nhất dữ liệu nhịp tim thực tế từ Pi 5 vào danh sách ngăn rác.
 * Được dùng chung giữa Dashboard và Trang Quản lý thùng rác (Bins).
 */
export function mergeDeviceHeartbeatToBins<T extends Bin & { distanceCm?: number | null; isReal?: boolean }>(
  bins: T[],
  hb: any
): (T & { distanceCm: number | null; isReal: boolean })[] {
  if (!hb) {
    return bins.map((b) => ({
      ...b,
      distanceCm: typeof b.distanceCm === 'number' ? b.distanceCm : null,
      isReal: true
    }));
  }

  // Nếu sự kiện dành cho thiết bị ngoại vi khác (Camera, MQTT) và không phải là nhịp tim trạm, không thay đổi ngăn rác
  const isStationHeartbeat = Boolean(hb.stationCode);
  if (hb.deviceId && !isRaspberryPiDevice(hb.deviceId, hb.deviceType) && !isStationHeartbeat) {
    return bins.map((b) => ({
      ...b,
      distanceCm: typeof b.distanceCm === 'number' ? b.distanceCm : null,
      isReal: true
    }));
  }

  const isOffline = hb.status === 'OFFLINE';
  const sensors = isOffline ? null : hb.sensors;

  // Timestamp toàn cục của gói heartbeat
  const hbTs = parseTimestamp(hb.lastHeartbeat || hb.receivedAt || hb.sentAt);

  const mapping: Record<string, 'ORGANIC' | 'RECYCLABLE' | 'NON_RECYCLABLE'> = {
    recyclable: 'RECYCLABLE',
    nonRecyclable: 'NON_RECYCLABLE',
    organic: 'ORGANIC'
  };

  return bins.map((bin) => {
    // Ngăn rác chưa lắp đặt không nhận dữ liệu cảm biến
    if (bin.installed === false) {
      return {
        ...bin,
        currentFillLevel: null,
        distanceCm: null,
        status: 'MAINTENANCE' as BinStatus,
        isReal: true
      };
    }

    // Cách ly Telemetry theo Station: Nếu có stationCode, chỉ cập nhật Bin thuộc đúng Station đó
    const binStationCode = bin.stationCode || (bin as any).station?.code || (bin.stationId === 'station_b_canonical_id' ? 'STATION_B' : (bin.stationId === 'station_a_canonical_id' ? 'STATION_A' : undefined));
    if (hb.stationCode && binStationCode && hb.stationCode !== binStationCode) {
      return {
        ...bin,
        distanceCm: typeof bin.distanceCm === 'number' ? bin.distanceCm : null,
        isReal: true
      };
    }

    let sensorKey: string | null = null;
    for (const [sKey, bCode] of Object.entries(mapping)) {
      if (bCode === bin.binCode) {
        sensorKey = sKey;
        break;
      }
    }
    const comp = sensorKey && sensors ? sensors[sensorKey] : null;

    // Mỗi cảm biến có thời gian cập nhật độc lập (comp.updatedAt hoặc fallback về hbTs)
    const sensorUpdatedAtMs = parseTimestamp(comp?.updatedAt) || hbTs;
    const currentBinTs = parseTimestamp(bin.lastSeen);

    // Chống sự kiện cũ: Heartbeat cũ không được ghi đè dữ liệu mới
    if (shouldDropIncoming(currentBinTs, sensorUpdatedAtMs)) {
      return {
        ...bin,
        distanceCm: typeof bin.distanceCm === 'number' ? bin.distanceCm : null,
        isReal: true
      };
    }

    if (comp && typeof comp.fillLevel === 'number' && comp.status !== 'STALE' && !isOffline) {
      return {
        ...bin,
        currentFillLevel: comp.fillLevel,
        distanceCm: typeof comp.distanceCm === 'number' ? comp.distanceCm : null,
        fillCategory: getFillCategoryForLevel(comp.fillLevel),
        status: 'ONLINE' as BinStatus,
        lastSeen: comp.updatedAt || hb.lastHeartbeat || (sensorUpdatedAtMs > 0 ? new Date(sensorUpdatedAtMs).toISOString() : new Date().toISOString()),
        isReal: true
      };
    }

    return {
      ...bin,
      currentFillLevel: null,
      distanceCm: null,
      fillCategory: 'NORMAL' as FillCategory,
      status: 'OFFLINE' as BinStatus,
      lastSeen: comp?.updatedAt || hb.lastHeartbeat || (sensorUpdatedAtMs > 0 ? new Date(sensorUpdatedAtMs).toISOString() : bin.lastSeen),
      isReal: true
    };
  });
}

export interface StationGroup<T extends Bin = Bin> {
  id: string;
  code: string;
  name: string;
  location: string | null;
  status: 'ONLINE' | 'WARNING' | 'OFFLINE' | 'MAINTENANCE';
  gatewayInfo: string;
  controllerInfo: string;
  installedCount: number;
  totalBinsCount: number;
  lastSeenText: string;
  averageFillPct: number | null;
  bins: T[];
  compartments: {
    key: WasteCategoryKey;
    label: string;
    bin: T | undefined;
  }[];
}

export const DEFAULT_STATION_CONFIG = [
  {
    id: 'station_a_canonical_id',
    code: 'STATION_A',
    name: 'Trạm Thu gom Trung tâm A',
    status: 'ONLINE' as const,
    location: 'Khuôn viên chính'
  },
  {
    id: 'station_b_canonical_id',
    code: 'STATION_B',
    name: 'Trạm Thu gom Mở rộng B',
    status: 'OFFLINE' as const,
    location: 'Khuôn viên phía Đông'
  }
];

export function groupBinsByStation<T extends Bin & { distanceCm?: number | null; isReal?: boolean }>(
  bins: T[],
  knownStations: { id: string; code: string; name: string; status?: string; location?: string | null }[] = [],
  now?: number
): StationGroup<T>[] {
  const currentNow = typeof now === 'number' && now > 0 ? now : Date.now();

  const DEFAULT_HARDWARE_METADATA: Record<string, { name: string; location: string; gateway: string; controller: string }> = {
    STATION_A: {
      name: 'Trạm Thu gom Trung tâm A',
      location: 'Khuôn viên chính',
      gateway: 'Raspberry Pi 5',
      controller: 'ESP32 A'
    },
    STATION_B: {
      name: 'Trạm Thu gom Mở rộng B',
      location: 'Khuôn viên phía Đông',
      gateway: 'Raspberry Pi 5 (Dùng chung)',
      controller: 'ESP32-C6'
    }
  };

  let stationDefs: { id: string; code: string; name: string; status: string; location: string | null }[] = [];

  if (knownStations && knownStations.length > 0) {
    stationDefs = knownStations.map((st) => ({
      id: st.id,
      code: st.code || (st.id === 'station_a_canonical_id' ? 'STATION_A' : 'STATION_B'),
      name: st.name || DEFAULT_HARDWARE_METADATA[st.code]?.name || `Trạm ${st.code}`,
      status: (st.status as any) || 'OFFLINE',
      location: st.location || DEFAULT_HARDWARE_METADATA[st.code]?.location || null
    }));
  } else {
    const foundCodes = new Set<string>();
    for (const bin of bins) {
      const code = bin.station?.code || bin.stationCode || (bin.stationId === 'station_b_canonical_id' ? 'STATION_B' : 'STATION_A');
      foundCodes.add(code);
    }
    if (foundCodes.size === 0) foundCodes.add('STATION_A');

    stationDefs = Array.from(foundCodes).map((code) => {
      const meta = DEFAULT_HARDWARE_METADATA[code] || {
        name: `Trạm ${code}`,
        location: null,
        gateway: 'Raspberry Pi 5',
        controller: 'Bộ điều khiển trạm'
      };
      return {
        id: code === 'STATION_B' ? 'station_b_canonical_id' : 'station_a_canonical_id',
        code,
        name: meta.name,
        status: code === 'STATION_A' ? 'ONLINE' : 'OFFLINE',
        location: meta.location
      };
    });
  }

  stationDefs.sort((a, b) => a.code.localeCompare(b.code));

  return stationDefs.map((st) => {
    const meta = DEFAULT_HARDWARE_METADATA[st.code] || {
      name: st.name,
      location: st.location,
      gateway: 'Raspberry Pi 5',
      controller: 'Bộ điều khiển trạm'
    };

    const stationBins = bins.filter((b) => {
      const bCode = b.station?.code || b.stationCode;
      const bId = b.station?.id || b.stationId;
      if (st.code === 'STATION_A') {
        return bCode === 'STATION_A' || bId === st.id || (!bCode && !bId);
      }
      return bCode === st.code || bId === st.id;
    });

    const compartments = WASTE_CATEGORY_ORDER.map((key) => {
      const existing = stationBins.find((b) => b.binCode === key);
      if (existing) {
        // Enforce Station B architectural layout: only RECYCLABLE is installed, ORGANIC & NON_RECYCLABLE are NOT_INSTALLED
        const isInstalled = st.code === 'STATION_B'
          ? (key === 'RECYCLABLE' && existing.installed !== false)
          : (existing.installed !== false);

        return {
          key,
          label: WASTE_CATEGORY_LABEL[key],
          bin: {
            ...existing,
            installed: isInstalled
          }
        };
      }

      // If no existing bin returned (e.g. Station B has no telemetry yet):
      // - Station B: By architecture, RECYCLABLE is INSTALLED (waiting for telemetry, status: OFFLINE, currentFillLevel: null)
      //              ORGANIC & NON_RECYCLABLE are NOT_INSTALLED (installed: false, status: MAINTENANCE)
      // - Station A / Other: Missing bin from dataset is marked uninstalled (installed: false)
      const isInstalled = st.code === 'STATION_B' ? (key === 'RECYCLABLE') : false;

      const placeholderBin = {
        id: `uninstalled-${st.code}-${key}`,
        binCode: key,
        name: key === 'ORGANIC' ? 'Rác hữu cơ' : key === 'RECYCLABLE' ? 'Rác tái chế' : 'Rác không tái chế',
        location: st.location || `Ngăn ${WASTE_CATEGORY_LABEL[key]}`,
        latitude: null,
        longitude: null,
        capacity: key === 'NON_RECYCLABLE' ? 360 : 240,
        currentFillLevel: null,
        distanceCm: null,
        fillCategory: 'NORMAL' as const,
        status: isInstalled ? ('OFFLINE' as const) : ('MAINTENANCE' as const),
        isActive: isInstalled,
        installed: isInstalled,
        lastSeen: null,
        createdAt: '',
        updatedAt: '',
        stationId: st.id,
        stationCode: st.code,
        station: { id: st.id, code: st.code, name: st.name }
      } as unknown as T;

      return {
        key,
        label: WASTE_CATEGORY_LABEL[key],
        bin: placeholderBin
      };
    });

    const installedBins = compartments
      .map((c) => c.bin)
      .filter((b): b is T => Boolean(b && b.installed !== false));

    const installedCount = installedBins.length;
    const totalBinsCount = compartments.length;

    let latestSeenTime: string | null = null;
    let latestMs = 0;
    for (const b of installedBins) {
      if (b.lastSeen) {
        const ms = new Date(b.lastSeen).getTime();
        if (ms > latestMs) {
          latestMs = ms;
          latestSeenTime = b.lastSeen;
        }
      }
    }
    const lastSeenText = latestSeenTime ? secondsAgoLabel(latestSeenTime, currentNow) : 'Chưa có dữ liệu';

    const numericLevels = installedBins
      .map((b) => b.currentFillLevel)
      .filter((lvl): lvl is number => typeof lvl === 'number' && !Number.isNaN(lvl));

    const averageFillPct = numericLevels.length > 0
      ? Math.round(numericLevels.reduce((a, b) => a + b, 0) / numericLevels.length)
      : null;

    let stationStatus: 'ONLINE' | 'WARNING' | 'OFFLINE' | 'MAINTENANCE' = (st.status as any) || 'OFFLINE';
    const anyOnlineBin = installedBins.some((b) => b.status === 'ONLINE' && b.currentFillLevel !== null);
    if (anyOnlineBin) {
      stationStatus = 'ONLINE';
    } else if (installedBins.every((b) => b.status === 'OFFLINE' || b.currentFillLevel === null)) {
      if (st.status === 'ONLINE' && latestMs === 0) {
        stationStatus = 'ONLINE';
      } else {
        stationStatus = (st.status as any) || 'OFFLINE';
      }
    }

    return {
      id: st.id,
      code: st.code,
      name: st.name,
      location: st.location,
      status: stationStatus,
      gatewayInfo: meta.gateway,
      controllerInfo: meta.controller,
      installedCount,
      totalBinsCount,
      lastSeenText,
      averageFillPct,
      bins: stationBins,
      compartments
    };
  });
}

