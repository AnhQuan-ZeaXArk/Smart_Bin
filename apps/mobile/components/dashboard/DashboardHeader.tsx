import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { FontSize, Radius, Spacing } from '../../constants/theme';
import { User, RoleName } from '../../types/auth';
import { RealtimeConnectionStatus } from '../../types/alert';
import { formatTime } from '../../utils/formatters';
import { Badge, BrandMark, BrandWord } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { PressableScale } from '../ui/motion';
import { RealtimeStatusBadge } from '../alerts/RealtimeStatusBadge';
import { ToneName } from '../../constants/colors';

interface DashboardHeaderProps {
  user?: User | null;
  lastUpdated?: Date;
  onLogout?: () => void;
  isLoggingOut?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  realtimeStatus?: RealtimeConnectionStatus;
}

function getRoleLabel(role?: RoleName): string {
  switch (role) {
    case 'ADMIN':
      return 'Quản trị viên';
    case 'SUPERVISOR':
      return 'Giám sát viên';
    case 'WORKER':
      return 'Nhân viên thu gom';
    default:
      return 'Người dùng';
  }
}

function getRoleTone(role?: RoleName): ToneName {
  switch (role) {
    case 'ADMIN':
      return 'normal';
    case 'SUPERVISOR':
      return 'monitor';
    case 'WORKER':
      return 'info';
    default:
      return 'neutral';
  }
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  lastUpdated,
  onRefresh,
  isRefreshing = false,
  realtimeStatus,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.brand}>
          <BrandMark size={34} />
          <BrandWord />
        </View>
      </View>

      <View style={styles.profileRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>SB</Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.greeting}>Hệ thống SmartBin</Text>
          <Text style={styles.displayName} numberOfLines={1}>
            Bảng điều khiển Demo
          </Text>
        </View>
        <Badge tone="normal" label="Demo Mode" />
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          {realtimeStatus ? <RealtimeStatusBadge status={realtimeStatus} /> : null}
          {lastUpdated ? (
            <Text style={styles.metaText} numberOfLines={1}>
              Cập nhật <Text style={styles.metaHighlight}>{formatTime(lastUpdated)}</Text>
            </Text>
          ) : null}
        </View>
        {onRefresh && (
          <PressableScale
            onPress={onRefresh}
            disabled={isRefreshing}
            accessibilityRole="button"
            accessibilityLabel="Làm mới dữ liệu"
            style={styles.refreshBtn}
          >
            <Icon name="refresh" size={14} color={Colors.brandHighlight} />
            <Text style={styles.refreshText}>{isRefreshing ? 'Đang làm mới' : 'Làm mới'}</Text>
          </PressableScale>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#673B43',
    backgroundColor: '#312329',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#3B5B6C',
    backgroundColor: '#183145',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#BBF7E5',
    fontSize: FontSize.base,
    fontWeight: '800',
  },
  profileInfo: {
    flex: 1,
    minWidth: 0,
  },
  greeting: {
    color: Colors.textMuted,
    fontSize: FontSize.caption,
  },
  displayName: {
    color: Colors.textPrimary,
    fontSize: FontSize.title,
    fontWeight: '800',
    marginTop: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  metaLeft: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  metaText: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
  },
  metaHighlight: {
    color: Colors.brandHighlight,
    fontWeight: '700',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.buttonSecondaryBorder,
    backgroundColor: Colors.buttonSecondaryBg,
  },
  refreshText: {
    color: '#CFDAE4',
    fontSize: FontSize.small,
    fontWeight: '700',
  },
});
