import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { DashboardSummary, DashboardDevice, DashboardAlert } from '../../types/dashboard';

interface SummaryCardsProps {
  summary: DashboardSummary;
  devices: DashboardDevice[];
  alerts: DashboardAlert[];
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ summary, devices, alerts }) => {
  const onlineDevices = devices.filter((d) => d.status === 'ONLINE').length;
  const activeAlerts = alerts.filter((a) => !a.isResolved).length;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>TỔNG QUAN HỆ THỐNG</Text>

      <View style={styles.grid}>
        {/* Card 1: Tổng số thùng */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Tổng số thùng</Text>
          <Text style={styles.cardNumber}>{summary.total}</Text>
          <Text style={styles.cardSub}>Đang hoạt động</Text>
        </View>

        {/* Card 2: Cảnh báo chưa xử lý */}
        <View style={[styles.card, activeAlerts > 0 && styles.cardAlert]}>
          <Text style={styles.cardLabel}>Cảnh báo</Text>
          <Text style={[styles.cardNumber, activeAlerts > 0 && styles.numberAlert]}>
            {activeAlerts}
          </Text>
          <Text style={styles.cardSub}>
            {activeAlerts > 0 ? 'Cần xử lý ngay' : 'Bình thường'}
          </Text>
        </View>

        {/* Card 3: Thùng đầy / Cần thu gom */}
        <View style={[styles.card, summary.full > 0 && styles.cardWarning]}>
          <Text style={styles.cardLabel}>Thùng đầy</Text>
          <Text style={[styles.cardNumber, summary.full > 0 && styles.numberWarning]}>
            {summary.full}
          </Text>
          <Text style={styles.cardSub}>
            {summary.full > 0 ? 'Cần thu gom' : 'Chưa cần gom'}
          </Text>
        </View>

        {/* Card 4: Thiết bị Online */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Thiết bị IoT</Text>
          <Text style={styles.cardNumber}>
            {onlineDevices}
            <Text style={styles.cardDenominator}>/{devices.length || 4}</Text>
          </Text>
          <Text style={styles.cardSub}>Trực tuyến</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    flex: 1,
    minWidth: '47%',
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardAlert: {
    borderColor: Colors.errorBorder,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  cardWarning: {
    borderColor: Colors.warningBorder,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  cardNumber: {
    fontSize: 24,
    fontWeight: '900',
    color: Colors.textPrimary,
  },
  cardDenominator: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  numberAlert: {
    color: Colors.error,
  },
  numberWarning: {
    color: Colors.warning,
  },
  cardSub: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 4,
  },
});
