import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import {
  CollectionRecord,
  COLLECTION_STATUS_LABELS,
  COLLECTION_STATUS_COLORS,
} from '../../types/collection';
import { formatDateTime, formatRelativeTime } from '../../utils/formatters';

interface CollectionHistoryCardProps {
  collection: CollectionRecord;
  onPressBin?: (binCode: string) => void;
}

export const CollectionHistoryCard: React.FC<CollectionHistoryCardProps> = ({
  collection,
}) => {
  const statusConfig =
    COLLECTION_STATUS_COLORS[collection.status] || COLLECTION_STATUS_COLORS.COMPLETED;
  const statusLabel =
    COLLECTION_STATUS_LABELS[collection.status] || collection.status;

  const binName = collection.bin?.name || 'Ngăn rác';
  const binCode = collection.bin?.binCode || 'BIN';

  // Calculate fill level diff if both before and after are provided
  const hasFillAfter =
    collection.fillLevelAfter !== null && collection.fillLevelAfter !== undefined;
  const fillDiff = hasFillAfter
    ? (collection.fillLevelAfter as number) - collection.fillLevelBefore
    : null;

  return (
    <View style={styles.card}>
      {/* Top Header Row: Bin info & Status Badge */}
      <View style={styles.topRow}>
        <View style={styles.binInfoContainer}>
          <View style={styles.binCodePill}>
            <Text style={styles.binCodeText}>{binCode}</Text>
          </View>
          <Text style={styles.binNameText} numberOfLines={1}>
            {binName}
          </Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: statusConfig.bg,
              borderColor: statusConfig.border,
            },
          ]}
        >
          <Text style={[styles.statusText, { color: statusConfig.text }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      {/* Timestamp Row */}
      <View style={styles.timeRow}>
        <Text style={styles.timeIcon}>🕒</Text>
        <Text style={styles.timeText}>
          {formatDateTime(collection.collectedAt)}
        </Text>
        <Text style={styles.timeDot}>•</Text>
        <Text style={styles.relativeTimeText}>
          {formatRelativeTime(collection.collectedAt)}
        </Text>
      </View>

      {/* Fill Level Metrics */}
      <View style={styles.metricsBox}>
        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>MỨC TRƯỚC</Text>
          <Text style={[styles.metricValue, { color: Colors.warning }]}>
            {collection.fillLevelBefore}%
          </Text>
        </View>

        <View style={styles.metricArrowContainer}>
          <Text style={styles.metricArrow}>➔</Text>
          {fillDiff !== null && (
            <Text
              style={[
                styles.metricDiff,
                { color: fillDiff <= 0 ? Colors.success : Colors.error },
              ]}
            >
              {fillDiff <= 0 ? `${fillDiff}%` : `+${fillDiff}%`}
            </Text>
          )}
        </View>

        <View style={styles.metricItem}>
          <Text style={styles.metricLabel}>MỨC SAU</Text>
          <Text
            style={[
              styles.metricValue,
              { color: hasFillAfter ? Colors.success : Colors.textMuted },
            ]}
          >
            {hasFillAfter ? `${collection.fillLevelAfter}%` : 'Chưa đo'}
          </Text>
        </View>
      </View>

      {/* Collector / Worker Info if present */}
      {collection.collectedBy && (
        <View style={styles.metaRow}>
          <Text style={styles.metaIcon}>👤</Text>
          <Text style={styles.metaLabel}>Người thu gom:</Text>
          <Text style={styles.metaValue}>{collection.collectedBy}</Text>
        </View>
      )}

      {/* Notes if present */}
      {collection.notes && (
        <View style={styles.notesBox}>
          <Text style={styles.notesIcon}>📝</Text>
          <Text style={styles.notesText}>{collection.notes}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  binInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  binCodePill: {
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  binCodeText: {
    color: Colors.info,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  binNameText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 5,
  },
  timeIcon: {
    fontSize: 11,
  },
  timeText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  timeDot: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  relativeTimeText: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  metricsBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: Colors.surface,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  metricItem: {
    alignItems: 'center',
  },
  metricLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  metricArrowContainer: {
    alignItems: 'center',
  },
  metricArrow: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
  metricDiff: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  metaIcon: {
    fontSize: 12,
  },
  metaLabel: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  metaValue: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  notesBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 4,
    padding: 8,
    marginTop: 8,
    gap: 6,
  },
  notesIcon: {
    fontSize: 12,
    marginTop: 1,
  },
  notesText: {
    color: Colors.textSecondary,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
    fontStyle: 'italic',
  },
});
