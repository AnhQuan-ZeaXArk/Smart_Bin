import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { useNavigation, Screen } from '../hooks/useNavigation';
import { Icon, IconName } from './ui/Icon';
import { useReducedMotion } from './ui/motion';

const TabItem: React.FC<{ label: string; icon: IconName; active: boolean; onPress: () => void }> = ({
  label,
  icon,
  active,
  onPress,
}) => {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(active ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, reduced, progress]);

  return (
    <Pressable
      style={styles.tabButton}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Animated.View
        style={[
          styles.activeIndicator,
          { opacity: progress, transform: [{ scaleX: progress.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }] },
        ]}
      />
      <Animated.View style={{ transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -1] }) }] }}>
        <Icon name={icon} size={20} color={active ? Colors.brandHighlight : Colors.textMuted} />
      </Animated.View>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
};

export const BottomTabBar: React.FC = () => {
  const { currentScreen, navigate } = useNavigation();
  const insets = useSafeAreaInsets();

  // If on detail screen, hide bottom tab bar to maximize workspace
  if (currentScreen === 'bin-detail') {
    return null;
  }

  const tabs: Array<{ screen: Screen; label: string; icon: IconName }> = [
    { screen: 'dashboard', label: 'Tổng quan', icon: 'dashboard' },
    { screen: 'bins', label: 'Thùng rác', icon: 'trash' },
    { screen: 'devices', label: 'Thiết bị', icon: 'device' },
    { screen: 'alerts', label: 'Thông báo', icon: 'bell' },
    { screen: 'collections', label: 'Lịch sử', icon: 'history' },
  ];

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {tabs.map((tab) => (
        <TabItem
          key={tab.screen}
          label={tab.label}
          icon={tab.icon}
          active={currentScreen === tab.screen}
          onPress={() => navigate(tab.screen)}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  tabButton: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  tabLabel: {
    fontSize: 10.5,
    color: Colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  tabLabelActive: {
    color: Colors.brandHighlight,
    fontWeight: '800',
  },
  activeIndicator: {
    position: 'absolute',
    top: 0,
    width: 28,
    height: 3,
    backgroundColor: Colors.success,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
  },
});
