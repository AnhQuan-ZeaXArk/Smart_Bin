import { apiClient } from './api';
import { Bin, BinDetailData, BinFilters } from '../types/bin';
import { DashboardAlert, SensorReadingItem } from '../types/dashboard';

interface RawBinsResponse {
  bins: Bin[];
}

interface RawBinDetailResponse {
  bin: Bin;
}

interface RawSensorReadingsResponse {
  readings: SensorReadingItem[];
}

interface RawAlertsResponse {
  alerts: DashboardAlert[];
}

/**
 * SmartBin Mobile Bin Service
 * Interacts directly with existing backend APIs:
 * - GET /api/bins
 * - GET /api/bins/:id
 * - GET /api/dashboard/sensor-readings
 * - GET /api/dashboard/alerts
 */
export const binService = {
  /**
   * Fetch all active bins with optional query filters
   */
  async getBins(filters?: BinFilters): Promise<Bin[]> {
    const params = new URLSearchParams();
    if (filters?.status) {
      params.append('status', filters.status);
    }
    if (filters?.search) {
      params.append('search', filters.search);
    }
    if (filters?.fillCategory) {
      params.append('fillCategory', filters.fillCategory);
    }

    const queryString = params.toString();
    const endpoint = queryString ? `/api/bins?${queryString}` : '/api/bins';

    const response = await apiClient.get<RawBinsResponse>(endpoint);
    return response.bins || [];
  },

  /**
   * Fetch single bin configuration by ID
   */
  async getBinById(id: string): Promise<Bin> {
    const response = await apiClient.get<RawBinDetailResponse>(`/api/bins/${id}`);
    return response.bin;
  },

  /**
   * Fetch historical sensor readings for a compartment
   */
  async getSensorReadings(binCode?: string): Promise<SensorReadingItem[]> {
    const endpoint = binCode
      ? `/api/dashboard/sensor-readings?binCode=${encodeURIComponent(binCode)}`
      : '/api/dashboard/sensor-readings';

    const response = await apiClient.get<RawSensorReadingsResponse>(endpoint);
    return response.readings || [];
  },

  /**
   * Fetch alerts and optionally filter by binId or binCode
   */
  async getAlerts(binId?: string, binCode?: string): Promise<DashboardAlert[]> {
    const response = await apiClient.get<RawAlertsResponse>('/api/dashboard/alerts');
    const allAlerts = response.alerts || [];

    if (!binId && !binCode) {
      return allAlerts;
    }

    return allAlerts.filter((alert) => {
      if (binId && alert.binId === binId) return true;
      if (binCode && alert.bin?.binCode === binCode) return true;
      return false;
    });
  },

  /**
   * Fetch aggregated bin detail: bin entity, recent sensor readings, and relevant alerts
   */
  async getBinDetail(id: string, binCode?: string): Promise<BinDetailData> {
    const [binResult, readingsResult, alertsResult] = await Promise.allSettled([
      this.getBinById(id),
      binCode ? this.getSensorReadings(binCode) : Promise.resolve([]),
      this.getAlerts(id, binCode),
    ]);

    if (binResult.status === 'rejected') {
      throw binResult.reason;
    }

    const bin = binResult.value;
    const sensorReadings =
      readingsResult.status === 'fulfilled' ? readingsResult.value : [];
    const alerts =
      alertsResult.status === 'fulfilled' ? alertsResult.value : [];

    // If binCode was not known beforehand, query sensor readings now with resolved binCode
    let finalReadings = sensorReadings;
    if (finalReadings.length === 0 && bin.binCode) {
      try {
        finalReadings = await this.getSensorReadings(bin.binCode);
      } catch {
        // Keep empty if query fails
      }
    }

    // Attach latest ultrasonic distance if readings exist
    if (finalReadings.length > 0 && finalReadings[0].distance !== undefined) {
      bin.distanceCm = finalReadings[0].distance;
    }

    return {
      bin,
      sensorReadings: finalReadings,
      alerts,
      lastUpdated: new Date(),
    };
  },
};
