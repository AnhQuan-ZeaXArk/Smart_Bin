import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Colors } from '../constants/colors';
import { Config } from '../constants/config';
import { StatusBadge } from './StatusBadge';
import { ConnectionStatus, HealthResponse } from '../types/api';
import { formatTime, formatLatency } from '../utils/formatters';

interface ConnectionCardProps {
  status: ConnectionStatus;
  data: HealthResponse | null;
  errorMessage: string | null;
  lastCheckedAt: Date | null;
  latencyMs: number | null;
  isLoading: boolean;
  onCheck: () => void;
}

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  status,
  data,
  errorMessage,
  lastCheckedAt,
  latencyMs,
  isLoading,
  onCheck,
}) => {
  const isConnected = status === 'connected';
  const isError = status === 'error';

  return (
    <View style={styles.card}>
      {/* Card Header */}
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardSubtitle}>KẾT NỐI HỆ THỐNG</Text>
          <Text style={styles.cardTitle}>Backend API Status</Text>
        </View>
        <StatusBadge status={status} />
      </View>

      {/* Target URL Info */}
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Máy chủ đích:</Text>
        <Text style={styles.infoValue} numberOfLines={1} ellipsizeMode="middle">
          {Config.apiUrl}
        </Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Endpoint kiểm tra:</Text>
        <Text style={styles.endpointBadge}>GET /health</Text>
      </View>

      {/* Status Details / Results */}
      <View style={styles.resultBox}>
        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Colors.info} />
            <Text style={styles.loadingText}>Đang gửi yêu cầu đến máy chủ...</Text>
          </View>
        )}

        {!isLoading && isConnected && (
          <View style={styles.successContainer}>
            <View style={styles.successIconCircle}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <View style={styles.successDetails}>
              <Text style={styles.successTitle}>Backend đang hoạt động</Text>
              <Text style={styles.successSub}>
                Dịch vụ: {data?.service || 'smartbin-api'} • Trạng thái: {data?.status}
              </Text>
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  Độ trễ: <Text style={styles.metaHighlight}>{formatLatency(latencyMs)}</Text>
                </Text>
                <Text style={styles.metaDivider}>•</Text>
                <Text style={styles.metaText}>
                  Lần kiểm tra cuối: {formatTime(lastCheckedAt)}
                </Text>
              </View>
            </View>
          </View>
        )}

        {!isLoading && isError && (
          <View style={styles.errorContainer}>
            <View style={styles.errorIconCircle}>
              <Text style={styles.errorIconText}>!</Text>
            </View>
            <View style={styles.errorDetails}>
              <Text style={styles.errorTitle}>Không thể kết nối đến máy chủ</Text>
              <Text style={styles.errorMessage}>{errorMessage}</Text>
              {lastCheckedAt && (
                <Text style={styles.errorMeta}>
                  Thời gian thử: {formatTime(lastCheckedAt)} • Độ trễ: {formatLatency(latencyMs)}
                </Text>
              )}
            </View>
          </View>
        )}

        {!isLoading && status === 'idle' && (
          <View style={styles.idleContainer}>
            <Text style={styles.idleText}>
              Nhấn nút bên dưới để bắt đầu kiểm tra giao tiếp với máy chủ SmartBin.
            </Text>
          </View>
        )}
      </View>

      {/* Action Button: Kiểm tra kết nối */}
      <TouchableOpacity
        style={[styles.button, isLoading && styles.buttonDisabled]}
        onPress={onCheck}
        disabled={isLoading}
        activeOpacity={0.8}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.buttonPrimaryText} />
        ) : (
          <Text style={styles.buttonText}>
            {isError ? 'Thử lại kết nối' : 'Kiểm tra kết nối'}
          </Text>
        )}
      </TouchableOpacity>
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  cardSubtitle: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    marginTop: 2,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  infoLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 12,
    color: Colors.info,
    fontFamily: 'monospace',
    maxWidth: '65%',
  },
  endpointBadge: {
    fontSize: 12,
    color: Colors.brandHighlight,
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  resultBox: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 12,
    marginVertical: 12,
    minHeight: 88,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginLeft: 10,
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  successIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.successLight,
    borderWidth: 1,
    borderColor: Colors.successBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  successIconText: {
    color: Colors.success,
    fontSize: 15,
    fontWeight: '900',
  },
  successDetails: {
    flex: 1,
  },
  successTitle: {
    color: Colors.success,
    fontSize: 15,
    fontWeight: '700',
  },
  successSub: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  metaText: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  metaHighlight: {
    color: Colors.brandHighlight,
    fontWeight: '600',
  },
  metaDivider: {
    fontSize: 11,
    color: Colors.textMuted,
    marginHorizontal: 6,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  errorIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  errorIconText: {
    color: Colors.error,
    fontSize: 16,
    fontWeight: '900',
  },
  errorDetails: {
    flex: 1,
  },
  errorTitle: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '700',
  },
  errorMessage: {
    color: Colors.textSecondary,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 17,
  },
  errorMeta: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'monospace',
  },
  idleContainer: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  idleText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  button: {
    backgroundColor: Colors.buttonPrimaryBg,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    backgroundColor: Colors.buttonDisabledBg,
    opacity: 0.7,
  },
  buttonText: {
    color: Colors.buttonPrimaryText,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
