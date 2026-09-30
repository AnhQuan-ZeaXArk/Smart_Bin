import { apiClient } from './api';
import { AlertItem } from '../types/alert';

interface RawAlertsResponse {
  alerts: AlertItem[];
}

/**
 * SmartBin Mobile Alert Service
 * Interacts directly with existing backend APIs:
 * - GET /api/dashboard/alerts
 */
export const alertService = {
  /**
   * Fetch recent active/system alerts from backend
   */
  async getAlerts(): Promise<AlertItem[]> {
    const response = await apiClient.get<RawAlertsResponse>('/api/dashboard/alerts');
    return response.alerts || [];
  },
};
