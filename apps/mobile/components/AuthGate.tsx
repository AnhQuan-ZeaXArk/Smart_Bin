import React from 'react';
import { MainNavigator } from './MainNavigator';
import { NavigationProvider } from '../contexts/NavigationContext';

export const AuthGate: React.FC = () => {
  return (
    <NavigationProvider>
      <MainNavigator />
    </NavigationProvider>
  );
};

