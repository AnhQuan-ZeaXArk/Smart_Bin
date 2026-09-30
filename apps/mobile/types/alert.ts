/**
 * SmartBin Mobile Alert Types
 * Matching API models from:
 * - GET /api/dashboard/alerts
 * - prisma/schema.prisma (Alert, AlertType, AlertSeverity)
 * - apps/api/src/integrations/realtime/realtime.contract.ts
 */

export type AlertType =
  | 'NEARLY_FULL'
  | 'CRITICAL'
  | 'DEVICE_OFFLINE'
  | 'SENSOR_ABNORMAL';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AlertItem {
  id: string;
  type: AlertType | string;
  severity: AlertSeverity;
  message: string;
  binId?: string | null;
  deviceId?: string | null;
  isResolved: boolean;
  resolvedAt?: string | null;
  createdAt: string;
  bin?: {
    binCode: string;
    name?: string;
  } | null;
}

export type RealtimeConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

export interface AlertFilters {
  severity?: AlertSeverity | 'ALL';
  isResolved?: boolean | 'ALL';
  search?: string;
}

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  INFO: 'Thông tin',
  WARNING: 'Cảnh báo',
  CRITICAL: 'Nguy cấp',
};

export const ALERT_TYPE_LABELS: Record<string, string> = {
  NEARLY_FULL: 'Thùng rác gần đầy',
  CRITICAL: 'Mức đầy nguy hiểm',
  DEVICE_OFFLINE: 'Mất kết nối thiết bị',
  SENSOR_ABNORMAL: 'Cảm biến bất thường',
};
