/**
 * SmartBin Mobile Bin Types
 * Matching API models from:
 * - apps/api/src/routes/bin.routes.ts
 * - prisma/schema.prisma (Bin, SensorReading, Alert)
 */

import { BinStatus, FillCategory, DashboardAlert, SensorReadingItem } from './dashboard';

export type WasteCompartmentKey = 'ORGANIC' | 'RECYCLABLE' | 'NON_RECYCLABLE';

export interface Bin {
  id: string;
  binCode: string;
  name: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  capacity: number;
  currentFillLevel: number;
  fillCategory: FillCategory;
  status: BinStatus;
  isActive: boolean;
  lastSeen: string | null;
  distanceCm?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface BinDetailData {
  bin: Bin;
  sensorReadings: SensorReadingItem[];
  alerts: DashboardAlert[];
  lastUpdated: Date;
}

export interface BinFilters {
  status?: BinStatus;
  search?: string;
  fillCategory?: FillCategory;
}
