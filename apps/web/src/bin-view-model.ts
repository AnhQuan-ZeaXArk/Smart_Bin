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
  lastKnownFillPct?: number | null;
  lastKnownText?: string | null;
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

  const lastKnownFillPct = typeof (bin as any).lastKnownFillLevel === 'number' && !Number.isNaN((bin as any).lastKnownFillLevel)
    ? Math.max(0, Math.min(100, Math.round((bin as any).lastKnownFillLevel)))
    : (hasValidFillLevel ? fillPct : null);

  const lastKnownText = !isValidReading && lastKnownFillPct !== null ? `Gần nhất: ${lastKnownFillPct}%` : null;

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
    lastKnownFillPct,
    lastKnownText,
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

export function resolveBinStationCode(bin: {
  stationId?: string | null;
  stationCode?: string | null;
  station?: { id?: string; code?: string } | null;
}): string {
  const explicitCode = bin.station?.code || bin.stationCode;
  if (explicitCode) return explicitCode.toUpperCase();
  const stId = (bin.station?.id || bin.stationId || '').toLowerCase();
  if (
    stId === 'station_b_canonical_id' ||
    stId === 'st-b' ||
    stId.includes('station_b') ||
    stId.includes('station-b')
  ) {
    return 'STATION_B';
  }
  return 'STATION_A';
}

/**
 * Hợp nhất danh sách ngăn rác trả về từ REST API (/api/dashboard/summary hoặc /api/bins)
 * với trạng thái realtime hiện tại trên trình duyệt:
 * 1. Không bao giờ để bản ghi REST cũ ghi đè dữ liệu realtime Socket.IO mới hơn.
 * 2. Neo mốc thời gian tươi (lastSeen) theo đồng hồ trình duyệt khi nhận phản hồi ONLINE trực tiếp,
 *    loại bỏ hoàn toàn lỗi lệch đồng hồ giữa PC người dùng và Render Server.
 */
export function mergeRestBinsWithRealtimeState<T extends Bin & { distanceCm?: number | null; isReal?: boolean }>(
  currentBins: T[] | undefined | null,
  apiBins: T[],
  clientReceiveMs?: number
): T[] {
  const normalizedApiBins = apiBins.map((apiBin) => {
    const serverLastSeenMs = parseTimestamp(apiBin.lastSeen);
    const hasNumericFill = typeof apiBin.currentFillLevel === 'number' && !Number.isNaN(apiBin.currentFillLevel);
    // Nếu Backend xác nhận bin đang ONLINE với số đo hợp lệ nhưng đồng hồ PC lệch với Server (> 2s),
    // neo lastSeen về clientReceiveMs để tránh cờ STALE giả trên trình duyệt.
    let anchoredLastSeen = apiBin.lastSeen;
    if (
      typeof clientReceiveMs === 'number' &&
      clientReceiveMs > 0 &&
      apiBin.status === 'ONLINE' &&
      hasNumericFill &&
      serverLastSeenMs > 0 &&
      Math.abs(clientReceiveMs - serverLastSeenMs) > 2000
    ) {
      anchoredLastSeen = new Date(clientReceiveMs).toISOString();
    }
    return {
      ...apiBin,
      lastSeen: anchoredLastSeen,
      lastServerHeartbeatMs: serverLastSeenMs > 0 ? serverLastSeenMs : undefined,
      isReal: true
    } as T;
  });

  if (!currentBins || currentBins.length === 0) {
    return normalizedApiBins;
  }

  return normalizedApiBins.map((apiBin) => {
    const apiStationCode = resolveBinStationCode(apiBin);
    const existingBin = currentBins.find((b) => {
      if (b.id && apiBin.id && b.id === apiBin.id) return true;
      const bStationCode = resolveBinStationCode(b);
      const stationIdMatch = Boolean(b.stationId && apiBin.stationId && b.stationId === apiBin.stationId);
      return b.binCode === apiBin.binCode && (bStationCode === apiStationCode || stationIdMatch);
    });
    if (!existingBin) return apiBin;

    const existingServerTs = typeof (existingBin as any).lastServerHeartbeatMs === 'number' && (existingBin as any).lastServerHeartbeatMs > 0
      ? (existingBin as any).lastServerHeartbeatMs
      : parseTimestamp(existingBin.lastSeen);
    const apiServerTs = typeof (apiBin as any).lastServerHeartbeatMs === 'number' && (apiBin as any).lastServerHeartbeatMs > 0
      ? (apiBin as any).lastServerHeartbeatMs
      : parseTimestamp(apiBin.lastSeen);

    const existingHasValidFill =
      typeof existingBin.currentFillLevel === 'number' &&
      !Number.isNaN(existingBin.currentFillLevel) &&
      existingBin.status === 'ONLINE';

    // Nếu dữ liệu realtime hiện tại trên client mới hơn dữ liệu REST API trả về
    // (hoặc cùng thời điểm nhưng REST trả về null do truy vấn DB trước khi commit xong):
    if (
      existingHasValidFill &&
      (existingServerTs > apiServerTs || (existingServerTs === apiServerTs && apiBin.currentFillLevel === null))
    ) {
      return {
        ...apiBin,
        currentFillLevel: existingBin.currentFillLevel,
        status: existingBin.status,
        distanceCm: existingBin.distanceCm ?? apiBin.distanceCm ?? null,
        lastSeen: existingBin.lastSeen,
        lastServerHeartbeatMs: existingServerTs > 0 ? existingServerTs : (apiBin as any).lastServerHeartbeatMs,
        fillCategory: existingBin.fillCategory,
        lastKnownFillLevel: (existingBin as any).lastKnownFillLevel ?? existingBin.currentFillLevel,
        isReal: true
      } as T;
    }

    // Bảo toàn lastKnownFillLevel nếu API trả về null
    if (apiBin.currentFillLevel === null && typeof (existingBin as any).lastKnownFillLevel === 'number') {
      return {
        ...apiBin,
        lastKnownFillLevel: (existingBin as any).lastKnownFillLevel,
        isReal: true
      } as T;
    }

    return apiBin;
  });
}

/**
 * Hàm chuẩn hóa hợp nhất dữ liệu nhịp tim thực tế từ Pi 5 vào danh sách ngăn rác.
 * Được dùng chung giữa Dashboard và Trang Quản lý thùng rác (Bins).
 */
export function mergeDeviceHeartbeatToBins<T extends Bin & { distanceCm?: number | null; isReal?: boolean }>(
  bins: T[],
  hb: any,
  clientReceiveMs?: number
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

  // Round 22: Đảm bảo ngăn rác Trạm B tồn tại trong working list nếu nhận được heartbeat của STATION_B
  let workingBins: (T & { distanceCm?: number | null; isReal?: boolean })[] = bins;
  const hasStationBBin = bins.some((b) => resolveBinStationCode(b) === 'STATION_B');
  if (!hasStationBBin && (hb.stationCode || '').toUpperCase() === 'STATION_B') {
    workingBins = [...bins, ...(createDefaultStationBBins() as unknown as T[])];
  }

  const isOffline = hb.status === 'OFFLINE';
  const sensors = isOffline ? null : hb.sensors;

  // Nếu sự kiện heartbeat không chứa thông tin cảm biến và không phải là sự kiện OFFLINE
  // (ví dụ: device:status cập nhật nhiệt độ/uptime), bảo toàn nguyên vẹn dữ liệu ngăn rác hiện tại,
  // tuyệt đối không xóa mức đầy thành null.
  if (!sensors && !isOffline) {
    return workingBins.map((b) => ({
      ...b,
      distanceCm: typeof b.distanceCm === 'number' ? b.distanceCm : null,
      isReal: true
    }));
  }

  // Timestamp toàn cục của gói heartbeat từ Server (dùng để kiểm tra thứ tự gói tin out-of-order)
  const serverHbMs = parseTimestamp(hb.lastHeartbeat || hb.receivedAt || hb.sentAt);
  const hbTs = serverHbMs || Date.now();
  // Nếu gói tin vừa nhận trực tiếp qua Socket.IO tại trình duyệt (clientReceiveMs > 0)
  // và đồng hồ PC lệch với đồng hồ Server (> 2s), neo thời점 nhận về đồng hồ trình duyệt.
  const baseReceiveMs =
    typeof clientReceiveMs === 'number' && clientReceiveMs > 0 && (serverHbMs === 0 || Math.abs(clientReceiveMs - serverHbMs) > 2000)
      ? clientReceiveMs
      : hbTs;

  const mapping: Record<string, 'ORGANIC' | 'RECYCLABLE' | 'NON_RECYCLABLE'> = {
    recyclable: 'RECYCLABLE',
    nonRecyclable: 'NON_RECYCLABLE',
    organic: 'ORGANIC'
  };

  return workingBins.map((bin) => {
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

    // Cách ly Telemetry theo Station (sử dụng cả stationId và stationCode + binCode):
    // Tuyệt đối không cho phép dữ liệu Trạm A ghi đè Trạm B và ngược lại
    const binStationCode = resolveBinStationCode(bin);
    const incomingStationCode = (
      hb.stationCode ||
      (hb.stationId === 'station_b_canonical_id' ? 'STATION_B' : 'STATION_A')
    ).toUpperCase();
    const stationIdMismatch = Boolean(hb.stationId && bin.stationId && hb.stationId !== bin.stationId);

    if (incomingStationCode !== binStationCode || stationIdMismatch) {
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

    // Kiểm tra thứ tự gói tin trong cùng miền thời gian Server để chống ghi đè bởi bản tin cũ (out-of-order)
    const incomingTs = serverHbMs || parseTimestamp(comp?.updatedAt);
    const currentBinServerTs =
      typeof (bin as any).lastServerHeartbeatMs === 'number' && (bin as any).lastServerHeartbeatMs > 0
        ? (bin as any).lastServerHeartbeatMs
        : parseTimestamp(bin.lastSeen);

    if (shouldDropIncoming(currentBinServerTs, incomingTs)) {
      return {
        ...bin,
        distanceCm: typeof bin.distanceCm === 'number' ? bin.distanceCm : null,
        isReal: true
      };
    }

    const rawFillLevel =
      typeof comp?.fillLevel === 'number' && !Number.isNaN(comp.fillLevel)
        ? comp.fillLevel
        : typeof comp?.fillPercent === 'number' && !Number.isNaN(comp.fillPercent)
        ? comp.fillPercent
        : null;

    if (comp && rawFillLevel !== null && comp.status !== 'STALE' && !isOffline) {
      // Chỉ tính delayOnPiMs khi có cả hb.sentAt và comp.updatedAt (cùng miền đồng hồ trên Pi)
      const packetSentMs = parseTimestamp(hb.sentAt);
      const sensorMeasurementMs = parseTimestamp(comp.updatedAt);
      const delayOnPiMs = (packetSentMs > 0 && sensorMeasurementMs > 0)
        ? Math.max(0, packetSentMs - sensorMeasurementMs)
        : 0;
      // Nếu cảm biến riêng lẻ trên Pi đã quá hạn (> 15s) tại thời điểm Pi phát tin, giữ nguyên độ trễ để gắn cờ STALE.
      // Nếu cảm biến còn tươi (<= 15s) khi Pi phát tin, neo vào thời điểm nhận gói tin (baseReceiveMs)
      // để tránh cộng dồn kép làm các thẻ ngăn rác chuyển sang "—" trong khi Header vẫn tính trung bình.
      const effectiveSensorMs = delayOnPiMs > 15000
        ? Math.max(0, baseReceiveMs - delayOnPiMs)
        : baseReceiveMs;
      const authoritativeLastSeen = effectiveSensorMs > 0 ? new Date(effectiveSensorMs).toISOString() : new Date().toISOString();

      return {
        ...bin,
        currentFillLevel: rawFillLevel,
        lastKnownFillLevel: rawFillLevel,
        distanceCm: typeof comp.distanceCm === 'number' ? comp.distanceCm : null,
        fillCategory: getFillCategoryForLevel(rawFillLevel),
        status: 'ONLINE' as BinStatus,
        lastSeen: authoritativeLastSeen,
        lastServerHeartbeatMs: serverHbMs > 0 ? serverHbMs : undefined,
        isReal: true
      };
    }

    // Nếu gói cập nhật chỉ chứa một phần sensors (không có khóa sensorKey thay vì truyền rõ null)
    // và ngăn rác hiện tại đang có số đo hợp lệ còn tươi (<= 15s), bảo toàn số đo hiện tại của ngăn rác đó.
    if (sensorKey && sensors && !(sensorKey in sensors) && !isOffline) {
      const existingLastSeenMs = parseTimestamp(bin.lastSeen);
      const isExistingStillFresh =
        typeof bin.currentFillLevel === 'number' &&
        !Number.isNaN(bin.currentFillLevel) &&
        bin.status === 'ONLINE' &&
        existingLastSeenMs > 0 &&
        (baseReceiveMs - existingLastSeenMs <= 15000);
      if (isExistingStillFresh) {
        return {
          ...bin,
          distanceCm: typeof bin.distanceCm === 'number' ? bin.distanceCm : null,
          isReal: true
        };
      }
    }

    // Khi offline hoặc không có reading hợp lệ:
    // GIỮ LẠI lastKnownFillLevel và không xóa sạch lịch sử
    const preservedLastKnown = (bin as any).lastKnownFillLevel ?? (typeof bin.currentFillLevel === 'number' ? bin.currentFillLevel : null);
    return {
      ...bin,
      currentFillLevel: null,
      lastKnownFillLevel: preservedLastKnown,
      distanceCm: null,
      fillCategory: 'NORMAL' as FillCategory,
      status: 'OFFLINE' as BinStatus,
      lastSeen: hb.lastHeartbeat || comp?.updatedAt || (incomingTs > 0 ? new Date(incomingTs).toISOString() : bin.lastSeen),
      lastServerHeartbeatMs: serverHbMs > 0 ? serverHbMs : (bin as any).lastServerHeartbeatMs,
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

export const FALLBACK_STATION_B = {
  id: 'station_b_canonical_id',
  code: 'STATION_B',
  name: 'Trạm Thu gom Trung tâm B',
  status: 'OFFLINE' as const,
  isActive: true,
  location: 'Khuôn viên phía Đông'
};

export const DEFAULT_STATION_CONFIG = [
  {
    id: 'station_a_canonical_id',
    code: 'STATION_A',
    name: 'Trạm Thu gom Trung tâm A',
    status: 'ONLINE' as const,
    isActive: true,
    location: 'Khuôn viên chính'
  },
  FALLBACK_STATION_B
];

export const DEFAULT_HARDWARE_METADATA: Record<string, { name: string; location: string; gateway: string; controller: string }> = {
  STATION_A: {
    name: 'Trạm Thu gom Trung tâm A',
    location: 'Khuôn viên chính',
    gateway: 'Raspberry Pi 5',
    controller: 'ESP32 A'
  },
  STATION_B: {
    name: 'Trạm Thu gom Trung tâm B',
    location: 'Khuôn viên phía Đông',
    gateway: 'Raspberry Pi 5 (Dùng chung)',
    controller: 'ESP32-C6'
  }
};

export function createDefaultStationBBins(): (Bin & { distanceCm: number | null; isReal: boolean })[] {
  return [
    {
      id: 'bin_station_b_recyclable_id',
      binCode: 'RECYCLABLE',
      name: 'Thùng rác tái chế',
      location: 'Khuôn viên phía Đông',
      latitude: null,
      longitude: null,
      capacity: 240,
      currentFillLevel: null,
      distanceCm: null,
      fillCategory: 'NORMAL',
      status: 'OFFLINE',
      isActive: true,
      installed: true,
      lastSeen: null,
      createdAt: '',
      updatedAt: '',
      stationId: 'station_b_canonical_id',
      stationCode: 'STATION_B',
      station: { id: 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm Thu gom Trung tâm B' },
      isReal: true
    },
    {
      id: 'bin_station_b_organic_id',
      binCode: 'ORGANIC',
      name: 'Thùng rác hữu cơ',
      location: 'Khuôn viên phía Đông',
      latitude: null,
      longitude: null,
      capacity: 240,
      currentFillLevel: null,
      distanceCm: null,
      fillCategory: 'NORMAL',
      status: 'MAINTENANCE',
      isActive: false,
      installed: false,
      lastSeen: null,
      createdAt: '',
      updatedAt: '',
      stationId: 'station_b_canonical_id',
      stationCode: 'STATION_B',
      station: { id: 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm Thu gom Trung tâm B' },
      isReal: true
    },
    {
      id: 'bin_station_b_non_recyclable_id',
      binCode: 'NON_RECYCLABLE',
      name: 'Thùng rác không tái chế',
      location: 'Khuôn viên phía Đông',
      latitude: null,
      longitude: null,
      capacity: 360,
      currentFillLevel: null,
      distanceCm: null,
      fillCategory: 'NORMAL',
      status: 'MAINTENANCE',
      isActive: false,
      installed: false,
      lastSeen: null,
      createdAt: '',
      updatedAt: '',
      stationId: 'station_b_canonical_id',
      stationCode: 'STATION_B',
      station: { id: 'station_b_canonical_id', code: 'STATION_B', name: 'Trạm Thu gom Trung tâm B' },
      isReal: true
    }
  ];
}

/**
 * Chuẩn hóa danh sách ngăn rác trả về từ API (/api/bins hoặc /api/dashboard/summary)
 * để cả trang Tổng quan (DashboardPage) và trang Quản lý thùng rác (BinListPage)
 * luôn nhận đủ cả Station A và Station B.
 */
export function ensureAllStationBins<T extends Bin & { distanceCm?: number | null; isReal?: boolean }>(
  apiBins: T[],
  selectedStationCode?: string
): (T & { isReal: boolean })[] {
  const filterCode = selectedStationCode?.trim().toUpperCase();
  const normalized = apiBins.map((b) => ({
    ...b,
    stationCode: resolveBinStationCode(b),
    isReal: true
  }));

  if (filterCode === 'STATION_A') {
    return normalized.filter((b) => resolveBinStationCode(b) === 'STATION_A');
  }

  const existingStationBCodes = new Set(
    normalized
      .filter((b) => resolveBinStationCode(b) === 'STATION_B')
      .map((b) => b.binCode)
  );

  const missingStationB = createDefaultStationBBins()
    .filter((b) => !existingStationBCodes.has(b.binCode)) as unknown as (T & { isReal: boolean })[];

  const combined = missingStationB.length > 0 ? [...normalized, ...missingStationB] : normalized;
  if (filterCode === 'STATION_B') {
    return combined.filter((b) => resolveBinStationCode(b) === 'STATION_B');
  }
  return combined;
}

export function ensureStationList(
  knownStations?: { id: string; code: string; name?: string; status?: string; location?: string | null; isActive?: boolean }[],
  options?: { allowSingleStation?: boolean }
): { id: string; code: string; name: string; status: string; location: string | null; isActive: boolean }[] {
  const map = new Map<string, { id: string; code: string; name: string; status: string; location: string | null; isActive: boolean }>();

  if (knownStations && knownStations.length > 0) {
    for (const st of knownStations) {
      const code = st.code || (st.id === 'station_a_canonical_id' ? 'STATION_A' : 'STATION_B');
      map.set(code, {
        id: st.id,
        code,
        name: st.name || DEFAULT_HARDWARE_METADATA[code]?.name || `Trạm ${code}`,
        status: (st.status as any) || (code === 'STATION_A' ? 'ONLINE' : 'OFFLINE'),
        location: st.location || DEFAULT_HARDWARE_METADATA[code]?.location || null,
        isActive: st.isActive ?? true
      });
    }
  } else {
    map.set('STATION_A', {
      id: 'station_a_canonical_id',
      code: 'STATION_A',
      name: 'Trạm Thu gom Trung tâm A',
      status: 'ONLINE',
      location: 'Khuôn viên chính',
      isActive: true
    });
  }

  // Round 22 Core Requirement:
  // Nếu API chưa trả về STATION_B (do Production Database chưa chạy patch),
  // tự động bổ sung Station B fallback để Dashboard luôn hiển thị cả hai trạm.
  // Khi API đã có STATION_B, map.set đã có dữ liệu thật nên fallback không ghi đè (không trùng lặp).
  if (!map.has('STATION_B') && !options?.allowSingleStation) {
    map.set('STATION_B', {
      id: FALLBACK_STATION_B.id,
      code: FALLBACK_STATION_B.code,
      name: FALLBACK_STATION_B.name,
      status: FALLBACK_STATION_B.status,
      location: FALLBACK_STATION_B.location,
      isActive: FALLBACK_STATION_B.isActive
    });
  }

  return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
}

export function groupBinsByStation<T extends Bin & { distanceCm?: number | null; isReal?: boolean }>(
  bins: T[],
  knownStations: { id: string; code: string; name: string; status?: string; location?: string | null; isActive?: boolean }[] = [],
  now?: number,
  options?: { allowSingleStation?: boolean }
): StationGroup<T>[] {
  const currentNow = typeof now === 'number' && now > 0 ? now : Date.now();

  const stationDefs = ensureStationList(knownStations, options);

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
      const matchingBins = stationBins.filter((b) => b.binCode === key);
      const existing = matchingBins.length <= 1
        ? matchingBins[0]
        : matchingBins.slice().sort((a, b) => {
            const aValid = typeof a.currentFillLevel === 'number' && !Number.isNaN(a.currentFillLevel) ? 1 : 0;
            const bValid = typeof b.currentFillLevel === 'number' && !Number.isNaN(b.currentFillLevel) ? 1 : 0;
            if (bValid !== aValid) return bValid - aValid;
            const aTs = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
            const bTs = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
            return bTs - aTs;
          })[0];
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
        name: key === 'ORGANIC' ? 'Thùng rác hữu cơ' : key === 'RECYCLABLE' ? 'Thùng rác tái chế' : 'Thùng rác không tái chế',
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

    const validBins = installedBins.filter((b) => computeBinViewModel(b, currentNow).isValidReading);
    const averageFillPct = validBins.length > 0
      ? Math.round(validBins.reduce((a, b) => a + (b.currentFillLevel as number), 0) / validBins.length)
      : null;

    let stationStatus: 'ONLINE' | 'WARNING' | 'OFFLINE' | 'MAINTENANCE' = (st.status as any) || 'OFFLINE';
    const anyOnlineBin = validBins.length > 0 || installedBins.some((b) => b.status === 'ONLINE' && b.currentFillLevel !== null);
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

