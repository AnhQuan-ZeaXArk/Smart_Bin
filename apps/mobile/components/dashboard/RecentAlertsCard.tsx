import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { DashboardAlert, AlertSeverity } from '../../types/dashboard';
import { formatTime, formatDate } from '../../utils/formatters';

interface RecentAlertsCardProps {
  alerts: DashboardAlert[];
  onViewAllAlerts?: () => void;
}

function getSeverityBadge(severity: AlertSeverity) {
  switch (severity) {
    case 'CRITICAL':
      return {
        label: 'Nghiêm trọng',
        color: Colors.error,
        bg: Colors.errorLight,
        border: Colors.errorBorder,
      };
    case 'WARNING':
      return {
        label: 'Cảnh báo',
        color: Colors.warning,
        bg: Colors.warningLight,
        border: Colors.warningBorder,
      };
    case 'INFO':
    default:
      return {
        label: 'Thông tin',
        color: Colors.info,
        bg: Colors.infoLight,
        border: Colors.infoBorder,
      };
  }
}

export const RecentAlertsCard: React.FC<RecentAlertsCardProps> = ({
  alerts,
  onViewAllAlerts,
}) => {
  // Show active unresolved alerts, up to 5 items for clean mobile preview
  const previewAlerts = alerts.filter((a) => !a.isResolved).slice(0, 5);

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>CẢNH BÁO GẦN ĐÂY</Text>
          <Text style={styles.subtitle}>Sự kiện cần chú ý từ các ngăn rác</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.countBadge}>
            {previewAlerts.length > 0 ? `${previewAlerts.length} cảnh báo` : 'An toàn'}
          </Text>
          {onViewAllAlerts && (
            <TouchableOpacity
              style={styles.viewAllButton}
              activeOpacity={0.7}
              onPress={onViewAllAlerts}
            >
              <Text style={styles.viewAllText}>Xem tất cả →</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {previewAlerts.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyIcon}>✓</Text>
          <Text style={styles.emptyText}>Hiện không có cảnh báo nào chưa xử lý.</Text>
          <Text style={styles.emptySub}>Tất cả các thùng rác đều ở trạng thái bình thường.</Text>
        </View>
      ) : (
        <View style={styles.alertList}>
          {previewAlerts.map((alert) => {
            const severityMeta = getSeverityBadge(alert.severity);
            const alertDate = alert.createdAt ? new Date(alert.createdAt) : null;

            return (
              <View key={alert.id} style={styles.alertItem}>
                <View style={styles.alertTop}>
                  <View
                    style={[
                      styles.severityBadge,
                      {
                        backgroundColor: severityMeta.bg,
                        borderColor: severityMeta.border,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.severityText, { color: severityMeta.color }]}
                    >
                      {severityMeta.label}
                    </Text>
                  </View>

                  {alert.bin?.binCode && (
                    <Text style={styles.binCodeTag}>Ngăn: {alert.bin.binCode}</Text>
                  )}
                </View>

                <Text style={styles.alertMessage}>{alert.message}</Text>

                <Text style={styles.alertTime}>
                  {formatDate(alertDate)} lúc {formatTime(alertDate)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1.2,
  },
  subtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  countBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  viewAllButton: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  viewAllText: {
    fontSize: 11,
    color: Colors.brandHighlight,
    fontWeight: '700',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 18,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  emptyIcon: {
    fontSize: 22,
    color: Colors.success,
    marginBottom: 6,
    fontWeight: '900',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  emptySub: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  alertList: {
    gap: 10,
  },
  alertItem: {
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  alertTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  binCodeTag: {
    fontSize: 10,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  alertMessage: {
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 18,
    fontWeight: '500',
  },
  alertTime: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 6,
    fontFamily: 'monospace',
  },
});
