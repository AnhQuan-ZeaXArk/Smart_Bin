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
import { useDevices } from '../../hooks/useDevices';
import { DeviceHealthCard } from './DeviceHealthCard';
import { DeviceHealthSummaryCards } from './DeviceHealthSummaryCards';
import { DeviceStatus } from '../../types/device';
import { formatRelativeTime } from '../../utils/formatters';

type StatusFilterKey = 'ALL' | DeviceStatus;

const FILTER_TABS: Array<{ key: StatusFilterKey; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'ONLINE', label: 'Hoạt động' },
  { key: 'WARNING', label: 'Cần kiểm tra' },
  { key: 'OFFLINE', label: 'Mất kết nối' },
];

export const DeviceHealthScreen: React.FC = () => {
  const {
    devices,
    isLoading,
    isRefreshing,
    error,
    summary,
    lastUpdated,
    refresh,
    reload,
  } = useDevices();

  const [activeTab, setActiveTab] = useState<StatusFilterKey>('ALL');

  const filteredDevices = useMemo(() => {
    if (activeTab === 'ALL') return devices;
    return devices.filter((d) => d.status === activeTab);
  }, [devices, activeTab]);

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <Text style={styles.eyebrow}>QUẢN LÝ HỆ THỐNG SMARTBIN</Text>
          {lastUpdated && (
            <Text style={styles.lastUpdatedText}>
              Cập nhật: {formatRelativeTime(lastUpdated)}
            </Text>
          )}
        </View>
        <Text style={styles.title}>Trạng thái thiết bị</Text>
        <Text style={styles.subTitle}>
          Giám sát 4 thành phần phần cứng và truyền thông IoT theo thời gian thực
        </Text>
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

      {/* Main Content Area */}
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
        {isLoading && devices.length === 0 && (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={Colors.brandHighlight} />
            <Text style={styles.loadingText}>Đang tải trạng thái thiết bị...</Text>
          </View>
        )}

        {/* Error State */}
        {error && devices.length === 0 && (
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
        {!isLoading && !error && filteredDevices.length === 0 && (
          <View style={styles.centerBox}>
            <Text style={styles.emptyIcon}>📡</Text>
            <Text style={styles.emptyTitle}>Chưa có dữ liệu thiết bị.</Text>
            <Text style={styles.emptySub}>
              {activeTab === 'ALL'
                ? 'Hệ thống chưa ghi nhận thiết bị IoT nào được kích hoạt.'
                : 'Không có thiết bị nào thuộc bộ lọc trạng thái này.'}
            </Text>
          </View>
        )}

        {/* Devices List */}
        {!isLoading && !error && filteredDevices.length > 0 && (
          <>
            <DeviceHealthSummaryCards summary={summary} />

            {filteredDevices.map((device) => (
              <DeviceHealthCard
                key={device.id || device.deviceId}
                device={device}
              />
            ))}

            <View style={styles.footer}>
              <Text style={styles.footerText}>
                SmartBin IoT System • 4 Thiết bị phần cứng cốt lõi
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
    marginBottom: 2,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1.2,
  },
  lastUpdatedText: {
    fontSize: 10,
    color: Colors.textMuted,
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
    marginTop: 3,
    lineHeight: 16,
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
