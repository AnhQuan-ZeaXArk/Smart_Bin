import { useState, useCallback, useEffect } from 'react';
import { healthService } from '../services/health.service';
import { HealthCheckState } from '../types/api';

/**
 * Hook for managing backend health check state and actions
 */
export function useHealthCheck(autoCheckOnMount = true) {
  const [state, setState] = useState<HealthCheckState>({
    status: 'idle',
    data: null,
    errorMessage: null,
    lastCheckedAt: null,
    latencyMs: null,
  });

  const checkConnection = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      status: 'checking',
      errorMessage: null,
    }));

    const result = await healthService.checkHealth();

    if (result.success && result.data) {
      setState({
        status: 'connected',
        data: result.data,
        errorMessage: null,
        lastCheckedAt: new Date(),
        latencyMs: result.latencyMs,
      });
    } else {
      setState({
        status: 'error',
        data: null,
        errorMessage: result.message,
        lastCheckedAt: new Date(),
        latencyMs: result.latencyMs,
      });
    }
  }, []);

  useEffect(() => {
    if (autoCheckOnMount) {
      checkConnection();
    }
  }, [autoCheckOnMount, checkConnection]);

  return {
    ...state,
    checkConnection,
    isLoading: state.status === 'checking',
    isConnected: state.status === 'connected',
    isError: state.status === 'error',
  };
}
