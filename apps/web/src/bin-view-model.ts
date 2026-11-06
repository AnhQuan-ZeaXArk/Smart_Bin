import type { Bin, FillCategory, BinStatus } from './bins';
import { translateBinStatus, translateFillCategory } from './i18n-labels';
import { parseTimestamp, shouldDropIncoming, isRaspberryPiDevice } from './device-utils';

export interface BinViewModel {
  isValidReading: boolean;
  isOffline: boolean;
  isStale: boolean;
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

  // Nếu sự kiện dành cho thiết bị ngoại vi khác (Camera, MQTT), không thay đổi ngăn rác
  if (hb.deviceId && !isRaspberryPiDevice(hb.deviceId, hb.deviceType)) {
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

