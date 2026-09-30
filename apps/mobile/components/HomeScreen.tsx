import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Colors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';
import { useDashboard } from '../hooks/useDashboard';
import { useHealthCheck } from '../hooks/useHealthCheck';
import { useNavigation } from '../hooks/useNavigation';
import { DashboardHeader } from './dashboard/DashboardHeader';
import { SummaryCards } from './dashboard/SummaryCards';
import { BinStatusBreakdown } from './dashboard/BinStatusBreakdown';
import { BinFillCard } from './dashboard/BinFillCard';
import { DeviceHealthCard } from './dashboard/DeviceHealthCard';
import { RecentAlertsCard } from './dashboard/RecentAlertsCard';
import { LoadingDashboard } from './dashboard/LoadingDashboard';
import { DashboardError } from './dashboard/DashboardError';
import { ConnectionCard } from './ConnectionCard';

export const HomeScreen: React.FC = () => {
  const { user, logout } = useAuth();
  const { navigate } = useNavigation();
  const { data, isLoading, isRefreshing, error, refresh, reload } = useDashboard();

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
              devices={data.devices}
              alerts={data.alerts}
            />

            {/* 2. Bin Status Breakdown */}
            <BinStatusBreakdown bins={data.bins} />

            {/* 3. Compartment Fill Levels & Progress */}
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

            {/* 6. Collection History Shortcut Card */}
            <View style={styles.collectionActionCard}>
              <View style={styles.collectionActionInfo}>
                <Text style={styles.collectionActionIcon}>📋</Text>
                <View style={styles.collectionActionTextContainer}>
                  <Text style={styles.collectionActionTitle}>
                    Lịch sử thu gom
                  </Text>
                  <Text style={styles.collectionActionSub}>
                    Xem nhật ký các lần thu gom rác thực tế
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.collectionActionButton}
                activeOpacity={0.8}
                onPress={() => navigate('collections')}
              >
                <Text style={styles.collectionActionText}>Xem lịch sử thu gom →</Text>
              </TouchableOpacity>
            </View>

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
  collectionActionCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 16,
  },
  collectionActionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  collectionActionIcon: {
    fontSize: 22,
  },
  collectionActionTextContainer: {
    flex: 1,
  },
  collectionActionTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  collectionActionSub: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  collectionActionButton: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  collectionActionText: {
    color: Colors.brandHighlight,
    fontSize: 12,
    fontWeight: '700',
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
