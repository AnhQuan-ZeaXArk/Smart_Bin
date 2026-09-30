import { useState, useEffect, useCallback, useRef } from 'react';
import { binService } from '../services/bin.service';
import { Bin, BinFilters } from '../types/bin';

interface UseBinsResult {
  bins: Bin[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  filters: BinFilters;
  setFilters: (filters: BinFilters | ((prev: BinFilters) => BinFilters)) => void;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useBins(initialFilters?: BinFilters): UseBinsResult {
  const [bins, setBins] = useState<Bin[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BinFilters>(initialFilters || {});

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchBins = useCallback(
    async (isRefreshAction = false) => {
      if (isRefreshAction) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const fetchedBins = await binService.getBins(filters);
        if (isMountedRef.current) {
          setBins(fetchedBins);
        }
      } catch (err: unknown) {
        if (isMountedRef.current) {
          const apiError = err as { message?: string };
          setError(apiError.message || 'Không thể tải danh sách thùng rác.');
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [filters]
  );

  useEffect(() => {
    fetchBins(false);
  }, [fetchBins]);

  const refresh = useCallback(async () => {
    await fetchBins(true);
  }, [fetchBins]);

  const reload = useCallback(async () => {
    await fetchBins(false);
  }, [fetchBins]);

  return {
    bins,
    isLoading,
    isRefreshing,
    error,
    filters,
    setFilters,
    refresh,
    reload,
  };
}
