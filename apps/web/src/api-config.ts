/**
 * SmartBin Web - API Configuration
 *
 * Single source of truth for backend URL resolution.
 * Automatically chooses https://smartbin-api-e08b.onrender.com when:
 * 1. Explicitly configured via VITE_API_URL
 * 2. Running in production mode (Vite build)
 * 3. Hosted on *.onrender.com
 * Falls back to http://localhost:4000 ONLY in local development mode.
 */
export function getApiUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // If running in production bundle or accessed via onrender.com domain, target live Render backend
  if (
    import.meta.env.PROD ||
    (typeof window !== 'undefined' && window.location.hostname.endsWith('onrender.com'))
  ) {
    return 'https://smartbin-api-e08b.onrender.com';
  }

  return 'http://localhost:4000';
}

export const apiUrl = getApiUrl();
