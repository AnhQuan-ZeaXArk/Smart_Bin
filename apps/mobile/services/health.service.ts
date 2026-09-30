import { apiClient } from './api';
import { HealthResponse } from '../types/api';

export interface HealthCheckResult {
  success: boolean;
  data: HealthResponse | null;
  latencyMs: number;
  message: string;
}

/**
 * Service for checking the health status of the SmartBin backend
 */
export const healthService = {
  /**
   * Calls GET /health on the configured backend API
   */
  async checkHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    try {
      const data = await apiClient.get<HealthResponse>('/health');
      const latencyMs = Date.now() - startTime;

      if (data && data.status === 'ok') {
        return {
          success: true,
          data,
          latencyMs,
          message: 'Backend đang hoạt động',
        };
      }

      return {
        success: false,
        data,
        latencyMs,
        message: 'Trạng thái backend không hợp lệ',
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Không thể kết nối đến máy chủ SmartBin';

      return {
        success: false,
        data: null,
        latencyMs,
        message: errorMessage,
      };
    }
  },
};
