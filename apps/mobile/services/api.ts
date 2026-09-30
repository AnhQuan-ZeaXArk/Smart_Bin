import { Config } from '../constants/config';
import { ApiClientOptions } from '../types/api';

/**
 * Custom error class for SmartBin API errors with localized messages
 */
export class ApiError extends Error {
  statusCode?: number;
  originalError?: unknown;

  constructor(message: string, statusCode?: number, originalError?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

/**
 * Reusable HTTP client for SmartBin Mobile
 * Supports Authorization Bearer token, timeout handling, and automatic 401 handling.
 */
class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private onUnauthorizedCallback: (() => void) | null = null;

  constructor() {
    this.baseUrl = Config.apiUrl;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setToken(token: string | null): void {
    this.token = token;
  }

  public getToken(): string | null {
    return this.token;
  }

  public onUnauthorized(callback: () => void): void {
    this.onUnauthorizedCallback = callback;
  }

  public async get<T>(endpoint: string, options?: ApiClientOptions): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, options);
  }

  public async post<T>(endpoint: string, body?: unknown, options?: ApiClientOptions): Promise<T> {
    return this.request<T>('POST', endpoint, body, options);
  }

  public async put<T>(endpoint: string, body?: unknown, options?: ApiClientOptions): Promise<T> {
    return this.request<T>('PUT', endpoint, body, options);
  }

  public async patch<T>(endpoint: string, body?: unknown, options?: ApiClientOptions): Promise<T> {
    return this.request<T>('PATCH', endpoint, body, options);
  }

  public async delete<T>(endpoint: string, options?: ApiClientOptions): Promise<T> {
    return this.request<T>('DELETE', endpoint, undefined, options);
  }

  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    options?: ApiClientOptions
  ): Promise<T> {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${cleanEndpoint}`;
    const timeoutMs = options?.timeoutMs ?? Config.requestTimeoutMs;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      };

      // Automatically attach Bearer token if available and not overridden
      if (this.token && !headers.Authorization) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // If 401 Unauthorized occurs on a protected endpoint (not login), notify auth layer
        if (response.status === 401 && !cleanEndpoint.includes('/auth/login')) {
          if (this.onUnauthorizedCallback) {
            this.onUnauthorizedCallback();
          }
        }

        let errorDetail = '';
        try {
          const errorJson = await response.json();
          errorDetail = errorJson.message || errorJson.error || '';
        } catch {
          // If response body is not JSON, ignore
        }

        let msg = errorDetail;
        if (!msg) {
          if (response.status === 401) {
            msg = 'Phiên làm việc đã hết hạn hoặc thông tin xác thực không hợp lệ.';
          } else if (response.status === 403) {
            msg = 'Bạn không có quyền thực hiện thao tác này.';
          } else if (response.status >= 500) {
            msg = 'Máy chủ SmartBin đang gặp sự cố. Vui lòng thử lại sau.';
          } else {
            msg = `Yêu cầu thất bại với mã lỗi HTTP ${response.status}`;
          }
        }

        throw new ApiError(msg, response.status);
      }

      return (await response.json()) as T;
    } catch (err: unknown) {
      clearTimeout(timeoutId);

      if (err instanceof ApiError) {
        throw err;
      }

      // Check abort / timeout
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ApiError(
          'Kết nối quá thời gian chờ (timeout). Máy chủ có thể đang khởi động lại trên Render.',
          408,
          err
        );
      }

      // Network unreachable
      throw new ApiError(
        'Không thể kết nối đến máy chủ SmartBin. Vui lòng kiểm tra kết nối mạng Internet của thiết bị.',
        0,
        err
      );
    }
  }
}

export const apiClient = new ApiClient();
