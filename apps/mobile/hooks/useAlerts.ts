import { useState, useEffect, useCallback, useRef } from 'react';
import { alertService } from '../services/alert.service';
import { socketService } from '../services/socket.service';
import { AlertItem, RealtimeConnectionStatus } from '../types/alert';

interface UseAlertsResult {
  alerts: AlertItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  connectionStatus: RealtimeConnectionStatus;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useAlerts(): UseAlertsResult {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<RealtimeConnectionStatus>(
    socketService.getStatus()
  );

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // REST API fetch for initial and refresh states
  const fetchAlerts = useCallback(async (isRefreshAction = false) => {
    if (isRefreshAction) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await alertService.getAlerts();
      if (isMountedRef.current) {
        setAlerts(data);
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const apiError = err as { message?: string };
        setError(apiError.message || 'Không thể tải thông báo.');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  // Initial REST fetch
  useEffect(() => {
    fetchAlerts(false);
  }, [fetchAlerts]);

  const refresh = useCallback(async () => {
    await fetchAlerts(true);
  }, [fetchAlerts]);

  const reload = useCallback(async () => {
    await fetchAlerts(false);
  }, [fetchAlerts]);

  // Connect and subscribe to Socket.IO realtime events
  useEffect(() => {
    // Ensure socket is connected
    socketService.connect();

    // 1. Connection status listener
    const unsubStatus = socketService.onStatusChange((status) => {
      if (isMountedRef.current) {
        setConnectionStatus(status);
      }
    });

    // 2. Realtime new alert listener
    const unsubAlert = socketService.onAlertCreated((newAlert) => {
      if (!isMountedRef.current) return;
      setAlerts((prev) => {
        // Prevent duplicate alerts
        if (prev.some((a) => a.id === newAlert.id)) {
          return prev;
        }
        // Prepend new alert to top of the list
        return [newAlert, ...prev];
      });
    });

    // 3. Realtime alert resolved listener
    const unsubResolved = socketService.onAlertResolved((resolved) => {
      if (!isMountedRef.current) return;
      setAlerts((prev) =>
        prev.map((a) => {
          if (
            (resolved.id && a.id === resolved.id) ||
            (resolved.alertId && a.id === resolved.alertId) ||
            (resolved.deviceId && a.deviceId === resolved.deviceId && a.type === 'DEVICE_OFFLINE')
          ) {
            return { ...a, isResolved: true, resolvedAt: new Date().toISOString() };
          }
          return a;
        })
      );
    });

    // 4. Realtime alert updated listener
    const unsubUpdated = socketService.onAlertUpdated((updated) => {
      if (!isMountedRef.current) return;
      setAlerts((prev) =>
        prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
      );
    });

    return () => {
      unsubStatus();
      unsubAlert();
      unsubResolved();
      unsubUpdated();
    };
  }, []);

  return {
    alerts,
    isLoading,
    isRefreshing,
    error,
    connectionStatus,
    refresh,
    reload,
  };
}
