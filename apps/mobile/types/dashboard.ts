/**
 * SmartBin Mobile Dashboard Types
 * Matching API contracts from:
 * - GET /api/dashboard/summary
 * - GET /api/devices
 */

import { RoleName } from './auth';

export type FillCategory = 'NORMAL' | 'MONITOR' | 'NEARLY_FULL' | 'CRITICAL';
export type BinStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE';
export type DeviceType = 'RASPBERRY_PI' | 'ULTRASONIC_SENSOR' | 'CAMERA' | 'MQTT';
export type DeviceStatus = 'ONLINE' | 'WARNING' | 'OFFLINE';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface DashboardSummary {
  total: number;
  normal: number;
  warning: number;
  full: number;
  offline: number;
}

export interface DashboardBin {
  id: string;
  binCode: string;
  name: string;
  location: string;
  capacity: number;
  currentFillLevel: number;
  status: BinStatus;
  lastSeen: string | null;
  distanceCm: number | null;
  fillCategory: FillCategory;
}

export interface DashboardDevice {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  status: DeviceStatus;
  lastSeen: string;
  lastHeartbeat: string | null;
  uptime?: number | null;
  firmwareVersion?: string | null;
}

export interface DashboardAlert {
  id: string;
  binId?: string;
  type: string;
  severity: AlertSeverity;
  message: string;
  createdAt: string;
  isResolved?: boolean;
  bin?: {
    binCode: string;
    name?: string;
  } | null;
}

export interface SensorReadingItem {
  id: string;
  fillLevel: number;
  distance: number;
  timestamp: string;
  bin: {
    binCode: string;
    name: string;
  };
}

export interface DashboardData {
  summary: DashboardSummary;
  bins: DashboardBin[];
  devices: DashboardDevice[];
  alerts: DashboardAlert[];
  recentSensorReadings: SensorReadingItem[];
  lastUpdated: Date;
}
