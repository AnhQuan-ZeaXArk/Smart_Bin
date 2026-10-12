import React, { useState, useMemo } from 'react';
import { View, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { Colors } from '../../constants/colors';
import { Spacing } from '../../constants/theme';
import { useBins } from '../../hooks/useBins';
import { useNavigation } from '../../hooks/useNavigation';
import { BinCard } from './BinCard';
import { Bin, WasteCompartmentKey } from '../../types/bin';
import { FilterChips, ScreenHeader, StateCard } from '../ui/kit';
import { Skeleton } from '../ui/motion';

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

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow="QUẢN LÝ TÀI NGUYÊN"
        title="Quản lý thùng rác"
        subtitle="Theo dõi mức đầy và trạng thái các thùng"
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
        {isLoading && bins.length === 0 && (
          <View style={styles.skeletons}>
            <Skeleton height={190} radius={12} />
            <Skeleton height={190} radius={12} />
            <Skeleton height={190} radius={12} />
          </View>
        )}

        {error && bins.length === 0 && (
          <StateCard kind="error" title="Không thể tải danh sách thùng rác" message={error} onRetry={reload} />
        )}

        {!isLoading && !error && filteredBins.length === 0 && (
          <StateCard
            kind="empty"
            icon="trash"
            title={activeTab === 'ALL' ? 'Chưa có thùng rác' : 'Không tìm thấy thùng phù hợp'}
            message={
              activeTab === 'ALL'
                ? 'Danh sách thùng rác hiện chưa có dữ liệu.'
                : 'Thay đổi bộ lọc để xem các ngăn khác.'
            }
          />
        )}

        {filteredBins.map((bin, index) => (
          <BinCard key={bin.id || bin.binCode} bin={bin} onPress={handleSelectBin} index={index} />
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
