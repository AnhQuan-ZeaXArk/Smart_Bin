import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Colors, Tones, ToneName } from '../../constants/colors';
import { FontSize, Radius, Shadow, Spacing } from '../../constants/theme';
import { Icon, IconName } from './Icon';
import { PressableScale, StatusDot } from './motion';

/** Web `.surface-panel` / `.summary-card` equivalent. */
export const Card: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: ToneName }> = ({
  children,
  style,
  tone,
}) => (
  <View style={[styles.card, tone && { borderColor: Tones[tone].border }, style]}>{children}</View>
);

interface BadgeProps {
  tone: ToneName;
  label: string;
  dot?: boolean;
  pulse?: boolean;
}

/** Web `.status-badge`. */
export const Badge: React.FC<BadgeProps> = ({ tone, label, dot = false, pulse = false }) => {
  const t = Tones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]}>
      {dot && <StatusDot color={t.solid} pulse={pulse} size={5} />}
      <Text style={[styles.badgeText, { color: t.text }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

export const BrandMark: React.FC<{ size?: number }> = ({ size = 36 }) => (
  <View style={[styles.brandMark, { width: size, height: size, borderRadius: size * 0.25 }]}>
    <Text style={[styles.brandMarkText, { fontSize: size * 0.55 }]}>S</Text>
  </View>
);

export const BrandWord: React.FC<{ subtitle?: boolean }> = ({ subtitle = true }) => (
  <View>
    <Text style={styles.brandWord}>
      SMART<Text style={styles.brandWordAccent}>BIN</Text>
    </Text>
    {subtitle && <Text style={styles.brandSub}>Smart Waste Management</Text>}
  </View>
);

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Web `.button-primary` / `.button-secondary`. */
export const Button: React.FC<ButtonProps> = ({ label, onPress, variant = 'primary', icon, loading = false, disabled = false, style }) => {
  const inactive = disabled || loading;
  const palette =
    variant === 'primary'
      ? { bg: Colors.buttonPrimaryBg, border: '#18A57D', text: Colors.buttonPrimaryText }
      : variant === 'danger'
        ? { bg: '#312329', border: '#673B43', text: '#FF9B9B' }
        : { bg: Colors.buttonSecondaryBg, border: Colors.buttonSecondaryBorder, text: '#CFDAE4' };

  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[styles.button, { backgroundColor: palette.bg, borderColor: palette.border }, variant === 'primary' && !inactive && Shadow.raised, style]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.text} />
      ) : icon ? (
        <Icon name={icon} size={15} color={palette.text} />
      ) : null}
      <Text style={[styles.buttonText, { color: palette.text }]}>{label}</Text>
    </PressableScale>
  );
};

interface HeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

/** Mobile counterpart of web `.page-heading`. */
export const ScreenHeader: React.FC<HeaderProps> = ({ eyebrow, title, subtitle, onBack, right }) => (
  <View style={styles.header}>
    <View style={styles.headerRow}>
      {onBack && (
        <PressableScale onPress={onBack} accessibilityRole="button" accessibilityLabel="Quay lại" style={styles.iconButton}>
          <Icon name="chevron-left" size={20} color={Colors.textSecondary} />
        </PressableScale>
      )}
      <View style={styles.headerText}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  </View>
);

export const SectionHeader: React.FC<{ title: string; subtitle?: string; actionLabel?: string; onAction?: () => void }> = ({
  title,
  subtitle,
  actionLabel,
  onAction,
}) => (
  <View style={styles.sectionHeader}>
    <View style={{ flex: 1 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSub}>{subtitle}</Text> : null}
    </View>
    {actionLabel && onAction ? (
      <PressableScale onPress={onAction} accessibilityRole="button" style={styles.sectionAction}>
        <Text style={styles.sectionActionText}>{actionLabel}</Text>
        <Icon name="chevron-right" size={14} color={Colors.brandHighlight} />
      </PressableScale>
    ) : null}
  </View>
);

interface StateCardProps {
  kind: 'error' | 'empty';
  title: string;
  message?: string;
  icon?: IconName;
  onRetry?: () => void;
  onBack?: () => void;
}

/** Web `.state-panel`; used for every error and empty state so no screen is ever blank. */
export const StateCard: React.FC<StateCardProps> = ({ kind, title, message, icon, onRetry, onBack }) => {
  const isError = kind === 'error';
  return (
    <View style={[styles.stateCard, isError && styles.stateCardError]}>
      <Icon name={icon ?? (isError ? 'alert-triangle' : 'inbox')} size={26} color={isError ? '#FB777D' : '#5BC9A7'} />
      <Text style={styles.stateTitle}>{title}</Text>
      {message ? <Text style={styles.stateMessage}>{message}</Text> : null}
      {(onRetry || onBack) && (
        <View style={styles.stateActions}>
          {onRetry && <Button label="Thử lại" icon="refresh" variant="secondary" onPress={onRetry} />}
          {onBack && <Button label="Quay lại" variant="secondary" onPress={onBack} />}
        </View>
      )}
    </View>
  );
};

interface ChipProps<T extends string> {
  options: Array<{ key: T; label: string; count?: number }>;
  value: T;
  onChange: (key: T) => void;
}

/** Horizontal filter chips (web `.alert-filter-tabs`). */
export function FilterChips<T extends string>({ options, value, onChange }: ChipProps<T>) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map((option) => {
        const active = option.key === value;
        return (
          <PressableScale
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
            {option.count !== undefined && (
              <View style={[styles.chipCount, active && styles.chipCountActive]}>
                <Text style={[styles.chipCountText, active && styles.chipCountTextActive]}>{option.count}</Text>
              </View>
            )}
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

/** Search/text input with focus border + glow transition (web input:focus). */
export const SearchField: React.FC<TextInputProps & { icon?: IconName }> = ({ icon = 'search', style, ...rest }) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      <Icon name={icon} size={16} color={focused ? Colors.brandHighlight : Colors.textMuted} />
      <TextInput
        {...rest}
        placeholderTextColor="#697E91"
        style={[styles.fieldInput, style]}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    borderWidth: 1,
  },
  badgeText: { fontSize: FontSize.micro, fontWeight: '800', letterSpacing: 0.4 },
  brandMark: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#1FCB98' },
  brandMarkText: { color: '#052B23', fontWeight: '900' },
  brandWord: { color: '#F1F7FB', fontSize: 18, fontWeight: '800', letterSpacing: 0.3 },
  brandWordAccent: { color: Colors.success },
  brandSub: { color: Colors.textMuted, fontSize: FontSize.micro, marginTop: 2 },
  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  buttonText: { fontSize: FontSize.small, fontWeight: '800' },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerText: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#39CFA0', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  headerTitle: { color: Colors.textPrimary, fontSize: FontSize.heading, fontWeight: '800', marginTop: 2 },
  headerSub: { color: Colors.textMuted, fontSize: FontSize.small, marginTop: 3, lineHeight: 17 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md },
  sectionTitle: { color: Colors.textPrimary, fontSize: FontSize.base, fontWeight: '800' },
  sectionSub: { color: Colors.textMuted, fontSize: FontSize.caption, marginTop: 2 },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  sectionActionText: { color: Colors.brandHighlight, fontSize: FontSize.small, fontWeight: '700' },
  stateCard: {
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.xxl,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#33495D',
    backgroundColor: '#111F2F',
  },
  stateCardError: { borderColor: '#713D42', backgroundColor: '#241D27' },
  stateTitle: { color: Colors.textPrimary, fontSize: FontSize.base, fontWeight: '800', textAlign: 'center' },
  stateMessage: { color: Colors.textMuted, fontSize: FontSize.small, textAlign: 'center', lineHeight: 18 },
  stateActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  chipRow: { gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#111F2F',
  },
  chipActive: { borderColor: '#36536A', backgroundColor: '#1B3044' },
  chipText: { color: '#8EA2B4', fontSize: FontSize.small, fontWeight: '700' },
  chipTextActive: { color: Colors.textPrimary },
  chipCount: { minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#293E52' },
  chipCountActive: { backgroundColor: '#1F5E4D' },
  chipCountText: { color: '#B9CAD7', fontSize: 9, fontWeight: '800' },
  chipCountTextActive: { color: '#BFF5E0' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 42,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#30465A',
    backgroundColor: '#0D1A29',
  },
  fieldFocused: { borderColor: '#17AD84', backgroundColor: '#102033' },
  fieldInput: { flex: 1, color: Colors.textPrimary, fontSize: FontSize.body, paddingVertical: 8 },
});
