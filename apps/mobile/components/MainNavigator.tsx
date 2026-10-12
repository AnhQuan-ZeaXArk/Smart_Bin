import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';
import { useNavigation } from '../hooks/useNavigation';
import { HomeScreen } from './HomeScreen';
import { BinsScreen } from './bins/BinsScreen';
import { BinDetailScreen } from './bins/BinDetailScreen';
import { DeviceHealthScreen } from './device/DeviceHealthScreen';
import { AlertScreen } from './alerts/AlertScreen';
import { CollectionHistoryScreen } from './collection/CollectionHistoryScreen';
import { BottomTabBar } from './BottomTabBar';
import { FadeIn } from './ui/motion';

export const MainNavigator: React.FC = () => {
  const { currentScreen, params } = useNavigation();

  return (
    <View style={styles.container}>
      <FadeIn key={`${currentScreen}:${params?.binId ?? ''}`} style={styles.screenContainer} duration={260} distance={8}>
        {currentScreen === 'dashboard' && <HomeScreen />}
        {currentScreen === 'bins' && <BinsScreen />}
        {currentScreen === 'devices' && <DeviceHealthScreen />}
        {currentScreen === 'alerts' && <AlertScreen />}
        {currentScreen === 'collections' && <CollectionHistoryScreen />}
        {currentScreen === 'bin-detail' && (
          <BinDetailScreen
            binId={params?.binId || ''}
            binCode={params?.binCode}
            binName={params?.binName}
          />
        )}
      </FadeIn>
      <BottomTabBar />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  screenContainer: {
    flex: 1,
  },
});
