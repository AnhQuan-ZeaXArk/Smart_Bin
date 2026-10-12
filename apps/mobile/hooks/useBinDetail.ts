import { useState, useEffect, useCallback, useRef } from 'react';
import { binService } from '../services/bin.service';
import { BinDetailData } from '../types/bin';

interface UseBinDetailResult {
  data: BinDetailData | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  errorStatus: number | null;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useBinDetail(binId: string, binCode?: string): UseBinDetailResult {
  const [data, setData] = useState<BinDetailData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchDetail = useCallback(
    async (isRefreshAction = false) => {
      if (!binId) return;

      if (isRefreshAction) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);
      setErrorStatus(null);

      try {
        const detail = await binService.getBinDetail(binId, binCode);
        if (isMountedRef.current) {
          setData(detail);
        }
      } catch (err: unknown) {
        if (isMountedRef.current) {
          const apiError = err as { message?: string; statusCode?: number };
          setError(apiError.message || 'Không thể tải thông tin thùng rác.');
          setErrorStatus(apiError.statusCode ?? null);
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [binId, binCode]
  );

  useEffect(() => {
    fetchDetail(false);
  }, [fetchDetail]);

  const refresh = useCallback(async () => {
    await fetchDetail(true);
  }, [fetchDetail]);

  const reload = useCallback(async () => {
    await fetchDetail(false);
  }, [fetchDetail]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    errorStatus,
    refresh,
    reload,
  };
}
