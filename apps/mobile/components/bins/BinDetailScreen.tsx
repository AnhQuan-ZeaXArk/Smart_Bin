import React from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Tones } from '../../constants/colors';
import {
  BIN_STATUS_LABEL,
  BIN_STATUS_TONE,
  FILL_LABEL,
  FILL_TONE,
  FontSize,
  Radius,
  Shadow,
  Spacing,
} from '../../constants/theme';
import { useBinDetail } from '../../hooks/useBinDetail';
import { useNavigation } from '../../hooks/useNavigation';
import { SensorHistoryCard } from './SensorHistoryCard';
import { BIN_DISPLAY_NAMES } from './BinOverviewCard';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { ALERT_SEVERITY_LABELS } from '../../types/alert';
import { SEVERITY_TONE } from '../../constants/theme';
import { Badge, Button, Card, ScreenHeader, SectionHeader, StateCard } from '../ui/kit';
import { AnimatedProgressBar, FadeIn, Skeleton } from '../ui/motion';
import { Icon } from '../ui/Icon';

interface BinDetailScreenProps {
  binId: string;
  binCode?: string;
  binName?: string;
}

export const BinDetailScreen: React.FC<BinDetailScreenProps> = ({
  binId,
  binCode,
  binName,
}) => {
  const { goBack, navigate } = useNavigation();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isRefreshing, error, errorStatus, refresh, reload } = useBinDetail(
    binId,
    binCode
  );

  const bin = data?.bin;
  const displayName =
    (bin?.binCode && BIN_DISPLAY_NAMES[bin.binCode]) ||
    bin?.name ||
    binName ||
    binCode ||
    'Ngăn rác SmartBin';

  const missingId = !binId;
  const errorTitle = errorStatus === 404 ? 'Không tìm thấy thùng rác' : 'Không thể tải thông tin thùng rác';
  const errorMessage = errorStatus === 0 ? 'Không thể kết nối đến máy chủ' : error || undefined;

  return (
    <View style={styles.container}>
      <ScreenHeader
        eyebrow="CHI TIẾT THÙNG RÁC"
        title={displayName}
        subtitle={bin?.binCode ?? binCode}
        onBack={goBack}
        right={bin ? <Badge tone={BIN_STATUS_TONE[bin.status]} label={BIN_STATUS_LABEL[bin.status]} dot /> : undefined}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
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
        {missingId && (
          <StateCard kind="error" title="Không tìm thấy thùng rác" message="Thiếu mã thùng rác để tải chi tiết." onBack={goBack} />
        )}

        {!missingId && isLoading && !data && (
          <View style={styles.skeletons}>
            <Skeleton height={190} radius={12} />
            <Skeleton height={150} radius={12} />
            <Skeleton height={220} radius={12} />
          </View>
        )}

        {!missingId && error && !data && (
          <StateCard kind="error" title={errorTitle} message={errorMessage} onRetry={reload} onBack={goBack} />
        )}

        {bin && (
          <>
            <FadeIn>
              <View style={[styles.hero, { borderColor: Tones[FILL_TONE[bin.fillCategory]].border }]}>
                <Text style={styles.heroLabel}>MỨC ĐỘ ĐẦY HIỆN TẠI</Text>
                <View style={styles.heroLevelRow}>
                  <Text style={styles.heroLevel}>
                    {bin.currentFillLevel}
                    <Text style={styles.heroPercent}>%</Text>
                  </Text>
                  <Badge tone={FILL_TONE[bin.fillCategory]} label={FILL_LABEL[bin.fillCategory]} />
                </View>
                <AnimatedProgressBar value={bin.currentFillLevel} tone={FILL_TONE[bin.fillCategory]} height={12} duration={800} />

                <View style={styles.facts}>
                  <View style={styles.fact}>
                    <Text style={styles.factLabel}>Khoảng cách gần nhất</Text>
                    <Text style={styles.factValue}>
                      {bin.distanceCm !== undefined && bin.distanceCm !== null ? `${bin.distanceCm} cm` : 'Chưa có dữ liệu'}
                    </Text>
                  </View>
                  <View style={styles.fact}>
                    <Text style={styles.factLabel}>Dung tích</Text>
                    <Text style={styles.factValue}>{bin.capacity.toLocaleString('vi-VN')} L</Text>
                  </View>
                  <View style={styles.fact}>
                    <Text style={styles.factLabel}>Trạng thái thùng</Text>
                    <Text style={styles.factValue}>{BIN_STATUS_LABEL[bin.status]}</Text>
                  </View>
                  <View style={styles.fact}>
                    <Text style={styles.factLabel}>Cập nhật lần cuối</Text>
                    <Text style={styles.factValue}>{formatRelativeTime(bin.lastSeen || bin.updatedAt)}</Text>
                  </View>
                </View>
              </View>
            </FadeIn>

            <FadeIn delay={70}>
              <Card style={styles.block}>
                <SectionHeader title="Thông tin chi tiết" />
                <View style={styles.specList}>
                  <View style={styles.specItem}>
                    <Text style={styles.specLabel}>Vị trí đặt</Text>
                    <Text style={styles.specValue}>{bin.location || 'Khu vực SmartBin'}</Text>
                  </View>
                  <View style={styles.specItem}>
                    <Text style={styles.specLabel}>Tọa độ GPS</Text>
                    <Text style={styles.specValue}>
                      {bin.latitude && bin.longitude
                        ? `${bin.latitude.toFixed(4)}, ${bin.longitude.toFixed(4)}`
                        : 'Chưa có dữ liệu'}
                    </Text>
                  </View>
                  <View style={[styles.specItem, styles.specItemLast]}>
                    <Text style={styles.specLabel}>Lần cập nhật</Text>
                    <Text style={styles.specValue}>{formatDateTime(bin.lastSeen || bin.updatedAt)}</Text>
                  </View>
                </View>
              </Card>
            </FadeIn>

            {data.alerts && data.alerts.length > 0 && (
              <FadeIn delay={120}>
                <Card tone="monitor" style={styles.block}>
                  <SectionHeader title="Cảnh báo liên quan" subtitle={`${data.alerts.length} cảnh báo`} />
                  {data.alerts.map((alert) => (
                    <View key={alert.id} style={styles.alertItem}>
                      <Badge tone={SEVERITY_TONE[alert.severity]} label={ALERT_SEVERITY_LABELS[alert.severity]} />
                      <Text style={styles.alertMessage}>{alert.message}</Text>
                      <Text style={styles.alertTime}>{formatRelativeTime(alert.createdAt)}</Text>
                    </View>
                  ))}
                </Card>
              </FadeIn>
            )}

            <FadeIn delay={160}>
              <SensorHistoryCard readings={data.sensorReadings} />
            </FadeIn>

            <Button
              label="Xem lịch sử thu gom"
              variant="secondary"
              icon="history"
              onPress={() =>
                navigate('collections', {
                  binId: bin.id,
                  binCode: bin.binCode,
                  binName: bin.name,
                })
              }
            />
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
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  skeletons: {
    gap: Spacing.md,
  },
  hero: {
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    backgroundColor: '#14263A',
    ...Shadow.card,
  },
  heroLabel: {
    color: '#96AABC',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroLevelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLevel: {
    color: '#F4FAFB',
    fontSize: 56,
    fontWeight: '800',
    lineHeight: 62,
  },
  heroPercent: {
    color: '#5CDDB2',
    fontSize: 24,
  },
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#273A4C',
    paddingTop: Spacing.md,
    rowGap: Spacing.md,
  },
  fact: {
    width: '50%',
    paddingRight: Spacing.sm,
    gap: 4,
  },
  factLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.caption,
  },
  factValue: {
    color: Colors.textPrimary,
    fontSize: FontSize.body,
    fontWeight: '800',
  },
  block: {
    marginBottom: 0,
  },
  specList: {
    backgroundColor: '#111F2F',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
  },
  specItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  specItemLast: {
    borderBottomWidth: 0,
  },
  specLabel: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
  },
  specValue: {
    flexShrink: 1,
    fontSize: FontSize.small,
    color: Colors.textPrimary,
    fontWeight: '700',
    textAlign: 'right',
  },
  alertItem: {
    gap: 6,
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  alertMessage: {
    fontSize: FontSize.small,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  alertTime: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
  },
});
