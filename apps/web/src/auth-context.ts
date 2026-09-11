import { createContext, useContext } from 'react';

export type RoleName = 'ADMIN' | 'SUPERVISOR' | 'WORKER';
export interface SessionUser { id: string; username: string; role: RoleName; }
export interface AuthContextValue { user: SessionUser | null; token: string | null; isLoading: boolean; login: (username: string, password: string) => Promise<void>; logout: () => void; }

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
