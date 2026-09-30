import { apiClient } from './api';
import { storageService } from './storage.service';
import { LoginRequest, LoginResponse, MeResponse, User } from '../types/auth';

/**
 * Mobile Authentication Service
 * Communicates with backend endpoints:
 * - POST /api/auth/login
 * - GET  /api/auth/me
 */
export const authService = {
  /**
   * Authenticate with username and password
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    const payload: LoginRequest = { username: username.trim(), password };
    const response = await apiClient.post<LoginResponse>('/api/auth/login', payload);

    if (!response.token || !response.user) {
      throw new Error('Dữ liệu phản hồi xác thực không hợp lệ từ máy chủ.');
    }

    // Configure client token for subsequent requests
    apiClient.setToken(response.token);

    // Save token and user info to SecureStore
    await storageService.saveToken(response.token);
    await storageService.saveUser(JSON.stringify(response.user));

    return response;
  },

  /**
   * Fetch current user profile using active token
   */
  async getCurrentUser(token?: string): Promise<User> {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
    const response = await apiClient.get<MeResponse>('/api/auth/me', { headers });

    const user: User = {
      id: response.id,
      username: response.username,
      displayName: response.displayName ?? response.username,
      role: response.role,
    };

    // Update stored user cache
    await storageService.saveUser(JSON.stringify(user));

    return user;
  },

  /**
   * Log out and wipe secure token and session state
   */
  async logout(): Promise<void> {
    apiClient.setToken(null);
    await storageService.clearAll();
  },

  /**
   * Read stored JWT token
   */
  async getStoredToken(): Promise<string | null> {
    return storageService.getToken();
  },

  /**
   * Read stored user profile
   */
  async getStoredUser(): Promise<User | null> {
    const userStr = await storageService.getUser();
    if (!userStr) return null;
    try {
      return JSON.parse(userStr) as User;
    } catch {
      return null;
    }
  },

  /**
   * Persist token directly
   */
  async saveToken(token: string): Promise<void> {
    apiClient.setToken(token);
    await storageService.saveToken(token);
  },

  /**
   * Remove token directly
   */
  async clearToken(): Promise<void> {
    apiClient.setToken(null);
    await storageService.clearToken();
  },
};
