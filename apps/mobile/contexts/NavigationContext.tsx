import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { BackHandler } from 'react-native';

export type Screen =
  | 'dashboard'
  | 'bins'
  | 'bin-detail'
  | 'devices'
  | 'alerts'
  | 'collections';

export interface BinDetailParams {
  binId?: string;
  binCode?: string;
  binName?: string;
}

export interface NavigationRoute {
  screen: Screen;
  params?: BinDetailParams;
}

interface NavigationContextType {
  currentScreen: Screen;
  params?: BinDetailParams;
  navigate: (screen: Screen, params?: BinDetailParams) => void;
  goBack: () => void;
  canGoBack: boolean;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const NavigationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [history, setHistory] = useState<NavigationRoute[]>([{ screen: 'dashboard' }]);

  const currentRoute = history[history.length - 1] || { screen: 'dashboard' };
  const canGoBack = history.length > 1;

  const navigate = useCallback((screen: Screen, params?: BinDetailParams) => {
    setHistory((prev) => {
      // If navigating to bottom tabs (dashboard, bins, devices, alerts, collections without params), switch cleanly
      if (screen === 'dashboard') {
        return [{ screen: 'dashboard' }];
      }
      if (screen === 'bins') {
        if (prev[prev.length - 1]?.screen === 'bins') return prev;
        return [...prev.filter((r) => r.screen === 'dashboard'), { screen: 'bins' }];
      }
      if (screen === 'devices') {
        if (prev[prev.length - 1]?.screen === 'devices') return prev;
        return [...prev.filter((r) => r.screen === 'dashboard'), { screen: 'devices' }];
      }
      if (screen === 'alerts') {
        if (prev[prev.length - 1]?.screen === 'alerts') return prev;
        return [...prev.filter((r) => r.screen === 'dashboard'), { screen: 'alerts' }];
      }
      if (screen === 'collections' && !params) {
        if (prev[prev.length - 1]?.screen === 'collections' && !prev[prev.length - 1]?.params) return prev;
        return [...prev.filter((r) => r.screen === 'dashboard'), { screen: 'collections' }];
      }
      // For bin-detail or nested routes with params, push to stack
      return [...prev, { screen, params }];
    });
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length <= 1) {
        // If at bins, devices, alerts, or collections screen with no history, go to dashboard
        if (
          prev[0]?.screen === 'bins' ||
          prev[0]?.screen === 'devices' ||
          prev[0]?.screen === 'alerts' ||
          prev[0]?.screen === 'collections'
        ) {
          return [{ screen: 'dashboard' }];
        }
        return prev;
      }
      return prev.slice(0, prev.length - 1);
    });
  }, []);

  // Hardware Back button handling on Android
  useEffect(() => {
    const onHardwareBack = () => {
      if (history.length > 1) {
        goBack();
        return true; // handled
      }
      if (
        history[0]?.screen === 'bins' ||
        history[0]?.screen === 'devices' ||
        history[0]?.screen === 'alerts' ||
        history[0]?.screen === 'collections'
      ) {
        navigate('dashboard');
        return true;
      }
      return false; // let system handle (exit or minimize)
    };

    const backHandlerSubscription = BackHandler.addEventListener(
      'hardwareBackPress',
      onHardwareBack
    );

    return () => {
      backHandlerSubscription.remove();
    };
  }, [history, goBack, navigate]);

  return (
    <NavigationContext.Provider
      value={{
        currentScreen: currentRoute.screen,
        params: currentRoute.params,
        navigate,
        goBack,
        canGoBack,
      }}
    >
      {children}
    </NavigationContext.Provider>
  );
};

export function useNavigation(): NavigationContextType {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within a NavigationProvider');
  }
  return context;
}
