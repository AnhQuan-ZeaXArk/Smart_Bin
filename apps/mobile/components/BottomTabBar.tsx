import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { useNavigation, Screen } from '../hooks/useNavigation';

export const BottomTabBar: React.FC = () => {
  const { currentScreen, navigate } = useNavigation();
  const insets = useSafeAreaInsets();

  // If on detail screen, hide bottom tab bar to maximize workspace
  if (currentScreen === 'bin-detail') {
    return null;
  }

  const tabs: Array<{ screen: Screen; label: string; icon: string }> = [
    {
      screen: 'dashboard',
      label: 'Tổng quan',
      icon: '📊',
    },
    {
      screen: 'bins',
      label: 'Thùng rác',
      icon: '🗑️',
    },
    {
      screen: 'devices',
      label: 'Thiết bị',
      icon: '⚡',
    },
    {
      screen: 'alerts',
      label: 'Thông báo',
      icon: '🔔',
    },
    {
      screen: 'collections',
      label: 'Lịch sử',
      icon: '📋',
    },
  ];

  // Dynamically calculate bottom padding so tab bar safely clears Android gesture bar / 3-button navigation
  const bottomPadding = Math.max(insets.bottom, 8);

  return (
    <View style={[styles.container, { paddingBottom: bottomPadding }]}>
      {tabs.map((tab) => {
        const isActive = currentScreen === tab.screen;
        return (
          <TouchableOpacity
            key={tab.screen}
            style={[styles.tabButton, isActive && styles.tabButtonActive]}
            activeOpacity={0.7}
            onPress={() => navigate(tab.screen)}
          >
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text
              style={[
                styles.tabLabel,
                isActive && styles.tabLabelActive,
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
            {isActive && <View style={styles.activeIndicator} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 6,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 6,
  },
  tabButtonActive: {},
  tabIcon: {
    fontSize: 15,
    marginBottom: 2,
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
    bottom: 0,
    width: 24,
    height: 3,
    backgroundColor: Colors.brandHighlight,
    borderRadius: 2,
  },
});
