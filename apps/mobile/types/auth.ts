/**
 * SmartBin Mobile Authentication Types
 * Matching exact API contract from apps/api/src/routes/auth.routes.ts
 */

export type RoleName = 'ADMIN' | 'SUPERVISOR' | 'WORKER';

export interface User {
  id: string;
  username: string;
  displayName?: string;
  role: RoleName;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    username: string;
    role: RoleName;
  };
  message?: string;
}

export interface MeResponse {
  id: string;
  username: string;
  displayName?: string;
  role: RoleName;
  message?: string;
}

export interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}
