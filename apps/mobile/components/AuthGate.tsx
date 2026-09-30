import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Colors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { LoginScreen } from './LoginScreen';
import { MainNavigator } from './MainNavigator';
import { NavigationProvider } from '../contexts/NavigationContext';

export const AuthGate: React.FC = () => {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>SMARTBIN</Text>
        </View>
        <ActivityIndicator size="large" color={Colors.brandHighlight} style={styles.spinner} />
        <Text style={styles.loadingTitle}>KHỞI TẠO PHIÊN LÀM VIỆC</Text>
        <Text style={styles.loadingSub}>Đang xác thực bảo mật qua SecureStore...</Text>
      </View>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <NavigationProvider>
      <MainNavigator />
    </NavigationProvider>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  badge: {
    backgroundColor: Colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 20,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  spinner: {
    marginVertical: 16,
  },
  loadingTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginTop: 8,
  },
  loadingSub: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 6,
  },
});
