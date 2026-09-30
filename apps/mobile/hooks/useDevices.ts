import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { deviceService } from '../services/device.service';
import { DeviceItem, DeviceHealthSummary } from '../types/device';

interface UseDevicesResult {
  devices: DeviceItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  summary: DeviceHealthSummary;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useDevices(): UseDevicesResult {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchDevices = useCallback(async (isRefreshAction = false) => {
    if (isRefreshAction) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await deviceService.getDevices();
      if (isMountedRef.current) {
        setDevices(data);
        setLastUpdated(new Date());
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const apiError = err as { message?: string };
        setError(apiError.message || 'Không thể tải trạng thái thiết bị.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchDevices(false);
  }, [fetchDevices]);

  const refresh = useCallback(async () => {
    await fetchDevices(true);
  }, [fetchDevices]);

  const reload = useCallback(async () => {
    await fetchDevices(false);
  }, [fetchDevices]);

  const summary = useMemo<DeviceHealthSummary>(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.status === 'ONLINE').length;
    const warning = devices.filter((d) => d.status === 'WARNING').length;
    const offline = devices.filter((d) => d.status === 'OFFLINE').length;
    return { total, online, warning, offline };
  }, [devices]);

  return {
    devices,
    isLoading,
    isRefreshing,
    error,
    summary,
    lastUpdated,
    refresh,
    reload,
  };
}
