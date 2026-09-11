import type { FillCategory } from './bins';

export type WasteCategoryKey = 'ORGANIC' | 'RECYCLABLE' | 'NON_RECYCLABLE';

export const WASTE_CATEGORY_ORDER: WasteCategoryKey[] = ['ORGANIC', 'RECYCLABLE', 'NON_RECYCLABLE'];

export const WASTE_CATEGORY_LABEL: Record<WasteCategoryKey, string> = {
  ORGANIC: 'Rác hữu cơ',
  RECYCLABLE: 'Rác tái chế',
  NON_RECYCLABLE: 'Rác không tái chế'
};

// Thứ tự kiểm tra quan trọng: "không tái chế" phải được thử trước "tái chế" vì chuỗi này chứa từ khóa của cả hai.
const WASTE_CATEGORY_KEYWORDS: Partial<Record<WasteCategoryKey, RegExp>> = {
  NON_RECYCLABLE: /khong[\s-]?tai[\s-]?che|không tái chế|non[\s-]?recycl/i,
  ORGANIC: /huu[\s-]?co|hữu cơ|organic/i,
  RECYCLABLE: /tai[\s-]?che|tái chế|recycl/i
};
const WASTE_MATCH_ORDER: WasteCategoryKey[] = ['NON_RECYCLABLE', 'ORGANIC', 'RECYCLABLE'];

/**
 * Model Bin hiện tại chưa có field phân loại rác theo enum riêng, nên hệ thống suy luận từ mã/ngăn
 * và tên hiển thị để gán đúng ba loại rác của SmartBin: hữu cơ, tái chế, không tái chế.
 * Nếu không khớp từ khóa nào, hệ thống sẽ gán phần còn lại theo thứ tự logic để đảm bảo Dashboard
 * luôn có đủ 3 ngăn hiển thị đúng với mô hình hệ thống.
 */
export function assignWasteCategories<T extends { binCode: string; name: string }>(bins: T[]): Partial<Record<WasteCategoryKey, T>> {
  const sorted = [...bins].sort((a, b) => a.binCode.localeCompare(b.binCode));
  const result: Partial<Record<WasteCategoryKey, T>> = {};
  const remaining: T[] = [];
  for (const bin of sorted) {
    const haystack = `${bin.binCode} ${bin.name}`;
    const matched = WASTE_MATCH_ORDER.find((key) => !result[key] && WASTE_CATEGORY_KEYWORDS[key]!.test(haystack));
    if (matched) result[matched] = bin; else remaining.push(bin);
  }
  for (const key of WASTE_CATEGORY_ORDER) {
    if (!result[key] && remaining.length > 0) result[key] = remaining.shift();
  }
  return result;
}

export interface Compartment<T> { key: WasteCategoryKey; label: string; bin: T | undefined; }

/**
 * Điểm truy cập DUY NHẤT để mọi trang (Dashboard, Thùng rác, Lịch sử cảm biến) suy ra 3 ngăn
 * của hệ thống SmartBin từ cùng một danh sách Bin — đảm bảo tính nhất quán giữa các trang.
 */
export function getCompartments<T extends { binCode: string; name: string }>(bins: T[]): Compartment<T>[] {
  const assigned = assignWasteCategories(bins);
  return WASTE_CATEGORY_ORDER.map((key) => ({ key, label: WASTE_CATEGORY_LABEL[key], bin: assigned[key] }));
}

export type DashboardStatusKey = 'NORMAL' | 'NEARLY_FULL' | 'WARNING' | 'NEEDS_COLLECTION';
export const DASHBOARD_STATUS_LABEL: Record<DashboardStatusKey, string> = {
  NORMAL: 'Bình thường',
  NEARLY_FULL: 'Gần đầy',
  WARNING: 'Cảnh báo',
  NEEDS_COLLECTION: 'Cần thu gom'
};

// Tái sử dụng CSS tone màu đã có sẵn (fill-normal/monitor/nearly_full/critical) để tránh thêm bảng màu mới.
export const DASHBOARD_STATUS_TONE: Record<DashboardStatusKey, string> = {
  NORMAL: 'normal',
  NEARLY_FULL: 'monitor',
  WARNING: 'nearly_full',
  NEEDS_COLLECTION: 'critical'
};

/**
 * Ánh xạ fillCategory hiện có của backend (xem apps/api/src/routes/bin.routes.ts::getFillCategory)
 * sang 4 nhãn hiển thị theo yêu cầu Dashboard. KHÔNG thay đổi ngưỡng/threshold gốc ở backend.
 */
export function dashboardStatusFromFillCategory(category: FillCategory): DashboardStatusKey {
  switch (category) {
    case 'NORMAL': return 'NORMAL';
    case 'MONITOR': return 'NEARLY_FULL';
    case 'NEARLY_FULL': return 'WARNING';
    case 'CRITICAL': return 'NEEDS_COLLECTION';
    default: return 'NORMAL';
  }
}
