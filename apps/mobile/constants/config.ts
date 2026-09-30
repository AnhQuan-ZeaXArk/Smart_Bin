/**
 * SmartBin Mobile - Application Configuration
 *
 * Reads public Expo environment variables.
 * Fallback points to the single source of truth production API.
 */
const DEFAULT_API_URL = 'https://smartbin-api-e08b.onrender.com';

export const Config = {
  appName: 'SMARTBIN OPERATIONS',
  appSubtitle: 'Hệ Thống Quản Lý Thùng Rác Thông Minh',
  version: '0.1.0',
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, ''),
  requestTimeoutMs: 15000,
};
