import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { useCollections } from '../../hooks/useCollections';
import { useNavigation } from '../../hooks/useNavigation';
import { CollectionHistoryCard } from './CollectionHistoryCard';
import { LoadingCollectionHistory } from './LoadingCollectionHistory';
import {
  CollectionStatus,
  COLLECTION_STATUS_LABELS,
} from '../../types/collection';

type StatusFilterTab = 'ALL' | CollectionStatus;

const STATUS_TABS: Array<{ key: StatusFilterTab; label: string }> = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'COMPLETED', label: COLLECTION_STATUS_LABELS.COMPLETED },
  { key: 'IN_PROGRESS', label: COLLECTION_STATUS_LABELS.IN_PROGRESS },
  { key: 'PENDING', label: COLLECTION_STATUS_LABELS.PENDING },
  { key: 'CANCELLED', label: COLLECTION_STATUS_LABELS.CANCELLED },
];

export const CollectionHistoryScreen: React.FC = () => {
  const { params, goBack, canGoBack } = useNavigation();
  const initialBinCode = params?.binCode;

  const {
    collections,
    filteredCollections,
    isLoading,
    isRefreshing,
    error,
    filters,
    setFilters,
    refresh,
    reload,
  } = useCollections(initialBinCode ? { binCode: initialBinCode } : undefined);

  const [activeTab, setActiveTab] = useState<StatusFilterTab>('ALL');
  const [searchText, setSearchText] = useState<string>('');

  // Sync initialBinCode from route params if passed
  useEffect(() => {
    if (initialBinCode) {
      setFilters((prev) => ({ ...prev, binCode: initialBinCode }));
    }
  }, [initialBinCode, setFilters]);

  // Handle status tab change
  const handleTabSelect = (tab: StatusFilterTab) => {
    setActiveTab(tab);
    setFilters((prev) => ({
      ...prev,
      status: tab === 'ALL' ? undefined : tab,
    }));
  };

  // Handle search text change
  const handleSearchChange = (text: string) => {
    setSearchText(text);
    setFilters((prev) => ({
      ...prev,
      search: text,
    }));
  };

  // Clear bin filter if it was set
  const handleClearBinFilter = () => {
    setFilters((prev) => ({
      ...prev,
      binCode: undefined,
    }));
  };

  // Reset all filters
  const handleResetFilters = () => {
    setActiveTab('ALL');
    setSearchText('');
    setFilters({});
  };

  // Compute summary stats
  const completedCount = useMemo(
    () => collections.filter((c) => c.status === 'COMPLETED').length,
    [collections]
  );
  const pendingOrInProgressCount = useMemo(
    () =>
      collections.filter(
        (c) => c.status === 'PENDING' || c.status === 'IN_PROGRESS'
      ).length,
    [collections]
  );

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        {canGoBack && (
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.7}
            onPress={goBack}
          >
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.backText}>Quay lại</Text>
          </TouchableOpacity>
        )}

        <View style={styles.headerTopRow}>
          <Text style={styles.eyebrow}>QUẢN LÝ HỆ THỐNG SMARTBIN</Text>
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Dữ liệu thực tế</Text>
          </View>
        </View>

        <Text style={styles.title}>Lịch sử thu gom</Text>
        <Text style={styles.subTitle}>
          Nhật ký thu gom rác thực tế từ các ngăn thùng SmartBin
        </Text>

        {/* Quick Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statValue}>{collections.length}</Text>
            <Text style={styles.statLabel}>Tổng số lượt</Text>
          </View>
          <View style={styles.statPill}>
            <Text style={[styles.statValue, { color: Colors.success }]}>
              {completedCount}
            </Text>
            <Text style={styles.statLabel}>Hoàn thành</Text>
          </View>
          {pendingOrInProgressCount > 0 && (
            <View style={[styles.statPill, styles.statPillWarning]}>
              <Text style={[styles.statValue, { color: Colors.warning }]}>
                {pendingOrInProgressCount}
              </Text>
              <Text style={styles.statLabel}>Đang xử lý/Chờ</Text>
            </View>
          )}
        </View>
      </View>

      {/* Active Bin Filter Banner if filtering by binCode */}
      {filters.binCode && (
        <View style={styles.activeBinBanner}>
          <Text style={styles.activeBinText}>
            Lọc theo ngăn:{' '}
            <Text style={styles.activeBinHighlight}>{filters.binCode}</Text>
          </Text>
          <TouchableOpacity
            style={styles.clearBinButton}
            activeOpacity={0.7}
            onPress={handleClearBinFilter}
          >
            <Text style={styles.clearBinText}>Xóa lọc ✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Tìm theo mã thùng, nhân viên, ghi chú..."
          placeholderTextColor={Colors.textMuted}
          value={searchText}
          onChangeText={handleSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {searchText.length > 0 && (
          <TouchableOpacity
            style={styles.clearSearchButton}
            onPress={() => handleSearchChange('')}
          >
            <Text style={styles.clearSearchText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Status Filter Tabs Bar */}
      <View style={styles.filterBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterTabsContent}
        >
          {STATUS_TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.filterTab,
                  isActive && styles.filterTabActive,
                ]}
                activeOpacity={0.7}
                onPress={() => handleTabSelect(tab.key)}
              >
                <Text
                  style={[
                    styles.filterTabLabel,
                    isActive && styles.filterTabLabelActive,
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
      {/* 1. Loading Initial State */}
      {isLoading && collections.length === 0 && <LoadingCollectionHistory />}

      {/* 2. Error State */}
      {error && collections.length === 0 && (
        <View style={styles.errorBox}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>LỖI TẢI DỮ LIỆU</Text>
          <Text style={styles.errorMessage}>Không thể tải lịch sử thu gom.</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            activeOpacity={0.8}
            onPress={reload}
          >
            <Text style={styles.retryButtonText}>Thử lại</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 3. Empty State (no results) */}
      {!isLoading && !error && filteredCollections.length === 0 && (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>
            {collections.length === 0
              ? 'Chưa có lịch sử thu gom.'
              : 'Không tìm thấy lượt thu gom'}
          </Text>
          <Text style={styles.emptySub}>
            {collections.length === 0
              ? 'Hệ thống chưa ghi nhận lần thu gom rác nào trên máy chủ.'
              : 'Không có bản ghi nào khớp với điều kiện lọc hiện tại.'}
          </Text>
          {collections.length > 0 && (
            <TouchableOpacity
              style={styles.resetFilterButton}
              activeOpacity={0.8}
              onPress={handleResetFilters}
            >
              <Text style={styles.resetFilterText}>Đặt lại bộ lọc</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 4. Collection List */}
      {!isLoading && !error && filteredCollections.length > 0 && (
        <FlatList
          data={filteredCollections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CollectionHistoryCard collection={item} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor={Colors.brandHighlight}
              colors={[Colors.brandHighlight]}
            />
          }
        />
      )}
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
    paddingTop: 16,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 4,
  },
  backArrow: {
    color: Colors.brandHighlight,
    fontSize: 16,
    fontWeight: '700',
  },
  backText: {
    color: Colors.brandHighlight,
    fontSize: 13,
    fontWeight: '600',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eyebrow: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  liveText: {
    color: Colors.success,
    fontSize: 10,
    fontWeight: '700',
  },
  title: {
    color: Colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  subTitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 8,
  },
  statPill: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
  },
  statPillWarning: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  statValue: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  statLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  activeBinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(56, 189, 248, 0.3)',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  activeBinText: {
    color: Colors.textSecondary,
    fontSize: 12,
  },
  activeBinHighlight: {
    color: Colors.info,
    fontWeight: '800',
  },
  clearBinButton: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  clearBinText: {
    color: Colors.info,
    fontSize: 11,
    fontWeight: '700',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 6,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 10,
    height: 38,
    gap: 8,
  },
  searchIcon: {
    fontSize: 13,
  },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 12,
    paddingVertical: 0,
  },
  clearSearchButton: {
    padding: 4,
  },
  clearSearchText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  filterBar: {
    marginTop: 8,
    marginBottom: 4,
  },
  filterTabsContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterTabActive: {
    backgroundColor: Colors.brandPrimary,
    borderColor: Colors.brandHighlight,
  },
  filterTabLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
  },
  filterTabLabelActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
  },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    marginTop: 30,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySub: {
    color: Colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  resetFilterButton: {
    marginTop: 16,
    backgroundColor: Colors.surfaceCard,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  resetFilterText: {
    color: Colors.brandHighlight,
    fontSize: 12,
    fontWeight: '700',
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    marginTop: 30,
  },
  errorIcon: {
    fontSize: 36,
    marginBottom: 10,
  },
  errorTitle: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  errorMessage: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  errorDetail: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: Colors.brandPrimary,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
