import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Tones } from '../../constants/colors';
import { COLLECTION_TONE, FontSize, Mono, Radius, Shadow, Spacing } from '../../constants/theme';
import { CollectionRecord, COLLECTION_STATUS_LABELS } from '../../types/collection';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';
import { Badge } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { FadeIn } from '../ui/motion';

interface CollectionHistoryCardProps {
  collection: CollectionRecord;
  onPressBin?: (binCode: string) => void;
  index?: number;
}

export const CollectionHistoryCard: React.FC<CollectionHistoryCardProps> = ({
  collection,
  index = 0,
}) => {
  const tone = COLLECTION_TONE[collection.status] ?? 'neutral';
  const statusLabel = COLLECTION_STATUS_LABELS[collection.status] || collection.status;

  const binName = collection.bin?.name || 'Ngăn rác';
  const binCode = collection.bin?.binCode || 'BIN';

  const hasFillAfter =
    collection.fillLevelAfter !== null && collection.fillLevelAfter !== undefined;
  const fillDiff = hasFillAfter
    ? (collection.fillLevelAfter as number) - collection.fillLevelBefore
    : null;

  return (
    <FadeIn delay={Math.min(index, 6) * 40} style={styles.wrapper}>
      <View style={[styles.card, { borderLeftColor: Tones[tone].solid }]}>
        <View style={styles.topRow}>
          <View style={styles.binInfoContainer}>
            <Text style={styles.binCodeText} numberOfLines={1}>
              {binCode}
            </Text>
            <Text style={styles.binNameText} numberOfLines={1}>
              {binName}
            </Text>
          </View>
          <Badge tone={tone} label={statusLabel} />
        </View>

        <View style={styles.timeRow}>
          <Icon name="clock" size={13} color={Colors.textMuted} />
          <Text style={styles.timeText}>{formatDateTime(collection.collectedAt)}</Text>
          <Text style={styles.relativeTimeText}>{formatRelativeTime(collection.collectedAt)}</Text>
        </View>

        <View style={styles.metricsBox}>
          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>TRƯỚC THU GOM</Text>
            <Text style={[styles.metricValue, { color: Tones.monitor.text }]}>{collection.fillLevelBefore}%</Text>
          </View>

          <View style={styles.metricArrowContainer}>
            <Icon name="chevron-right" size={16} color={Colors.textMuted} />
            {fillDiff !== null && (
              <Text style={[styles.metricDiff, { color: fillDiff <= 0 ? Tones.normal.text : Tones.critical.text }]}>
                {fillDiff <= 0 ? `${fillDiff}%` : `+${fillDiff}%`}
              </Text>
            )}
          </View>

          <View style={styles.metricItem}>
            <Text style={styles.metricLabel}>SAU THU GOM</Text>
            <Text style={[styles.metricValue, { color: hasFillAfter ? Tones.normal.text : Colors.textMuted }]}>
              {hasFillAfter ? `${collection.fillLevelAfter}%` : 'Chưa có dữ liệu'}
            </Text>
          </View>
        </View>

        {collection.collectedBy ? (
          <View style={styles.metaRow}>
            <Icon name="user" size={13} color={Colors.textMuted} />
            <Text style={styles.metaLabel}>Nhân viên</Text>
            <Text style={styles.metaValue} numberOfLines={1}>
              {collection.collectedBy}
            </Text>
          </View>
        ) : null}

        {collection.notes ? (
          <View style={styles.notesBox}>
            <Text style={styles.notesText}>{collection.notes}</Text>
          </View>
        ) : null}
      </View>
    </FadeIn>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: Spacing.sm + 2,
  },
  card: {
    gap: Spacing.sm + 2,
    padding: Spacing.md + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: Colors.border,
    backgroundColor: '#142438',
    ...Shadow.card,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  binInfoContainer: {
    flex: 1,
    minWidth: 0,
  },
  binCodeText: {
    color: '#9AB1C4',
    fontSize: FontSize.micro,
    fontFamily: Mono,
    fontWeight: '700',
  },
  binNameText: {
    color: Colors.textPrimary,
    fontSize: FontSize.base,
    fontWeight: '800',
    marginTop: 2,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  timeText: {
    color: Colors.textSecondary,
    fontSize: FontSize.small,
    fontWeight: '600',
  },
  relativeTimeText: {
    color: Colors.textMuted,
    fontSize: FontSize.caption,
  },
  metricsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#111F2F',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  metricItem: {
    alignItems: 'center',
    flexShrink: 1,
  },
  metricLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: FontSize.title,
    fontWeight: '800',
  },
  metricArrowContainer: {
    alignItems: 'center',
  },
  metricDiff: {
    fontSize: FontSize.micro,
    fontWeight: '800',
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaLabel: {
    color: Colors.textMuted,
    fontSize: FontSize.small,
  },
  metaValue: {
    flexShrink: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.small,
    fontWeight: '700',
  },
  notesBox: {
    padding: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  notesText: {
    color: Colors.textSecondary,
    fontSize: FontSize.small,
    lineHeight: 17,
  },
});
