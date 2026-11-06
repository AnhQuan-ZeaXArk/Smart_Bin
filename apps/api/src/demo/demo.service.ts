import {
  DEMO_BINS,
  DEMO_DEVICES,
  DEMO_ALERTS,
  DEMO_SENSOR_READINGS,
  DEMO_COLLECTIONS,
  type DemoBin,
  type DemoDevice,
  type DemoAlert,
  type DemoSensorReading,
  type DemoCollectionRecord
} from './demo-data.js';
import { normalizeDeviceId, CANONICAL_DEVICE_ID } from '../config/device-id.config.js';
import { realDeviceService } from './real-device.service.js';
import { settingsService } from '../services/settings.service.js';
import { syncBinsWithRealDevice } from '../services/bin-sync.service.js';

export interface BinQueryFilters {
  search?: string;
  status?: string;
  fillCategory?: string;
}

export interface SensorReadingFilters {
  binCode?: string;
  from?: string;
  to?: string;
  fillMin?: number;
  fillMax?: number;
}

export class DemoService {
  getAllBins(filters?: BinQueryFilters): DemoBin[] {
    const realStatus = realDeviceService.getStatus();
    let result = syncBinsWithRealDevice(DEMO_BINS, realStatus) as DemoBin[];

    if (filters?.status) {
      result = result.filter((b) => b.status === filters.status);
    }

    if (filters?.fillCategory) {
      result = result.filter((b) => b.fillCategory === filters.fillCategory);
    }

    if (filters?.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (b) =>
          b.binCode.toLowerCase().includes(q) ||
          b.name.toLowerCase().includes(q) ||
          b.location.toLowerCase().includes(q)
      );
    }

    return result;
  }

  getBinById(idOrCode: string): DemoBin | null {
    const bins = this.getAllBins();
    const found = bins.find(
      (b) => b.id === idOrCode || b.binCode.toLowerCase() === idOrCode.toLowerCase()
    );
    return found ?? null;
  }

  getAllDevices(): DemoDevice[] {
    return [...DEMO_DEVICES];
  }

  getDeviceById(idOrDeviceId: string): DemoDevice | null {
    const normalizedTarget = normalizeDeviceId(idOrDeviceId);
    const found = DEMO_DEVICES.find(
      (d) =>
        d.id === idOrDeviceId ||
        d.deviceId === idOrDeviceId ||
        (normalizedTarget === CANONICAL_DEVICE_ID && d.deviceId === CANONICAL_DEVICE_ID)
    );
    return found ?? null;
  }

  getAllAlerts(): DemoAlert[] {
    return [...DEMO_ALERTS];
  }

  getSensorReadings(filters?: SensorReadingFilters): DemoSensorReading[] {
    let readings = [...DEMO_SENSOR_READINGS];

    if (filters?.binCode) {
      const code = filters.binCode.toUpperCase();
      readings = readings.filter((r) => r.bin.binCode === code);
    }

    if (filters?.from) {
      const fromTime = new Date(filters.from).getTime();
      readings = readings.filter((r) => new Date(r.timestamp).getTime() >= fromTime);
    }

    if (filters?.to) {
      const toTime = new Date(filters.to).getTime();
      readings = readings.filter((r) => new Date(r.timestamp).getTime() <= toTime);
    }

    if (filters?.fillMin !== undefined) {
      readings = readings.filter((r) => r.fillLevel >= filters.fillMin!);
    }

    if (filters?.fillMax !== undefined) {
      readings = readings.filter((r) => r.fillLevel <= filters.fillMax!);
    }

    return readings;
  }

  getCollections(): DemoCollectionRecord[] {
    return [...DEMO_COLLECTIONS];
  }

  getDashboardSummary() {
    const bins = this.getAllBins();
    const total = bins.length;
    const normal = bins.filter((b) => b.currentFillLevel !== null && b.fillCategory === 'NORMAL').length;
    const warning = bins.filter((b) => b.currentFillLevel !== null && ['MONITOR', 'NEARLY_FULL'].includes(b.fillCategory)).length;
    const full = bins.filter((b) => b.currentFillLevel !== null && b.fillCategory === 'CRITICAL').length;
    const offline = bins.filter((b) => b.status === 'OFFLINE' || b.currentFillLevel === null).length;

    return {
      summary: {
        total,
        normal,
        warning,
        full,
        offline
      },
      bins,
      recentSensorReadings: DEMO_SENSOR_READINGS.slice(0, 8),
      devices: this.getAllDevices(),
      alerts: this.getAllAlerts()
    };
  }
}

export const demoService = new DemoService();
