import * as SecureStore from 'expo-secure-store';

/**
 * Storage Service using Expo SecureStore for encrypted token persistence.
 * Keys are kept secure and encrypted on native devices (Android Keystore / iOS Keychain).
 */
const TOKEN_KEY = 'smartbin_jwt_token';
const USER_KEY = 'smartbin_auth_user';

export const storageService = {
  /**
   * Save JWT access token to encrypted SecureStore
   */
  async saveToken(token: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch (error) {
      console.error('Không thể lưu mã xác thực an toàn:', error);
      throw new Error('Lỗi bảo mật khi lưu phiên làm việc');
    }
  },

  /**
   * Retrieve JWT access token from SecureStore
   */
  async getToken(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(TOKEN_KEY);
    } catch (error) {
      console.error('Không thể đọc mã xác thực an toàn:', error);
      return null;
    }
  },

  /**
   * Remove JWT access token from SecureStore
   */
  async clearToken(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch (error) {
      console.error('Không thể xóa mã xác thực an toàn:', error);
    }
  },

  /**
   * Save user session metadata to SecureStore
   */
  async saveUser(userJson: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(USER_KEY, userJson);
    } catch (error) {
      console.error('Không thể lưu thông tin người dùng:', error);
    }
  },

  /**
   * Retrieve cached user metadata from SecureStore
   */
  async getUser(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(USER_KEY);
    } catch (error) {
      console.error('Không thể đọc thông tin người dùng:', error);
      return null;
    }
  },

  /**
   * Clear all session data from SecureStore
   */
  async clearAll(): Promise<void> {
    await this.clearToken();
    try {
      await SecureStore.deleteItemAsync(USER_KEY);
    } catch (error) {
      console.error('Không thể xóa dữ liệu người dùng:', error);
    }
  },
};
