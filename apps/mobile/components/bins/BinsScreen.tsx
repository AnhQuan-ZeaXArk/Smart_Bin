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
import { useBins } from '../../hooks/useBins';
import { useNavigation } from '../../hooks/useNavigation';
import { BinCard } from './BinCard';
import { Bin, WasteCompartmentKey } from '../../types/bin';

type CategoryFilterKey = 'ALL' | WasteCompartmentKey;

const FILTER_TABS: Array<{ key: CategoryFilterKey; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'ORGANIC', label: 'Hữu cơ' },
  { key: 'RECYCLABLE', label: 'Tái chế' },
  { key: 'NON_RECYCLABLE', label: 'Không tái chế' },
];

export const BinsScreen: React.FC = () => {
  const { navigate } = useNavigation();
  const { bins, isLoading, isRefreshing, error, refresh, reload } = useBins();
  const [activeTab, setActiveTab] = useState<CategoryFilterKey>('ALL');

  const filteredBins = useMemo(() => {
    if (activeTab === 'ALL') return bins;
    return bins.filter((bin) => bin.binCode === activeTab);
  }, [bins, activeTab]);

  const handleSelectBin = (bin: Bin) => {
    navigate('bin-detail', {
      binId: bin.id,
      binCode: bin.binCode,
      binName: bin.name,
    });
  };

  const totalCount = bins.length;
  const onlineCount = bins.filter((b) => b.status === 'ONLINE').length;
  const warningOrCriticalCount = bins.filter(
    (b) => b.fillCategory === 'NEARLY_FULL' || b.fillCategory === 'CRITICAL'
  ).length;

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>QUẢN LÝ HỆ THỐNG SMARTBIN</Text>
          <Text style={styles.title}>Thùng rác</Text>
          <Text style={styles.subTitle}>
            Giám sát 3 ngăn lưu trữ rác với cảm biến siêu âm theo thời gian thực
          </Text>
        </View>

        {/* Quick Stats Pill */}
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>{totalCount}</Text>
            <Text style={styles.statLabel}>Tổng số</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={[styles.statValue, { color: Colors.brandHighlight }]}>
              {onlineCount}
            </Text>
            <Text style={styles.statLabel}>Trực tuyến</Text>
          </View>
          {warningOrCriticalCount > 0 && (
            <View style={[styles.statPill, styles.statPillWarning]}>
              <Text style={[styles.statValue, { color: Colors.warning }]}>
                {warningOrCriticalCount}
              </Text>
              <Text style={styles.statLabel}>Cần thu gom</Text>
            </View>
          )}
        </View>
      </View>

      {/* Filter Tabs */}
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

      {/* Content List */}
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
        {isLoading && bins.length === 0 && (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={Colors.brandHighlight} />
            <Text style={styles.loadingText}>Đang tải danh sách thùng rác...</Text>
          </View>
        )}

        {/* Error State */}
        {error && bins.length === 0 && (
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
        {!isLoading && !error && filteredBins.length === 0 && (
          <View style={styles.centerBox}>
            <Text style={styles.emptyIcon}>🗑️</Text>
            <Text style={styles.emptyTitle}>Chưa có thùng rác nào.</Text>
            <Text style={styles.emptySub}>
              {activeTab === 'ALL'
                ? 'Hệ thống chưa có bản ghi thùng rác nào được cấu hình.'
                : 'Không có ngăn rác nào thuộc bộ lọc này.'}
            </Text>
          </View>
        )}

        {/* Bins List */}
        {filteredBins.map((bin) => (
          <BinCard key={bin.id || bin.binCode} bin={bin} onPress={handleSelectBin} />
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
  header: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1.2,
    marginBottom: 2,
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
  statPillWarning: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
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
});
