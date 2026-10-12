import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Colors } from '../../constants/colors';
import { Spacing } from '../../constants/theme';
import { useDevices } from '../../hooks/useDevices';
import { DeviceHealthCard } from './DeviceHealthCard';
import { DeviceHealthSummaryCards } from './DeviceHealthSummaryCards';
import { DeviceStatus } from '../../types/device';
import { formatRelativeTime } from '../../utils/formatters';
import { FilterChips, ScreenHeader, StateCard } from '../ui/kit';
import { Skeleton } from '../ui/motion';

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
      <ScreenHeader
        eyebrow="GIÁM SÁT HỆ THỐNG"
        title="Theo dõi thiết bị"
        subtitle={lastUpdated ? `Cập nhật ${formatRelativeTime(lastUpdated)}` : 'Tình trạng kết nối và sức khỏe phần cứng IoT'}
      />
      <View style={styles.filterBar}>
        <FilterChips options={FILTER_TABS} value={activeTab} onChange={setActiveTab} />
      </View>

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
        {isLoading && devices.length === 0 && (
          <View style={styles.skeletons}>
            <Skeleton height={64} radius={8} />
            <Skeleton height={230} radius={12} />
            <Skeleton height={230} radius={12} />
          </View>
        )}

        {error && devices.length === 0 && (
          <StateCard kind="error" title="Không thể tải trạng thái thiết bị" message={error} onRetry={reload} />
        )}

        {!isLoading && !error && filteredDevices.length === 0 && (
          <StateCard
            kind="empty"
            icon="cpu"
            title="Không có thiết bị"
            message={
              activeTab === 'ALL'
                ? 'Hệ thống chưa ghi nhận thiết bị IoT nào.'
                : 'Không có thiết bị nào thuộc bộ lọc trạng thái này.'
            }
          />
        )}

        {!isLoading && !error && devices.length > 0 && <DeviceHealthSummaryCards summary={summary} />}

        {!isLoading && !error && filteredDevices.map((device, index) => (
          <DeviceHealthCard key={device.id || device.deviceId} device={device} index={index} />
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  filterBar: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  skeletons: {
    gap: Spacing.md,
  },
});
