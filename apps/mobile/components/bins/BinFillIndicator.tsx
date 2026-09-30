import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { FillCategory } from '../../types/dashboard';

interface BinFillIndicatorProps {
  fillLevel: number;
  fillCategory?: FillCategory;
  showLabel?: boolean;
  barHeight?: number;
}

export function getFillTone(level: number, category?: FillCategory) {
  if (level > 90 || category === 'CRITICAL') {
    return {
      bar: Colors.error,
      bg: 'rgba(239, 68, 68, 0.15)',
      text: Colors.error,
      label: 'Đầy (> 90%)',
    };
  }
  if (level > 75 || category === 'NEARLY_FULL') {
    return {
      bar: '#F97316',
      bg: 'rgba(249, 115, 22, 0.15)',
      text: '#FB923C',
      label: 'Gần đầy (76% – 90%)',
    };
  }
  if (level > 50 || category === 'MONITOR') {
    return {
      bar: Colors.warning,
      bg: 'rgba(245, 158, 11, 0.15)',
      text: Colors.warning,
      label: 'Cần chú ý (51% – 75%)',
    };
  }
  return {
    bar: Colors.brandHighlight,
    bg: 'rgba(16, 185, 129, 0.15)',
    text: Colors.brandHighlight,
    label: 'Bình thường (≤ 50%)',
  };
}

export const BinFillIndicator: React.FC<BinFillIndicatorProps> = ({
  fillLevel,
  fillCategory,
  showLabel = true,
  barHeight = 8,
}) => {
  const percentage = Math.min(100, Math.max(0, fillLevel));
  const tone = getFillTone(percentage, fillCategory);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.levelText}>Mức đầy</Text>
        <Text style={[styles.percentageText, { color: tone.text }]}>
          {percentage}%
        </Text>
      </View>

      <View style={[styles.track, { height: barHeight }]}>
        <View
          style={[
            styles.fillBar,
            {
              width: `${percentage}%`,
              backgroundColor: tone.bar,
              height: barHeight,
            },
          ]}
        />
      </View>

      {showLabel && (
        <View style={styles.footerRow}>
          <Text style={[styles.labelText, { color: tone.text }]}>{tone.label}</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 6,
  },
  levelText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  percentageText: {
    fontSize: 18,
    fontWeight: '800',
  },
  track: {
    backgroundColor: '#334155',
    borderRadius: 4,
    overflow: 'hidden',
    width: '100%',
  },
  fillBar: {
    borderRadius: 4,
  },
  footerRow: {
    marginTop: 4,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
