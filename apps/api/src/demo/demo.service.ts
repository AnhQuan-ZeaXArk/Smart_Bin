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
    const activeLidAlert = realDeviceService.getActiveLidAlertRecord();
    if (activeLidAlert) {
      const hasLidAlert = DEMO_ALERTS.some(
        (a) => a.id === activeLidAlert.id || (a.message === activeLidAlert.message && !a.isResolved)
      );
      if (!hasLidAlert) {
        return [activeLidAlert as unknown as DemoAlert, ...DEMO_ALERTS];
      }
    }
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

  recordCollectionSession(stationCodeInput: string = 'STATION_A', collectedBy: string = 'WEB_DASHBOARD') {
    const isStationB =
      stationCodeInput.trim().toUpperCase() === 'STATION_B' ||
      stationCodeInput.trim().toLowerCase() === 'station_b';
    const targetCode = isStationB ? 'STATION_B' : 'STATION_A';
    const stationId = isStationB ? 'station_b' : 'station_a';
    const stationName = isStationB ? 'Trạm B' : 'Trạm A';

    const stationBins = DEMO_BINS.filter((b) => {
      const code = (b as any).stationCode || (b as any).station?.code || 'STATION_A';
      return code === targetCode;
    });

    const binsToUse = stationBins.length > 0 ? stationBins : DEMO_BINS;

    const compartments = binsToUse.map((b) => ({
      binId: b.id,
      binCode: b.binCode,
      name: b.name,
      fillLevelBefore: b.currentFillLevel,
      fillLevelAfter: 0
    }));

    const validLevels = compartments
      .map((c) => c.fillLevelBefore)
      .filter((lvl): lvl is number => lvl !== null);
    const fillBefore =
      validLevels.length > 0
        ? Math.round(validLevels.reduce((a, b) => a + b, 0) / validLevels.length)
        : null;

    // Reset demo bins to 0
    for (const b of binsToUse) {
      b.currentFillLevel = 0;
      b.fillCategory = 'NORMAL';
      b.status = 'ONLINE';
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const sessionId = `col-demo-${Date.now()}`;
    const newRecord: any = {
      id: sessionId,
      sessionId,
      binId: binsToUse[0]?.id ?? 'bin-demo',
      collectedBy,
      collectedAt: nowIso,
      openedAt: nowIso,
      closedAt: nowIso,
      fillLevelBefore: fillBefore,
      fillLevelAfter: 0,
      status: 'COMPLETED',
      notes: JSON.stringify({
        type: 'COLLECTION_SESSION',
        sessionId,
        stationId,
        stationCode: targetCode,
        stationName,
        triggerSource: 'WEB_DASHBOARD',
        openEventId: `evt-open-${Date.now()}`,
        closeEventId: `evt-close-${Date.now()}`,
        openedAt: nowIso,
        closedAt: nowIso,
        fillLevelBefore: fillBefore,
        fillLevelAfter: 0,
        compartmentsCount: compartments.length || 3,
        compartments,
        createdAt: nowIso
      }),
      stationId,
      stationCode: targetCode,
      stationName,
      triggerSource: 'WEB_DASHBOARD',
      compartmentsCount: compartments.length || 3,
      compartments,
      createdAt: nowIso,
      bin: {
        binCode: binsToUse[0]?.binCode ?? 'RECYCLABLE',
        name: binsToUse[0]?.name ?? 'Rác tái chế',
        station: { code: targetCode, name: stationName }
      }
    };

    DEMO_COLLECTIONS.unshift(newRecord);
    return { session: newRecord };
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
