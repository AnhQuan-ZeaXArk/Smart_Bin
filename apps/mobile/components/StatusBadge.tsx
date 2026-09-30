import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { ConnectionStatus } from '../types/api';

interface StatusBadgeProps {
  status: ConnectionStatus;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  let badgeText = 'Chưa kiểm tra';
  let dotColor = Colors.textMuted;
  let bgStyle = styles.badgeIdle;
  let textStyle = styles.textIdle;

  switch (status) {
    case 'connected':
      badgeText = 'Connected (Đã kết nối)';
      dotColor = Colors.success;
      bgStyle = styles.badgeConnected;
      textStyle = styles.textConnected;
      break;
    case 'checking':
      badgeText = 'Đang kiểm tra...';
      dotColor = Colors.warning;
      bgStyle = styles.badgeChecking;
      textStyle = styles.textChecking;
      break;
    case 'error':
      badgeText = 'Not Connected (Mất kết nối)';
      dotColor = Colors.error;
      bgStyle = styles.badgeError;
      textStyle = styles.textError;
      break;
    default:
      badgeText = 'Chờ kiểm tra';
      dotColor = Colors.textMuted;
      bgStyle = styles.badgeIdle;
      textStyle = styles.textIdle;
  }

  return (
    <View style={[styles.badge, bgStyle]}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[styles.text, textStyle]}>{badgeText}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  badgeConnected: {
    backgroundColor: Colors.successLight,
    borderColor: Colors.successBorder,
  },
  textConnected: {
    color: Colors.success,
  },
  badgeChecking: {
    backgroundColor: Colors.warningLight,
    borderColor: Colors.warningBorder,
  },
  textChecking: {
    color: Colors.warning,
  },
  badgeError: {
    backgroundColor: Colors.errorLight,
    borderColor: Colors.errorBorder,
  },
  textError: {
    color: Colors.error,
  },
  badgeIdle: {
    backgroundColor: Colors.surfaceCardElevated,
    borderColor: Colors.border,
  },
  textIdle: {
    color: Colors.textSecondary,
  },
});
