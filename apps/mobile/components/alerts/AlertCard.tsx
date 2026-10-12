import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Colors, Tones } from '../../constants/colors';
import { FontSize, Mono, Radius, SEVERITY_TONE, Shadow, Spacing } from '../../constants/theme';
import { AlertItem, ALERT_SEVERITY_LABELS, ALERT_TYPE_LABELS } from '../../types/alert';
import { formatRelativeTime, formatDateTime } from '../../utils/formatters';
import { Badge } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { useReducedMotion } from '../ui/motion';

interface AlertCardProps {
  alert: AlertItem;
  /** True only for alerts that arrived after the list first loaded (realtime or refresh). */
  isNew?: boolean;
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, isNew = false }) => {
  const reduced = useReducedMotion();
  const enter = useRef(new Animated.Value(isNew ? 0 : 1)).current;
  const glow = useRef(new Animated.Value(isNew ? 1 : 0)).current;

  useEffect(() => {
    if (!isNew || reduced) {
      enter.setValue(1);
      glow.setValue(0);
      return;
    }
    const slide = Animated.timing(enter, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    const fade = Animated.timing(glow, { toValue: 0, duration: 1800, delay: 300, easing: Easing.out(Easing.quad), useNativeDriver: true });
    slide.start();
    fade.start();
    return () => {
      slide.stop();
      fade.stop();
    };
  }, [isNew, reduced, enter, glow]);

  const tone = SEVERITY_TONE[alert.severity] ?? 'info';
  const t = Tones[tone];
  const typeLabel = ALERT_TYPE_LABELS[alert.type] || alert.type;
  const binName = alert.bin?.name || alert.bin?.binCode;

  return (
    <Animated.View
      style={[
        styles.card,
        { borderLeftColor: t.solid },
        alert.isResolved && styles.cardResolved,
        {
          opacity: enter,
          transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }],
        },
      ]}
    >
      <Animated.View pointerEvents="none" style={[styles.glow, { opacity: glow }]} />

      <View style={styles.topRow}>
        <View style={[styles.iconBox, { backgroundColor: t.bg, borderColor: t.border }]}>
          <Icon name={alert.severity === 'INFO' ? 'info' : 'alert-triangle'} size={15} color={t.text} />
        </View>
        <Text style={styles.typeLabel} numberOfLines={1}>
          {typeLabel}
        </Text>
        <Badge tone={tone} label={ALERT_SEVERITY_LABELS[alert.severity] ?? alert.severity} />
      </View>

      <Text style={styles.messageText}>{alert.message}</Text>

      {(binName || alert.deviceId) && (
        <View style={styles.resourceRow}>
          {binName ? (
            <View style={styles.resource}>
              <Icon name="trash" size={12} color={Colors.textMuted} />
              <Text style={styles.resourceText} numberOfLines={1}>
                {binName}
              </Text>
            </View>
          ) : null}
          {alert.deviceId ? (
            <View style={styles.resource}>
              <Icon name="cpu" size={12} color={Colors.textMuted} />
              <Text style={styles.resourceText} numberOfLines={1}>
                {alert.deviceId}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      <View style={styles.footerRow}>
        <Badge tone={alert.isResolved ? 'normal' : 'monitor'} label={alert.isResolved ? 'Đã xử lý' : 'Chưa xử lý'} dot />
        <View style={styles.timeContainer}>
          <Text style={styles.relativeTimeText}>{formatRelativeTime(alert.createdAt)}</Text>
          <Text style={styles.fullTimeText}>{formatDateTime(alert.createdAt)}</Text>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: Spacing.sm + 2,
    padding: Spacing.md + 2,
    marginBottom: Spacing.sm + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: Colors.border,
    backgroundColor: '#142438',
    ...Shadow.card,
  },
  cardResolved: {
    opacity: 0.7,
  },
  glow: {
    ...StyleSheet.absoluteFill,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.cyan,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeLabel: {
    flex: 1,
    fontSize: FontSize.body,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  messageText: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 20,
    fontWeight: '600',
  },
  resourceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
  },
  resource: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
  },
  resourceText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontFamily: Mono,
    flexShrink: 1,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  timeContainer: {
    alignItems: 'flex-end',
  },
  relativeTimeText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
    fontWeight: '700',
  },
  fullTimeText: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 1,
  },
});
