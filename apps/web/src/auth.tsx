import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext, type RoleName } from './auth-context';

export function AuthProvider({ children }: { children: ReactNode }) {
  async function login() {
    // In Demo mode, authentication is disabled
  }

  function logout() {
    // In Demo mode, logout is disabled
  }

  return (
    <AuthContext.Provider value={{ user: null, token: null, isLoading: false, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function LoginPage() {
  return <Navigate to="/dashboard" replace />;
}

export function ProtectedRoute({ children }: { children: ReactNode; roles?: RoleName[] }) {
  return <>{children}</>;
}

