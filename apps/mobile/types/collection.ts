/**
 * SmartBin Mobile Collection Types
 * Matching API models from:
 * - GET /api/collections
 * - prisma/schema.prisma (CollectionRecord, CollectionStatus)
 */

export type CollectionStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED';

export interface CollectionBinInfo {
  binCode: string;
  name: string;
}

export interface CollectionRecord {
  id: string;
  binId: string;
  collectedBy: string | null;
  collectedAt: string;
  fillLevelBefore: number;
  fillLevelAfter: number | null;
  status: CollectionStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  bin: CollectionBinInfo;
}

export interface RawCollectionsResponse {
  collections: CollectionRecord[];
}

export interface CollectionFilters {
  status?: CollectionStatus | 'ALL';
  binCode?: string;
  search?: string;
}

export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, string> = {
  COMPLETED: 'Hoàn thành',
  IN_PROGRESS: 'Đang xử lý',
  PENDING: 'Chờ thu gom',
  CANCELLED: 'Đã hủy',
};

export const COLLECTION_STATUS_COLORS: Record<
  CollectionStatus,
  { bg: string; text: string; border: string }
> = {
  COMPLETED: {
    bg: '#ecfdf5',
    text: '#059669',
    border: '#a7f3d0',
  },
  IN_PROGRESS: {
    bg: '#eff6ff',
    text: '#2563eb',
    border: '#bfdbfe',
  },
  PENDING: {
    bg: '#fffbeb',
    text: '#d97706',
    border: '#fde68a',
  },
  CANCELLED: {
    bg: '#fef2f2',
    text: '#dc2626',
    border: '#fecaca',
  },
};
