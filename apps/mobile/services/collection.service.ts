import { apiClient } from './api';
import { CollectionRecord, RawCollectionsResponse } from '../types/collection';

/**
 * SmartBin Mobile Collection Service
 * Interacts directly with existing backend API:
 * - GET /api/collections
 */
export const collectionService = {
  /**
   * Fetch all collection history records from backend
   * Backend returns up to 200 records sorted newest to oldest
   */
  async getCollections(): Promise<CollectionRecord[]> {
    const response = await apiClient.get<RawCollectionsResponse>('/api/collections');
    return response.collections || [];
  },
};
