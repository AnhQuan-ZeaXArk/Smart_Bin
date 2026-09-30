import { useState, useEffect, useCallback } from 'react';
import { dashboardService } from '../services/dashboard.service';
import { DashboardData } from '../types/dashboard';

/**
 * Custom hook for loading and refreshing SmartBin Dashboard data
 */
export function useDashboard(autoFetch = true) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const result = await dashboardService.getDashboardData();
      setData(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải dữ liệu Dashboard.';
      setError(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const refresh = useCallback(() => {
    return loadData(true);
  }, [loadData]);

  useEffect(() => {
    if (autoFetch) {
      loadData(false);
    }
  }, [autoFetch, loadData]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refresh,
    reload: () => loadData(false),
  };
}
