import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import {
  AlertItem,
  AlertSeverity,
  ALERT_SEVERITY_LABELS,
  ALERT_TYPE_LABELS,
} from '../../types/alert';
import { formatRelativeTime, formatDateTime } from '../../utils/formatters';

interface AlertCardProps {
  alert: AlertItem;
}

function getSeverityConfig(severity: AlertSeverity) {
  switch (severity) {
    case 'CRITICAL':
      return {
        label: ALERT_SEVERITY_LABELS.CRITICAL,
        color: Colors.error,
        bg: Colors.errorLight,
        border: Colors.errorBorder,
        icon: '🚨',
      };
    case 'WARNING':
      return {
        label: ALERT_SEVERITY_LABELS.WARNING,
        color: Colors.warning,
        bg: Colors.warningLight,
        border: Colors.warningBorder,
        icon: '⚠️',
      };
    case 'INFO':
    default:
      return {
        label: ALERT_SEVERITY_LABELS.INFO,
        color: Colors.info,
        bg: Colors.infoLight,
        border: Colors.infoBorder,
        icon: 'ℹ️',
      };
  }
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert }) => {
  const severityConfig = getSeverityConfig(alert.severity);
  const typeLabel = ALERT_TYPE_LABELS[alert.type] || alert.type;
  const binName = alert.bin?.name || alert.bin?.binCode;

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: alert.isResolved ? Colors.border : severityConfig.border,
          backgroundColor: alert.isResolved
            ? Colors.surfaceCard
            : 'rgba(30, 41, 59, 0.95)',
        },
      ]}
    >
      {/* Top Row: Type & Severity Badge */}
      <View style={styles.topRow}>
        <View style={styles.typeContainer}>
          <Text style={styles.typeIcon}>{severityConfig.icon}</Text>
          <Text style={styles.typeLabel}>{typeLabel}</Text>
        </View>

        <View
          style={[
            styles.severityBadge,
            {
              backgroundColor: severityConfig.bg,
              borderColor: severityConfig.border,
            },
          ]}
        >
          <Text style={[styles.severityText, { color: severityConfig.color }]}>
            {severityConfig.label}
          </Text>
        </View>
      </View>

      {/* Alert Message */}
      <Text style={styles.messageText}>{alert.message}</Text>

      {/* Associated Resource Meta */}
      {(binName || alert.deviceId) && (
        <View style={styles.resourceRow}>
          {binName && (
            <Text style={styles.resourceText}>
              📍 Ngăn rác: <Text style={styles.resourceHighlight}>{binName}</Text>
            </Text>
          )}
          {alert.deviceId && (
            <Text style={styles.resourceText}>
              🖥️ Thiết bị: <Text style={styles.resourceHighlight}>{alert.deviceId}</Text>
            </Text>
          )}
        </View>
      )}

      {/* Footer Row: Resolution Status & Timestamp */}
      <View style={styles.footerRow}>
        <View style={styles.statusTag}>
          {alert.isResolved ? (
            <Text style={styles.resolvedText}>✓ Đã xử lý</Text>
          ) : (
            <Text style={[styles.activeText, { color: severityConfig.color }]}>
              ● Đang kích hoạt
            </Text>
          )}
        </View>

        <View style={styles.timeContainer}>
          <Text style={styles.relativeTimeText}>
            {formatRelativeTime(alert.createdAt)}
          </Text>
          <Text style={styles.fullTimeText}>
            {formatDateTime(alert.createdAt)}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    marginBottom: 12,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  typeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  typeIcon: {
    fontSize: 15,
    marginRight: 6,
  },
  typeLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.2,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  messageText: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  resourceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 8,
  },
  resourceText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  resourceHighlight: {
    color: Colors.brandHighlight,
    fontWeight: '700',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(51, 65, 85, 0.3)',
  },
  statusTag: {
    paddingVertical: 2,
  },
  resolvedText: {
    fontSize: 11,
    color: Colors.success,
    fontWeight: '700',
  },
  activeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  timeContainer: {
    alignItems: 'flex-end',
  },
  relativeTimeText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  fullTimeText: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 1,
  },
});
