/**
 * SmartBin Mobile API Types
 */

export interface HealthResponse {
  status: 'ok' | string;
  service?: string;
  [key: string]: unknown;
}

export type ConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

export interface HealthCheckState {
  status: ConnectionStatus;
  data: HealthResponse | null;
  errorMessage: string | null;
  lastCheckedAt: Date | null;
  latencyMs: number | null;
}

export interface ApiClientOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
}
