import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { User, RoleName } from '../../types/auth';
import { formatTime } from '../../utils/formatters';

interface DashboardHeaderProps {
  user: User | null;
  lastUpdated?: Date;
  onLogout: () => void;
  isLoggingOut?: boolean;
}

function getRoleLabel(role?: RoleName): string {
  switch (role) {
    case 'ADMIN':
      return 'Quản trị viên (Admin)';
    case 'SUPERVISOR':
      return 'Giám sát viên (Supervisor)';
    case 'WORKER':
      return 'Nhân viên thu gom (Worker)';
    default:
      return 'Người dùng';
  }
}

function getRoleBadgeColors(role?: RoleName) {
  switch (role) {
    case 'ADMIN':
      return {
        bg: 'rgba(16, 185, 129, 0.15)',
        text: Colors.brandHighlight,
        border: Colors.brandPrimary,
      };
    case 'SUPERVISOR':
      return {
        bg: 'rgba(245, 158, 11, 0.15)',
        text: Colors.warning,
        border: Colors.warningBorder,
      };
    case 'WORKER':
      return {
        bg: 'rgba(56, 189, 248, 0.15)',
        text: Colors.info,
        border: Colors.infoBorder,
      };
    default:
      return {
        bg: Colors.surfaceCard,
        text: Colors.textSecondary,
        border: Colors.border,
      };
  }
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  user,
  lastUpdated,
  onLogout,
  isLoggingOut = false,
}) => {
  const roleColors = getRoleBadgeColors(user?.role);

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={styles.brandBadge}>
          <Text style={styles.brandBadgeText}>SMARTBIN</Text>
        </View>
        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={onLogout}
          disabled={isLoggingOut}
          activeOpacity={0.7}
        >
          <Text style={styles.logoutBtnText}>
            {isLoggingOut ? 'Đang thoát...' : 'Đăng xuất'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.profileRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {user?.username?.slice(0, 2).toUpperCase() || 'SB'}
          </Text>
        </View>
        <View style={styles.profileInfo}>
          <Text style={styles.greeting}>Xin chào,</Text>
          <Text style={styles.displayName} numberOfLines={1}>
            {user?.displayName || user?.username || 'Vận hành viên'}
          </Text>
          <View
            style={[
              styles.roleBadge,
              { backgroundColor: roleColors.bg, borderColor: roleColors.border },
            ]}
          >
            <Text style={[styles.roleText, { color: roleColors.text }]}>
              {getRoleLabel(user?.role)}
            </Text>
          </View>
        </View>
      </View>

      {lastUpdated && (
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            Cập nhật lúc: <Text style={styles.metaHighlight}>{formatTime(lastUpdated)}</Text> (Kéo xuống để làm mới)
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  brandBadge: {
    backgroundColor: Colors.brandPrimary,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  brandBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  logoutBtn: {
    backgroundColor: Colors.surfaceCard,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  logoutBtnText: {
    color: Colors.error,
    fontSize: 11,
    fontWeight: '700',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.brandPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
  },
  profileInfo: {
    flex: 1,
  },
  greeting: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  displayName: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    marginTop: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  metaRow: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  metaText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  metaHighlight: {
    color: Colors.brandHighlight,
    fontWeight: '600',
  },
});
