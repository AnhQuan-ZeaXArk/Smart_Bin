import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
} from 'react-native';
import { Colors, Tones } from '../constants/colors';
import { FontSize, Radius, Shadow, Spacing } from '../constants/theme';
import { useAuth } from '../hooks/useAuth';
import { BrandMark, BrandWord, Button } from './ui/kit';
import { Icon, IconName } from './ui/Icon';
import { FadeIn, PressableScale } from './ui/motion';

interface FieldProps {
  label: string;
  icon: IconName;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editable: boolean;
  invalid?: boolean;
  secure?: boolean;
  onSubmitEditing?: () => void;
  returnKeyType?: 'next' | 'done';
  trailing?: React.ReactNode;
}

const Field: React.FC<FieldProps> = ({
  label,
  icon,
  value,
  onChangeText,
  placeholder,
  editable,
  invalid,
  secure,
  onSubmitEditing,
  returnKeyType,
  trailing,
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={[styles.field, focused && styles.fieldFocused, invalid && styles.fieldInvalid]}>
        <Icon name={icon} size={16} color={focused ? Colors.brandHighlight : Colors.textMuted} />
        <TextInput
          style={styles.fieldInput}
          placeholder={placeholder}
          placeholderTextColor="#697E91"
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          editable={editable}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {trailing}
      </View>
    </View>
  );
};

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
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FadeIn style={styles.brandContainer}>
          <BrandMark size={52} />
          <View style={styles.brandText}>
            <BrandWord subtitle={false} />
          </View>
        </FadeIn>
        <FadeIn delay={100} style={styles.subtitleWrap}>
          <Text style={styles.subtitle}>Smart Waste Management</Text>
        </FadeIn>

        <FadeIn delay={180} distance={18}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Đăng nhập</Text>
            <Text style={styles.cardSub}>Truy cập không gian vận hành</Text>

            {errorMessage ? (
              <View style={styles.errorBox} accessibilityRole="alert">
                <Icon name="alert-triangle" size={15} color={Tones.critical.text} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            <Field
              label="Tên đăng nhập"
              icon="user"
              placeholder="Nhập tên đăng nhập"
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                if (errorMessage) setErrorMessage(null);
              }}
              editable={!isSubmitting}
              invalid={!!errorMessage && !username.trim()}
              returnKeyType="next"
            />

            <Field
              label="Mật khẩu"
              icon="lock"
              placeholder="Nhập mật khẩu"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (errorMessage) setErrorMessage(null);
              }}
              secure={!showPassword}
              editable={!isSubmitting}
              invalid={!!errorMessage && !password}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              trailing={
                <PressableScale
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={18} color={Colors.textSecondary} />
                </PressableScale>
              }
            />

            <Button
              label={isSubmitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
              onPress={handleSubmit}
              loading={isSubmitting}
              style={styles.submit}
            />
          </View>
        </FadeIn>
      </ScrollView>
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
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xxl,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  brandText: {
    justifyContent: 'center',
  },
  subtitleWrap: {
    alignItems: 'center',
    marginTop: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  subtitle: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: Colors.surfaceCard,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadow.card,
  },
  cardTitle: {
    fontSize: FontSize.title,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  cardSub: {
    fontSize: FontSize.small,
    color: Colors.textSecondary,
    marginTop: 2,
    marginBottom: Spacing.lg,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Tones.critical.bg,
    borderWidth: 1,
    borderColor: Tones.critical.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  errorText: {
    color: Tones.critical.text,
    fontSize: FontSize.small,
    fontWeight: '600',
    flex: 1,
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: Spacing.lg,
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: FontSize.small,
    fontWeight: '700',
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 46,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  fieldFocused: {
    borderColor: Colors.brandHighlight,
    backgroundColor: '#0F1C2B',
  },
  fieldInvalid: {
    borderColor: Tones.critical.solid,
  },
  fieldInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: FontSize.body,
    paddingVertical: 0,
  },
  submit: {
    marginTop: Spacing.sm,
    height: 48,
  },
});
