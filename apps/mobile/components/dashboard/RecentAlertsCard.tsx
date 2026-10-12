import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Tones } from '../../constants/colors';
import { FontSize, Mono, Radius, SEVERITY_TONE, Spacing } from '../../constants/theme';
import { DashboardAlert } from '../../types/dashboard';
import { ALERT_SEVERITY_LABELS } from '../../types/alert';
import { formatDateTime } from '../../utils/formatters';
import { Badge, Card, SectionHeader, StateCard } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { FadeIn } from '../ui/motion';

interface RecentAlertsCardProps {
  alerts: DashboardAlert[];
  onViewAllAlerts?: () => void;
}

export const RecentAlertsCard: React.FC<RecentAlertsCardProps> = ({
  alerts,
  onViewAllAlerts,
}) => {
  // Show active unresolved alerts, up to 5 items for clean mobile preview
  const previewAlerts = alerts.filter((a) => !a.isResolved).slice(0, 5);

  return (
    <Card style={styles.card}>
      <SectionHeader
        title="Cảnh báo gần đây"
        subtitle={previewAlerts.length > 0 ? `${previewAlerts.length} cảnh báo chưa xử lý` : 'Sự kiện cần chú ý từ các ngăn rác'}
        actionLabel={onViewAllAlerts ? 'Xem tất cả' : undefined}
        onAction={onViewAllAlerts}
      />

      {previewAlerts.length === 0 ? (
        <StateCard kind="empty" icon="check-circle" title="Không có cảnh báo chưa xử lý" message="Các thùng rác hiện không có sự kiện cần chú ý." />
      ) : (
        <View style={styles.alertList}>
          {previewAlerts.map((alert, index) => {
            const tone = SEVERITY_TONE[alert.severity] ?? 'info';
            const t = Tones[tone];
            return (
              <FadeIn key={alert.id} delay={index * 50}>
                <View style={[styles.alertItem, { borderLeftColor: t.solid }]}>
                  <View style={styles.alertTop}>
                    <Icon name={alert.severity === 'INFO' ? 'info' : 'alert-triangle'} size={15} color={t.text} />
                    <Badge tone={tone} label={ALERT_SEVERITY_LABELS[alert.severity] ?? alert.severity} />
                    {alert.bin?.binCode ? <Text style={styles.binCodeTag}>{alert.bin.binCode}</Text> : null}
                  </View>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                  <Text style={styles.alertTime}>{formatDateTime(alert.createdAt)}</Text>
                </View>
              </FadeIn>
            );
          })}
        </View>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: 16,
  },
  alertList: {
    gap: Spacing.sm,
  },
  alertItem: {
    gap: 6,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: Colors.border,
    backgroundColor: '#111F2F',
  },
  alertTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  binCodeTag: {
    marginLeft: 'auto',
    fontSize: FontSize.micro,
    color: '#9AB1C4',
    fontFamily: Mono,
    fontWeight: '700',
  },
  alertMessage: {
    fontSize: FontSize.body,
    color: Colors.textPrimary,
    lineHeight: 18,
    fontWeight: '600',
  },
  alertTime: {
    fontSize: FontSize.micro,
    color: Colors.textMuted,
    fontFamily: Mono,
  },
});
