import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AuthContextType, User } from '../types/auth';
import { authService } from '../services/auth.service';
import { apiClient } from '../services/api';
import { socketService } from '../services/socket.service';

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const logout = useCallback(async () => {
    try {
      socketService.disconnect();
      await authService.logout();
    } catch {
      // Ignore cleanup errors on logout
    } finally {
      setToken(null);
      setUser(null);
    }
  }, []);

  // Listen for 401 Unauthorized from any API call to automatically log out
  useEffect(() => {
    apiClient.onUnauthorized(() => {
      logout();
    });
  }, [logout]);

  // Restore session on application startup
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        const storedToken = await authService.getStoredToken();
        if (!storedToken) {
          if (isMounted) setIsLoading(false);
          return;
        }

        // Set token in apiClient first
        apiClient.setToken(storedToken);

        // Verify token with backend GET /api/auth/me
        try {
          const currentUser = await authService.getCurrentUser(storedToken);
          if (isMounted) {
            setToken(storedToken);
            setUser(currentUser);
          }
        } catch {
          // If token verification fails (401 or invalid), clear session
          await authService.logout();
          if (isMounted) {
            setToken(null);
            setUser(null);
          }
        }
      } catch {
        if (isMounted) {
          setToken(null);
          setUser(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const response = await authService.login(username, password);
    setToken(response.token);
    setUser(response.user);
  }, []);

  const value: AuthContextType = {
    token,
    user,
    isLoading,
    isAuthenticated: Boolean(token && user),
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
