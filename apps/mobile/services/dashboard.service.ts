import { apiClient } from './api';
import {
  DashboardData,
  DashboardDevice,
  DashboardSummary,
  DashboardBin,
  DashboardAlert,
  SensorReadingItem,
} from '../types/dashboard';

interface RawSummaryResponse {
  summary: DashboardSummary;
  bins: DashboardBin[];
  devices?: DashboardDevice[];
  alerts?: DashboardAlert[];
  recentSensorReadings?: SensorReadingItem[];
}

interface RawDevicesResponse {
  devices: DashboardDevice[];
}

/**
 * Mobile Dashboard Service
 * Fetches aggregated summary and device health data from backend API
 */
export const dashboardService = {
  /**
   * Fetch full dashboard dataset combining summary metrics and dynamic device health
   */
  async getDashboardData(): Promise<DashboardData> {
    // Perform parallel fetch for dashboard summary and live device health
    const [summaryResult, devicesResult] = await Promise.allSettled([
      apiClient.get<RawSummaryResponse>('/api/dashboard/summary'),
      apiClient.get<RawDevicesResponse>('/api/devices'),
    ]);

    if (summaryResult.status === 'rejected') {
      throw summaryResult.reason;
    }

    const summaryData = summaryResult.value;

    // Use devices from /api/devices if available, fallback to devices from summary
    let devices: DashboardDevice[] = [];
    if (devicesResult.status === 'fulfilled' && devicesResult.value.devices) {
      devices = devicesResult.value.devices;
    } else if (summaryData.devices) {
      devices = summaryData.devices;
    }

    return {
      summary: summaryData.summary || {
        total: 0,
        normal: 0,
        warning: 0,
        full: 0,
        offline: 0,
      },
      bins: summaryData.bins || [],
      devices,
      alerts: summaryData.alerts || [],
      recentSensorReadings: summaryData.recentSensorReadings || [],
      lastUpdated: new Date(),
    };
  },
};
