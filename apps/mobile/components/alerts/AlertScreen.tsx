import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Colors } from '../../constants/colors';
import { Spacing } from '../../constants/theme';
import { useAlerts } from '../../hooks/useAlerts';
import { AlertCard } from './AlertCard';
import { RealtimeStatusBadge } from './RealtimeStatusBadge';
import { AlertSeverity } from '../../types/alert';
import { FilterChips, ScreenHeader, StateCard } from '../ui/kit';
import { Skeleton } from '../ui/motion';

type AlertFilterKey = 'ALL' | 'UNRESOLVED' | AlertSeverity;

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

  // IDs present when the list first loaded are "known"; later arrivals get the entrance highlight once.
  const knownIds = useRef<Set<string> | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (isLoading) return;
    if (knownIds.current === null) {
      knownIds.current = new Set(alerts.map((a) => a.id));
      return;
    }
    const known = knownIds.current;
    const fresh = alerts.filter((a) => !known.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach((a) => known.add(a.id));
    setNewIds((prev) => {
      const next = new Set(prev);
      fresh.forEach((a) => next.add(a.id));
      return next;
    });
  }, [alerts, isLoading]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (activeTab === 'ALL') return true;
      if (activeTab === 'UNRESOLVED') return !alert.isResolved;
      return alert.severity === activeTab;
    });
  }, [alerts, activeTab]);

  const filterOptions = useMemo(
    () => [
      { key: 'ALL' as AlertFilterKey, label: 'Tất cả', count: alerts.length },
      { key: 'CRITICAL' as AlertFilterKey, label: 'Nguy cấp', count: alerts.filter((a) => a.severity === 'CRITICAL').length },
      { key: 'WARNING' as AlertFilterKey, label: 'Cảnh báo', count: alerts.filter((a) => a.severity === 'WARNING').length },
      { key: 'INFO' as AlertFilterKey, label: 'Thông tin', count: alerts.filter((a) => a.severity === 'INFO').length },
      { key: 'UNRESOLVED' as AlertFilterKey, label: 'Chưa xử lý', count: alerts.filter((a) => !a.isResolved).length },
    ],
    [alerts]
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow="EVENT MONITOR"
        title="Trung tâm cảnh báo"
        subtitle="Sự kiện hệ thống và trạng thái xử lý theo thời gian thực"
        right={<RealtimeStatusBadge status={connectionStatus} />}
      />
      <View style={styles.filterBar}>
        <FilterChips options={filterOptions} value={activeTab} onChange={setActiveTab} />
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
        {isLoading && alerts.length === 0 && (
          <View style={styles.skeletons}>
            <Skeleton height={130} radius={12} />
            <Skeleton height={130} radius={12} />
            <Skeleton height={130} radius={12} />
          </View>
        )}

        {error && alerts.length === 0 && (
          <StateCard kind="error" title="Không thể tải cảnh báo" message={error} onRetry={reload} />
        )}

        {!isLoading && !error && filteredAlerts.length === 0 && (
          <StateCard
            kind="empty"
            icon="bell"
            title={activeTab === 'ALL' ? 'Chưa có cảnh báo' : 'Không có cảnh báo trong nhóm này'}
            message={
              activeTab === 'ALL'
                ? 'Các sự kiện vận hành sẽ hiển thị tại đây khi được ghi nhận.'
                : 'Chọn bộ lọc khác để xem sự kiện.'
            }
          />
        )}

        {!isLoading && !error && filteredAlerts.map((alert) => (
          <AlertCard key={alert.id} alert={alert} isNew={newIds.has(alert.id)} />
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
