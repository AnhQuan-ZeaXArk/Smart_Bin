import React from 'react';
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
import { useBinDetail } from '../../hooks/useBinDetail';
import { useNavigation } from '../../hooks/useNavigation';
import { BinStatusBadge } from './BinStatusBadge';
import { BinFillIndicator } from './BinFillIndicator';
import { SensorHistoryCard } from './SensorHistoryCard';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';

interface BinDetailScreenProps {
  binId: string;
  binCode?: string;
  binName?: string;
}

const CATEGORY_NAMES: Record<string, string> = {
  ORGANIC: 'Rác hữu cơ',
  RECYCLABLE: 'Rác tái chế',
  NON_RECYCLABLE: 'Rác không tái chế',
};

export const BinDetailScreen: React.FC<BinDetailScreenProps> = ({
  binId,
  binCode,
  binName,
}) => {
  const { goBack, navigate } = useNavigation();
  const { data, isLoading, isRefreshing, error, refresh, reload } = useBinDetail(
    binId,
    binCode
  );

  const bin = data?.bin;
  const displayName =
    (bin?.binCode && CATEGORY_NAMES[bin.binCode]) ||
    bin?.name ||
    binName ||
    binCode ||
    'Ngăn rác SmartBin';

  return (
    <View style={styles.container}>
      {/* Top App Bar with Back Button */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          activeOpacity={0.7}
          onPress={goBack}
        >
          <Text style={styles.backArrow}>←</Text>
          <Text style={styles.backText}>Quay lại</Text>
        </TouchableOpacity>
        <View style={styles.topBarTitleContainer}>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            CHI TIẾT THÙNG RÁC
          </Text>
        </View>
        <View style={styles.topBarRightPlaceholder} />
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
          />
        }
      >
        {/* Loading State */}
        {isLoading && !data && (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={Colors.brandHighlight} />
            <Text style={styles.loadingText}>Đang tải dữ liệu thùng rác...</Text>
          </View>
        )}

        {/* Error State */}
        {error && !data && (
          <View style={styles.centerBox}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>LỖI TẢI THÔNG TIN</Text>
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

        {/* Detail Content */}
        {bin && (
          <>
            {/* Header Card */}
            <View style={styles.headerCard}>
              <View style={styles.headerRow}>
                <View style={styles.headerInfo}>
                  <Text style={styles.headerCategory}>{displayName}</Text>
                  <Text style={styles.headerCode}>Mã ngăn: {bin.binCode}</Text>
                </View>
                <BinStatusBadge status={bin.status} />
              </View>
              <Text style={styles.headerDescription}>
                Ngăn lưu trữ thuộc hệ thống SmartBin giám sát qua cảm biến siêu âm IoT.
              </Text>
            </View>

            {/* Main Fill Gauge Card */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>MỨC ĐỘ ĐẦY HIỆN TẠI</Text>
              <View style={styles.fillGaugeContainer}>
                <BinFillIndicator
                  fillLevel={bin.currentFillLevel}
                  fillCategory={bin.fillCategory}
                  barHeight={12}
                />
              </View>
            </View>

            {/* Ultrasonic Sensor Reading Card */}
            <View style={styles.card}>
              <View style={styles.sensorHeaderRow}>
                <Text style={styles.sectionTitle}>CẢM BIẾN SIÊU ÂM</Text>
                <View style={styles.onlineBadge}>
                  <Text style={styles.onlineBadgeText}>Hoạt động</Text>
                </View>
              </View>

              <View style={styles.metricGrid}>
                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Khoảng cách đo</Text>
                  <Text style={styles.metricValue}>
                    {bin.distanceCm !== undefined && bin.distanceCm !== null
                      ? `${bin.distanceCm} cm`
                      : '--'}
                  </Text>
                  <Text style={styles.metricSub}>Đo tới bề mặt rác</Text>
                </View>

                <View style={styles.metricBox}>
                  <Text style={styles.metricLabel}>Dung tích chứa</Text>
                  <Text style={styles.metricValue}>{bin.capacity} L</Text>
                  <Text style={styles.metricSub}>Sức chứa danh định</Text>
                </View>
              </View>
            </View>

            {/* Specifications Card */}
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>THÔNG TIN CHI TIẾT</Text>

              <View style={styles.specList}>
                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>Vị trí đặt:</Text>
                  <Text style={styles.specValue}>{bin.location || 'Khu vực SmartBin'}</Text>
                </View>

                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>Tọa độ GPS:</Text>
                  <Text style={styles.specValue}>
                    {bin.latitude && bin.longitude
                      ? `${bin.latitude.toFixed(4)}, ${bin.longitude.toFixed(4)}`
                      : 'Mặc định (Trạm chính)'}
                  </Text>
                </View>

                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>Trạng thái vận hành:</Text>
                  <Text style={styles.specValue}>
                    {bin.status === 'ONLINE' ? 'Trực tuyến (Bình thường)' : 'Ngoại tuyến'}
                  </Text>
                </View>

                <View style={styles.specItem}>
                  <Text style={styles.specLabel}>Cập nhật lần cuối:</Text>
                  <Text style={styles.specValue}>
                    {formatDateTime(bin.lastSeen || bin.updatedAt)}
                  </Text>
                </View>

                <View style={[styles.specItem, styles.specItemLast]}>
                  <Text style={styles.specLabel}>Tương đối:</Text>
                  <Text style={styles.specValue}>
                    {formatRelativeTime(bin.lastSeen || bin.updatedAt)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Related Alerts if any */}
            {data.alerts && data.alerts.length > 0 && (
              <View style={[styles.card, styles.alertCard]}>
                <View style={styles.alertHeaderRow}>
                  <Text style={styles.alertTitle}>⚠️ CẢNH BÁO LIÊN QUAN</Text>
                  <View style={styles.alertCountBadge}>
                    <Text style={styles.alertCountText}>{data.alerts.length}</Text>
                  </View>
                </View>

                {data.alerts.map((alert) => (
                  <View key={alert.id} style={styles.alertItem}>
                    <Text style={styles.alertMessage}>{alert.message}</Text>
                    <Text style={styles.alertTime}>
                      {formatRelativeTime(alert.createdAt)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {/* Historical Sensor Readings */}
            <SensorHistoryCard readings={data.sensorReadings} />

            {/* Link to Collection History for this bin */}
            <View style={styles.collectionLinkCard}>
              <View style={styles.collectionLinkHeader}>
                <Text style={styles.collectionLinkIcon}>📋</Text>
                <View style={styles.collectionLinkTextContainer}>
                  <Text style={styles.collectionLinkTitle}>LỊCH SỬ THU GOM</Text>
                  <Text style={styles.collectionLinkSub}>
                    Tra cứu các lần thu gom của ngăn này
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.collectionLinkButton}
                activeOpacity={0.8}
                onPress={() =>
                  navigate('collections', {
                    binId: bin.id,
                    binCode: bin.binCode,
                    binName: bin.name,
                  })
                }
              >
                <Text style={styles.collectionLinkButtonText}>
                  Xem lịch sử thu gom →
                </Text>
              </TouchableOpacity>
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 12,
  },
  backArrow: {
    color: Colors.brandHighlight,
    fontSize: 18,
    fontWeight: '800',
    marginRight: 6,
  },
  backText: {
    color: Colors.brandHighlight,
    fontSize: 14,
    fontWeight: '700',
  },
  topBarTitleContainer: {
    flex: 1,
    alignItems: 'center',
  },
  topBarTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  topBarRightPlaceholder: {
    width: 60,
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
  headerCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  headerInfo: {
    flex: 1,
    marginRight: 10,
  },
  headerCategory: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  headerCode: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '600',
    marginTop: 2,
  },
  headerDescription: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  fillGaugeContainer: {
    marginTop: 4,
  },
  sensorHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  onlineBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  onlineBadgeText: {
    color: Colors.brandHighlight,
    fontSize: 11,
    fontWeight: '700',
  },
  metricGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  metricBox: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.5)',
  },
  metricLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  metricSub: {
    fontSize: 10,
    color: Colors.brandHighlight,
  },
  specList: {
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  specItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.3)',
  },
  specItemLast: {
    borderBottomWidth: 0,
  },
  specLabel: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  specValue: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  alertCard: {
    borderColor: 'rgba(245, 158, 11, 0.4)',
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
  },
  alertHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.warning,
    letterSpacing: 0.8,
  },
  alertCountBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  alertCountText: {
    fontSize: 11,
    color: Colors.warning,
    fontWeight: '800',
  },
  alertItem: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(245, 158, 11, 0.15)',
  },
  alertMessage: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  alertTime: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  collectionLinkCard: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginTop: 12,
  },
  collectionLinkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  collectionLinkIcon: {
    fontSize: 22,
  },
  collectionLinkTextContainer: {
    flex: 1,
  },
  collectionLinkTitle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  collectionLinkSub: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  collectionLinkButton: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectionLinkButtonText: {
    color: Colors.brandHighlight,
    fontSize: 12,
    fontWeight: '700',
  },
});
