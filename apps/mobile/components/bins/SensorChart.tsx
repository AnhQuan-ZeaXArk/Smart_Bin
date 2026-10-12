import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';
import { Colors } from '../../constants/colors';
import { FontSize } from '../../constants/theme';
import { SensorReadingItem } from '../../types/dashboard';

const HEIGHT = 130;
const PAD_X = 6;
const PAD_Y = 8;

/** Fill-level area chart drawn only from the readings the API returned (oldest -> newest). */
export const SensorChart: React.FC<{ readings: SensorReadingItem[] }> = ({ readings }) => {
  const [width, setWidth] = useState(0);

  const points = useMemo(() => {
    const ordered = [...readings].reverse();
    const innerW = Math.max(1, width - PAD_X * 2);
    const innerH = HEIGHT - PAD_Y * 2;
    return ordered.map((reading, i) => ({
      x: PAD_X + (ordered.length === 1 ? innerW / 2 : (i / (ordered.length - 1)) * innerW),
      y: PAD_Y + (1 - Math.max(0, Math.min(100, reading.fillLevel)) / 100) * innerH,
    }));
  }, [readings, width]);

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = points.length > 1 ? `${line} L${points[points.length - 1].x.toFixed(1)} ${HEIGHT - PAD_Y} L${points[0].x.toFixed(1)} ${HEIGHT - PAD_Y} Z` : '';
  const last = points[points.length - 1];

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={styles.wrap}>
      {width > 0 && points.length > 0 && (
        <Svg width={width} height={HEIGHT}>
          <Defs>
            <LinearGradient id="fillGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#10B981" stopOpacity="0.32" />
              <Stop offset="1" stopColor="#10B981" stopOpacity="0.02" />
            </LinearGradient>
          </Defs>
          {[0, 50, 100].map((v) => {
            const y = PAD_Y + (1 - v / 100) * (HEIGHT - PAD_Y * 2);
            return <Line key={v} x1={PAD_X} x2={width - PAD_X} y1={y} y2={y} stroke="#26394D" strokeWidth={1} strokeDasharray="3 5" />;
          })}
          {area ? <Path d={area} fill="url(#fillGradient)" /> : null}
          {points.length > 1 ? <Path d={line} stroke="#10B981" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
          {last ? <Circle cx={last.x} cy={last.y} r={4} fill="#47DBA8" stroke="#0B1728" strokeWidth={2} /> : null}
        </Svg>
      )}
      <View style={styles.axis}>
        <Text style={styles.axisText}>0%</Text>
        <Text style={styles.axisText}>Mức đầy theo thời gian đo</Text>
        <Text style={styles.axisText}>100%</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisText: { color: Colors.textMuted, fontSize: FontSize.micro },
});
