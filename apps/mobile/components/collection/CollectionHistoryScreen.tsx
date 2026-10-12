import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { FontSize, Spacing } from '../../constants/theme';
import { useCollections } from '../../hooks/useCollections';
import { useNavigation } from '../../hooks/useNavigation';
import { CollectionHistoryCard } from './CollectionHistoryCard';
import { LoadingCollectionHistory } from './LoadingCollectionHistory';
import {
  CollectionStatus,
  COLLECTION_STATUS_LABELS,
} from '../../types/collection';
import { Button, FilterChips, ScreenHeader, SearchField, StateCard } from '../ui/kit';
import { Icon } from '../ui/Icon';

type StatusFilterTab = 'ALL' | CollectionStatus;

const STATUS_ORDER: CollectionStatus[] = ['COMPLETED', 'IN_PROGRESS', 'PENDING', 'CANCELLED'];

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

  const handleTabSelect = (tab: StatusFilterTab) => {
    setActiveTab(tab);
    setFilters((prev) => ({
      ...prev,
      status: tab === 'ALL' ? undefined : tab,
    }));
  };

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    setFilters((prev) => ({
      ...prev,
      search: text,
    }));
  };

  const handleClearBinFilter = () => {
    setFilters((prev) => ({
      ...prev,
      binCode: undefined,
    }));
  };

  const handleResetFilters = () => {
    setActiveTab('ALL');
    setSearchText('');
    setFilters({});
  };

  const filterOptions = useMemo(
    () => [
      { key: 'ALL' as StatusFilterTab, label: 'Tất cả', count: collections.length },
      ...STATUS_ORDER.map((s) => ({
        key: s as StatusFilterTab,
        label: COLLECTION_STATUS_LABELS[s],
        count: collections.filter((c) => c.status === s).length,
      })),
    ],
    [collections]
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow="COLLECTION LOG"
        title="Lịch sử thu gom"
        subtitle="Nhật ký thu gom từ các ngăn thùng SmartBin"
        onBack={canGoBack ? goBack : undefined}
      />

      <View style={styles.controls}>
        <SearchField
          placeholder="Tìm theo mã thùng, nhân viên, ghi chú..."
          value={searchText}
          onChangeText={handleSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {filters.binCode ? (
          <View style={styles.activeBinBanner}>
            <Text style={styles.activeBinText} numberOfLines={1}>
              Lọc theo ngăn: <Text style={styles.activeBinHighlight}>{filters.binCode}</Text>
            </Text>
            <TouchableOpacity style={styles.clearBinButton} activeOpacity={0.7} onPress={handleClearBinFilter}>
              <Icon name="x-circle" size={13} color={Colors.brandHighlight} />
              <Text style={styles.clearBinText}>Xóa lọc</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={styles.filterBar}>
        <FilterChips options={filterOptions} value={activeTab} onChange={handleTabSelect} />
      </View>

      {isLoading && collections.length === 0 && <LoadingCollectionHistory />}

      {error && collections.length === 0 && (
        <View style={styles.stateWrap}>
          <StateCard
            kind="error"
            title="Không thể tải lịch sử thu gom"
            message={error}
            onRetry={reload}
            onBack={canGoBack ? goBack : undefined}
          />
        </View>
      )}

      {!isLoading && !error && filteredCollections.length === 0 && (
        <View style={styles.stateWrap}>
          <StateCard
            kind="empty"
            icon="history"
            title={collections.length === 0 ? 'Chưa có lịch sử thu gom' : 'Không tìm thấy lượt thu gom'}
            message={
              collections.length === 0
                ? 'Hệ thống chưa ghi nhận lần thu gom nào.'
                : 'Không có bản ghi nào khớp với điều kiện lọc hiện tại.'
            }
          />
          {collections.length > 0 && (
            <Button label="Đặt lại bộ lọc" variant="secondary" onPress={handleResetFilters} style={styles.resetButton} />
          )}
        </View>
      )}

      {!isLoading && !error && filteredCollections.length > 0 && (
        <FlatList
          data={filteredCollections}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => <CollectionHistoryCard collection={item} index={index} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refresh}
              tintColor={Colors.brandHighlight}
              colors={[Colors.brandHighlight]}
              progressBackgroundColor={Colors.surfaceCard}
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
  controls: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  activeBinBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  activeBinText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: FontSize.small,
  },
  activeBinHighlight: {
    color: Colors.brandHighlight,
    fontWeight: '800',
  },
  clearBinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearBinText: {
    color: Colors.brandHighlight,
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
  filterBar: {
    marginTop: Spacing.xs,
  },
  stateWrap: {
    padding: Spacing.lg,
  },
  resetButton: {
    marginTop: Spacing.md,
  },
  listContent: {
    padding: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xxl,
  },
});
