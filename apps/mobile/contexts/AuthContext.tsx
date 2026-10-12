import React, { createContext, useCallback, ReactNode } from 'react';
import { AuthContextType } from '../types/auth';

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const logout = useCallback(async () => {
    // Logout disabled in demo mode
  }, []);

  const login = useCallback(async () => {
    // Login disabled in demo mode
  }, []);

  const value: AuthContextType = {
    token: null,
    user: null,
    isLoading: false,
    isAuthenticated: true,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

