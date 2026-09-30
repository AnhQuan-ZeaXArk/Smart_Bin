import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { Colors } from '../constants/colors';
import { useAuth } from '../hooks/useAuth';

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (isSubmitting) return;
    Keyboard.dismiss();

    // Field validations
    if (!username.trim()) {
      setErrorMessage('Vui lòng nhập tên đăng nhập.');
      return;
    }

    if (!password) {
      setErrorMessage('Vui lòng nhập mật khẩu.');
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await login(username.trim(), password);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : '';
      if (
        msg.includes('Invalid credentials') ||
        msg.includes('không chính xác') ||
        msg.includes('401')
      ) {
        setErrorMessage('Tên đăng nhập hoặc mật khẩu không chính xác.');
      } else if (
        msg.includes('Không thể kết nối') ||
        msg.includes('timeout') ||
        msg.includes('quá thời gian')
      ) {
        setErrorMessage('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng Internet.');
      } else {
        setErrorMessage('Đăng nhập không thành công. Vui lòng thử lại sau.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardContainer}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand Header */}
          <View style={styles.brandContainer}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>SMARTBIN</Text>
            </View>
            <Text style={styles.systemTitle}>HỆ THỐNG QUẢN LÝ THÙNG RÁC THÔNG MINH</Text>
            <Text style={styles.subtitle}>Đăng nhập để truy cập không gian vận hành</Text>
          </View>

          {/* Login Card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>ĐĂNG NHẬP VẬN HÀNH</Text>

            {/* Error Banner */}
            {errorMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>!</Text>
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Username Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Tên đăng nhập</Text>
              <TextInput
                style={[
                  styles.input,
                  errorMessage && !username.trim() ? styles.inputErrorBorder : null,
                ]}
                placeholder="Nhập tên đăng nhập"
                placeholderTextColor={Colors.textMuted}
                value={username}
                onChangeText={(text) => {
                  setUsername(text);
                  if (errorMessage) setErrorMessage(null);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!isSubmitting}
              />
            </View>

            {/* Password Input with Show/Hide Toggle */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Mật khẩu</Text>
              <View style={styles.passwordContainer}>
                <TextInput
                  style={[
                    styles.input,
                    styles.passwordInput,
                    errorMessage && !password ? styles.inputErrorBorder : null,
                  ]}
                  placeholder="Nhập mật khẩu"
                  placeholderTextColor={Colors.textMuted}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isSubmitting}
                />
                <TouchableOpacity
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.eyeText}>{showPassword ? 'Ẩn' : 'Hiện'}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Submit Button */}
            <TouchableOpacity
              style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
              activeOpacity={0.8}
            >
              {isSubmitting ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>Đang đăng nhập...</Text>
                </View>
              ) : (
                <Text style={styles.submitButtonText}>ĐĂNG NHẬP</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Security & Role Information */}
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>PHÂN QUYỀN TRUY CẬP</Text>
            <Text style={styles.infoText}>
              Hệ thống áp dụng chính sách bảo mật đa vai trò: Quản trị viên (Admin), Giám sát viên (Supervisor) và Nhân viên thu gom (Worker).
            </Text>
            <View style={styles.securityNote}>
              <Text style={styles.securityDot}>🔒</Text>
              <Text style={styles.securityText}>
                Xác thực bảo mật qua JWT và lưu trữ mã hóa trên thiết bị (Android Keystore).
              </Text>
            </View>
          </View>

          <Text style={styles.footerText}>
            © 2026 SmartBin Management System • All rights reserved
          </Text>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  brandContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  badge: {
    backgroundColor: Colors.brandPrimary,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 8,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  systemTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.brandHighlight,
    letterSpacing: 1,
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.errorBorder,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorIcon: {
    color: Colors.error,
    fontWeight: '900',
    fontSize: 14,
    marginRight: 8,
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Colors.textPrimary,
    fontSize: 14,
  },
  inputErrorBorder: {
    borderColor: Colors.error,
  },
  passwordContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: 56,
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: Colors.surfaceCardElevated,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  eyeText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: Colors.buttonPrimaryBg,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  submitButtonDisabled: {
    backgroundColor: Colors.buttonDisabledBg,
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: 16,
  },
  infoTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    letterSpacing: 1,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  securityDot: {
    fontSize: 12,
  },
  securityText: {
    fontSize: 11,
    color: Colors.brandHighlight,
    flex: 1,
  },
  footerText: {
    color: Colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
  },
});
