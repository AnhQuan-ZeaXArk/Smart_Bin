import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { Colors, Tones, ToneName } from '../../constants/colors';

/** Tracks the OS reduce-motion setting; animations collapse to instant when it is on. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
}

/** Fade + translateY entrance (opacity/transform only, native driver). */
export const FadeIn: React.FC<FadeInProps> = ({ children, delay = 0, duration = 320, distance = 10, style }) => {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      progress.setValue(1);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reduced, progress, delay, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
};

interface PressableScaleProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  children: React.ReactNode;
}

/** Press feedback: scale to ~0.98 like web :active. */
export const PressableScale: React.FC<PressableScaleProps> = ({ style, scaleTo = 0.98, children, disabled, ...rest }) => {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) =>
    Animated.timing(scale, { toValue: value, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        to(scaleTo);
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        rest.onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }, disabled && styles.disabled]}>{children}</Animated.View>
    </Pressable>
  );
};

interface ProgressBarProps {
  value: number;
  tone: ToneName;
  height?: number;
  duration?: number;
}

/** Fill bar animated 0 -> value (and to new values) with translateX, so no layout-driven animation. */
export const AnimatedProgressBar: React.FC<ProgressBarProps> = ({ value, tone, height = 8, duration = 700 }) => {
  const reduced = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  const progress = useRef(new Animated.Value(0)).current;
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (reduced) {
      progress.setValue(pct / 100);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: pct / 100,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [pct, reduced, progress, duration]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      onLayout={onLayout}
      style={[styles.track, { height, borderRadius: height / 2 }]}
    >
      {width > 0 && (
        <Animated.View
          style={{
            width,
            height,
            borderRadius: height / 2,
            backgroundColor: Tones[tone].solid,
            transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }],
          }}
        />
      )}
    </View>
  );
};

/** Status dot; ONLINE gets a slow soft ring pulse, others stay static. */
export const StatusDot: React.FC<{ color: string; pulse?: boolean; size?: number }> = ({ color, pulse = false, size = 8 }) => {
  const reduced = useReducedMotion();
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pulse || reduced) {
      ring.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(ring, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced, ring]);

  return (
    <View style={{ width: size * 2, height: size * 2, alignItems: 'center', justifyContent: 'center' }}>
      {pulse && !reduced && (
        <Animated.View
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
            opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }],
          }}
        />
      )}
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
};

interface SkeletonProps {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** Shimmer placeholder (slow opacity breathe); stops when unmounted. */
export const Skeleton: React.FC<SkeletonProps> = ({ height = 16, width = '100%', radius = 8, style }) => {
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse]);

  return (
    <Animated.View
      style={[
        { height, width, borderRadius: radius, backgroundColor: Colors.surfaceHover, borderWidth: 1, borderColor: Colors.border },
        { opacity: reduced ? 0.7 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.85] }) },
        style,
      ]}
    />
  );
};

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#26394B',
  },
  disabled: {
    opacity: 0.55,
  },
});
