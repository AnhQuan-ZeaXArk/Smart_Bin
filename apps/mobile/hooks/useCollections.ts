import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { collectionService } from '../services/collection.service';
import { CollectionRecord, CollectionFilters } from '../types/collection';

interface UseCollectionsResult {
  collections: CollectionRecord[];
  filteredCollections: CollectionRecord[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  filters: CollectionFilters;
  setFilters: (filters: CollectionFilters | ((prev: CollectionFilters) => CollectionFilters)) => void;
  refresh: () => Promise<void>;
  reload: () => Promise<void>;
}

export function useCollections(initialFilters?: CollectionFilters): UseCollectionsResult {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CollectionFilters>(initialFilters || {});

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchCollections = useCallback(
    async (isRefreshAction = false) => {
      if (isRefreshAction) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const data = await collectionService.getCollections();
        if (isMountedRef.current) {
          setCollections(data);
        }
      } catch (err: unknown) {
        if (isMountedRef.current) {
          const apiError = err as { message?: string };
          setError(apiError.message || 'Không thể tải lịch sử thu gom.');
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    fetchCollections(false);
  }, [fetchCollections]);

  const refresh = useCallback(async () => {
    await fetchCollections(true);
  }, [fetchCollections]);

  const reload = useCallback(async () => {
    await fetchCollections(false);
  }, [fetchCollections]);

  // Local filtering based on status, binCode, and search text
  const filteredCollections = useMemo(() => {
    return collections.filter((item) => {
      // 1. Status filter
      if (filters.status && filters.status !== 'ALL' && item.status !== filters.status) {
        return false;
      }

      // 2. Bin code filter
      if (filters.binCode && item.bin?.binCode !== filters.binCode) {
        return false;
      }

      // 3. Search query filter
      if (filters.search && filters.search.trim().length > 0) {
        const query = filters.search.toLowerCase().trim();
        const binCodeMatch = item.bin?.binCode?.toLowerCase().includes(query) ?? false;
        const binNameMatch = item.bin?.name?.toLowerCase().includes(query) ?? false;
        const collectorMatch = item.collectedBy?.toLowerCase().includes(query) ?? false;
        const notesMatch = item.notes?.toLowerCase().includes(query) ?? false;

        if (!binCodeMatch && !binNameMatch && !collectorMatch && !notesMatch) {
          return false;
        }
      }

      return true;
    });
  }, [collections, filters]);

  return {
    collections,
    filteredCollections,
    isLoading,
    isRefreshing,
    error,
    filters,
    setFilters,
    refresh,
    reload,
  };
}
