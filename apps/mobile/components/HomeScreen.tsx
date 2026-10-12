import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Colors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { useDashboard } from '../hooks/useDashboard';
import { useHealthCheck } from '../hooks/useHealthCheck';
import { useNavigation } from '../hooks/useNavigation';
import { useRealtimeStatus } from '../hooks/useRealtimeStatus';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { SummaryCards } from './dashboard/SummaryCards';
import { BinStatusBreakdown } from './dashboard/BinStatusBreakdown';
import { BinFillCard } from './dashboard/BinFillCard';
import { DeviceHealthCard } from './dashboard/DeviceHealthCard';
import { RecentAlertsCard } from './dashboard/RecentAlertsCard';
import { LoadingDashboard } from './dashboard/LoadingDashboard';
import { DashboardError } from './dashboard/DashboardError';
import { ConnectionCard } from './ConnectionCard';
import { Button } from './ui/kit';

export const HomeScreen: React.FC = () => {
  const { user, logout } = useAuth();
  const { navigate } = useNavigation();
  const { data, isLoading, isRefreshing, error, refresh, reload } = useDashboard();
  const realtimeStatus = useRealtimeStatus();

  // Reusable health check for direct API ping verification
  const {
    status: healthStatus,
    data: healthData,
    errorMessage: healthErrorMessage,
    lastCheckedAt: healthLastCheckedAt,
    latencyMs: healthLatencyMs,
    isLoading: healthIsLoading,
    checkConnection: healthCheckConnection,
  } = useHealthCheck(false);

  return (
    <View style={styles.container}>
      <DashboardHeader
        user={user}
        lastUpdated={data?.lastUpdated}
        onLogout={logout}
        onRefresh={refresh}
        isRefreshing={isRefreshing}
        realtimeStatus={realtimeStatus}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={refresh}
            tintColor={Colors.brandHighlight}
            colors={[Colors.brandHighlight]}
            progressBackgroundColor={Colors.surfaceCard}
          />
        }
      >
        {/* Loading State for initial fetch */}
        {isLoading && !data && <LoadingDashboard />}

        {/* Error State if fetch completely failed and no previous data */}
        {error && !data && (
          <DashboardError errorMessage={error} onRetry={reload} />
        )}

        {/* Dashboard Content */}
        {data && (
          <>
            {/* 1. High-level Summary Cards */}
            <SummaryCards
              summary={data.summary}
              bins={data.bins}
              devices={data.devices}
            />

            {/* 2. Compartment Fill Levels & Progress */}
            <BinFillCard
              bins={data.bins}
              onViewAllBins={() => navigate('bins')}
              onSelectBin={(bin) =>
                navigate('bin-detail', {
                  binId: bin.id,
                  binCode: bin.binCode,
                  binName: bin.name,
                })
              }
            />

            {/* 3. Status distribution chart */}
            <BinStatusBreakdown bins={data.bins} />

            {/* 4. IoT Devices Health Status */}
            <DeviceHealthCard
              devices={data.devices}
              onViewAllDevices={() => navigate('devices')}
            />

            {/* 5. Recent Alerts Preview */}
            <RecentAlertsCard
              alerts={data.alerts}
              onViewAllAlerts={() => navigate('alerts')}
            />

            {/* 6. Collection History Shortcut */}
            <Button
              label="Xem lịch sử thu gom"
              icon="history"
              variant="secondary"
              onPress={() => navigate('collections')}
              style={styles.collectionButton}
            />

            {/* 7. Live API Health Connection Check */}
            <ConnectionCard
              status={healthStatus}
              data={healthData}
              errorMessage={healthErrorMessage}
              lastCheckedAt={healthLastCheckedAt}
              latencyMs={healthLatencyMs}
              isLoading={healthIsLoading}
              onCheck={healthCheckConnection}
            />

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                SmartBin Management System • Operations Mobile v0.1.0
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
  },
  collectionButton: {
    marginBottom: 16,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  footerText: {
    color: Colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
});
