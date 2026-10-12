import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Tones } from '../../constants/colors';
import {
  BIN_STATUS_LABEL,
  BIN_STATUS_TONE,
  FILL_LABEL,
  FILL_TONE,
  FontSize,
  Mono,
  Radius,
  Shadow,
  Spacing,
} from '../../constants/theme';
import { BinStatus, FillCategory } from '../../types/dashboard';
import { Badge } from '../ui/kit';
import { Icon, IconName } from '../ui/Icon';
import { AnimatedProgressBar, FadeIn, PressableScale } from '../ui/motion';

export const BIN_DISPLAY_NAMES: Record<string, string> = {
  ORGANIC: 'Rác hữu cơ',
  RECYCLABLE: 'Rác tái chế',
  NON_RECYCLABLE: 'Rác không tái chế',
};

export function binIcon(binCode: string): IconName {
  if (binCode === 'ORGANIC') return 'leaf';
  if (binCode === 'RECYCLABLE') return 'recycle';
  return 'trash';
}

interface BinOverviewCardProps {
  binCode: string;
  name: string;
  fillLevel: number;
  fillCategory: FillCategory;
  status: BinStatus;
  distanceCm?: number | null;
  capacity: number;
  location?: string;
  lastSeenLabel?: string;
  index?: number;
  onPress?: () => void;
}

/** Mobile counterpart of the web bin card. Status/colour come from backend fillCategory + status. */
export const BinOverviewCard: React.FC<BinOverviewCardProps> = ({
  binCode,
  name,
  fillLevel,
  fillCategory,
  status,
  distanceCm,
  capacity,
  location,
  lastSeenLabel,
  index = 0,
  onPress,
}) => {
  const level = Math.max(0, Math.min(100, fillLevel));
  const fillTone = FILL_TONE[fillCategory];
  const accent = Tones[fillTone];
  const title = BIN_DISPLAY_NAMES[binCode] || name || binCode;

  const body = (
    <View style={[styles.card, { borderTopColor: accent.solid }]}>
      <View style={styles.topRow}>
        <View style={[styles.iconBox, { backgroundColor: accent.bg, borderColor: accent.border }]}>
          <Icon name={binIcon(binCode)} size={18} color={accent.text} />
        </View>
        <View style={styles.titleCol}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.code} numberOfLines={1}>
            {binCode}
          </Text>
        </View>
        <Badge tone={BIN_STATUS_TONE[status]} label={BIN_STATUS_LABEL[status]} dot pulse={status === 'ONLINE'} />
      </View>

      <View style={styles.levelRow}>
        <Text style={[styles.percent, { color: Colors.textPrimary }]}>{level}%</Text>
        <Badge tone={fillTone} label={FILL_LABEL[fillCategory]} />
      </View>

      <AnimatedProgressBar value={level} tone={fillTone} height={9} />

      <View style={styles.facts}>
        <View style={styles.fact}>
          <Icon name="ruler" size={13} color={Colors.textMuted} />
          <Text style={styles.factText}>
            {distanceCm === null || distanceCm === undefined ? 'Chưa có dữ liệu' : `${distanceCm} cm`}
          </Text>
        </View>
        <View style={styles.fact}>
          <Icon name="box" size={13} color={Colors.textMuted} />
          <Text style={styles.factText}>{capacity.toLocaleString('vi-VN')} L</Text>
        </View>
      </View>

      {(location || lastSeenLabel) && (
        <View style={styles.metaRow}>
          {location ? (
            <View style={[styles.fact, { flex: 1 }]}>
              <Icon name="map-pin" size={13} color={Colors.textMuted} />
              <Text style={styles.metaText} numberOfLines={1}>
                {location}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {lastSeenLabel ? <Text style={styles.metaText}>{lastSeenLabel}</Text> : null}
        </View>
      )}

      {onPress && (
        <View style={styles.cta}>
          <Text style={styles.ctaText}>Xem chi tiết</Text>
          <Icon name="chevron-right" size={14} color={Colors.brandHighlight} />
        </View>
      )}
    </View>
  );

  return (
    <FadeIn delay={Math.min(index, 5) * 60} style={styles.wrapper}>
      {onPress ? (
        <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`Xem chi tiết ${title}`}>
          {body}
        </PressableScale>
      ) : (
        body
      )}
    </FadeIn>
  );
};

const styles = StyleSheet.create({
  wrapper: { marginBottom: Spacing.md },
  card: {
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderTopWidth: 2,
    backgroundColor: Colors.surfaceCard,
    ...Shadow.card,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBox: { width: 38, height: 38, borderRadius: Radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  titleCol: { flex: 1, minWidth: 0 },
  title: { color: Colors.textPrimary, fontSize: FontSize.base, fontWeight: '800' },
  code: { color: '#9AB1C4', fontSize: FontSize.micro, fontFamily: Mono, marginTop: 2 },
  levelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  percent: { fontSize: FontSize.display, fontWeight: '800', lineHeight: 34 },
  facts: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  factText: { color: Colors.textSecondary, fontSize: FontSize.small, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  metaText: { color: Colors.textMuted, fontSize: FontSize.caption, flexShrink: 1 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  ctaText: { color: Colors.brandHighlight, fontSize: FontSize.small, fontWeight: '800' },
});
