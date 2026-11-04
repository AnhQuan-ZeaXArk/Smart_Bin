import { createContext, useContext } from 'react';

export type RoleName = 'ADMIN' | 'SUPERVISOR' | 'WORKER';
export type SystemMode = 'demo' | 'production' | 'unknown';

export interface SessionUser {
  id: string;
  username: string;
  displayName?: string | null;
  role: RoleName;
}

export interface AuthContextValue {
  user: SessionUser | null;
  token: string | null;
  isLoading: boolean;
  systemMode: SystemMode;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  retryHealthCheck: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
