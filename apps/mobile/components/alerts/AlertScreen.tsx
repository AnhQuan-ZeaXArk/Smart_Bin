import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { useAlerts } from '../../hooks/useAlerts';
import { AlertCard } from './AlertCard';
import { RealtimeStatusBadge } from './RealtimeStatusBadge';
import { AlertSeverity } from '../../types/alert';

type AlertFilterKey = 'ALL' | 'UNRESOLVED' | AlertSeverity;

const FILTER_TABS: Array<{ key: AlertFilterKey; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'UNRESOLVED', label: 'Chưa xử lý' },
  { key: 'CRITICAL', label: 'Nguy cấp' },
  { key: 'WARNING', label: 'Cảnh báo' },
];

export const AlertScreen: React.FC = () => {
  const {
    alerts,
    isLoading,
    isRefreshing,
    error,
    connectionStatus,
    refresh,
    reload,
  } = useAlerts();

  const [activeTab, setActiveTab] = useState<AlertFilterKey>('ALL');

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (activeTab === 'ALL') return true;
      if (activeTab === 'UNRESOLVED') return !alert.isResolved;
      return alert.severity === activeTab;
    });
  }, [alerts, activeTab]);

  const activeCount = alerts.filter((a) => !a.isResolved).length;
  const criticalCount = alerts.filter((a) => a.severity === 'CRITICAL' && !a.isResolved).length;

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.eyebrow}>QUẢN LÝ HỆ THỐNG SMARTBIN</Text>
          <RealtimeStatusBadge status={connectionStatus} />
        </View>

        <Text style={styles.title}>Thông báo</Text>
        <Text style={styles.subTitle}>
          Cảnh báo và sự kiện hệ thống theo thời gian thực
        </Text>

        {/* Quick Stats Pill */}
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>{alerts.length}</Text>
            <Text style={styles.statLabel}>Tổng số</Text>
          </View>
          <View style={[styles.statPill, activeCount > 0 && styles.statPillActive]}>
            <Text
              style={[
                styles.statValue,
                activeCount > 0 && { color: Colors.warning },
              ]}
            >
              {activeCount}
            </Text>
            <Text style={styles.statLabel}>Chưa xử lý</Text>
          </View>
          {criticalCount > 0 && (
            <View style={[styles.statPill, styles.statPillCritical]}>
              <Text style={[styles.statValue, { color: Colors.error }]}>
                {criticalCount}
              </Text>
              <Text style={styles.statLabel}>Nguy cấp</Text>
            </View>
          )}
        </View>
      </View>

      {/* Filter Tabs Bar */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterTabsContent}
        >
          {FILTER_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
                activeOpacity={0.7}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isActive && styles.filterChipTextActive,
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Alerts Content List */}
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
        {/* Loading State */}
        {isLoading && alerts.length === 0 && (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={Colors.brandHighlight} />
            <Text style={styles.loadingText}>Đang tải danh sách thông báo...</Text>
          </View>
        )}

        {/* Error State */}
        {error && alerts.length === 0 && (
          <View style={styles.centerBox}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>LỖI KẾT NỐI</Text>
            <Text style={styles.errorMessage}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              activeOpacity={0.8}
              onPress={reload}
            >
              <Text style={styles.retryButtonText}>Thử lại</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredAlerts.length === 0 && (
          <View style={styles.centerBox}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyTitle}>Chưa có thông báo nào.</Text>
            <Text style={styles.emptySub}>
              {activeTab === 'ALL'
                ? 'Hệ thống hiện không ghi nhận cảnh báo nào.'
                : 'Không có thông báo nào thuộc bộ lọc này.'}
            </Text>
          </View>
        )}

        {/* Alerts List */}
        {!isLoading && !error && filteredAlerts.length > 0 && (
          <>
            {filteredAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                SmartBin Realtime Engine • Tự động cập nhật qua Socket.IO
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  subTitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  statPill: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.5)',
  },
  statPillActive: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  statPillCritical: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  statValue: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  filterBar: {
    backgroundColor: Colors.surface,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterTabsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterChip: {
    backgroundColor: Colors.surfaceCard,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.brandPrimary,
    borderColor: Colors.brandHighlight,
  },
  filterChipText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  centerBox: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: Colors.textSecondary,
    fontSize: 13,
  },
  errorIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  errorTitle: {
    color: Colors.error,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  errorMessage: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  retryButton: {
    backgroundColor: Colors.brandPrimary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  emptySub: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  footerText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
});
