/**
 * Playlist Progress Indicator Component
 *
 * A minimal, non-distracting progress visualization for playlist cards.
 * Shows at-a-glance progress with:
 * - Subtle progress border wrapping around the squircle album art
 * - Optional cycle indicator
 *
 * Design Philosophy:
 * - Minimal visual weight - doesn't compete with playlist artwork
 * - Wraps around the squircle shape to match the art's border radius
 * - Coherent with existing design system (Spotify green, dark theme)
 * - Glanceable information hierarchy - progress is intuitive without numbers
 * - Smooth animations using Reanimated
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import type { ShuffleStats } from '@/utils/smartShuffle';

interface PlaylistProgressIndicatorProps {
  stats: ShuffleStats | null;
  size?: number;
  strokeWidth?: number;
  borderRadius?: number;
}

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedView = Animated.View;

export default function PlaylistProgressIndicator({
  stats,
  size = 60,
  strokeWidth = 3,
  borderRadius = 8,
}: PlaylistProgressIndicatorProps) {
  // Shared values for animations - must be at top level
  const animatedProgress = useSharedValue(0);
  const cycleOpacity = useSharedValue(0);
  const cycleScale = useSharedValue(0.8);

  const progress = stats ? stats.percentage / 100 : 0; // 0 to 1

  // Calculate perimeter for rounded rectangle
  // Perimeter = 4 sides minus corners + arc length of 4 corners
  const rectWidth = size - strokeWidth;
  const rectHeight = size - strokeWidth;
  const cornerRadius = borderRadius;
  const straightSideLength = (rectWidth - 2 * cornerRadius) * 2 + (rectHeight - 2 * cornerRadius) * 2;
  const arcLength = 2 * Math.PI * cornerRadius;
  const perimeter = straightSideLength + arcLength;

  // Animate progress on mount and when stats change
  useEffect(() => {
    if (stats && stats.played > 0) {
      animatedProgress.value = withTiming(progress, {
        duration: 800,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      });

      if (stats.cycleNumber > 0) {
        cycleOpacity.value = withTiming(1, { duration: 400 });
        cycleScale.value = withSpring(1, { damping: 15, stiffness: 150 });
      }
    } else {
      cycleOpacity.value = withTiming(0, { duration: 200 });
    }
    // Shared values are stable and don't need to be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, stats]);

  // Animated props for the progress border
  const animatedProps = useAnimatedProps(() => {
    const strokeDashoffset = perimeter * (1 - animatedProgress.value);
    return {
      strokeDashoffset,
    };
  });

  // Animated cycle badge style
  const cycleStyle = useAnimatedStyle(() => {
    return {
      opacity: cycleOpacity.value,
      transform: [{ scale: cycleScale.value }],
    };
  });

  // Don't show anything if no stats or no progress
  if (!stats || stats.played === 0) {
    return null;
  }

  // Determine color based on progress
  const getProgressColor = () => {
    if (progress >= 1) return '#FFD700'; // Gold for complete
    return '#1DB954'; // Spotify green for in-progress
  };

  const progressColor = getProgressColor();
  const showCycleIndicator = stats.cycleNumber > 0;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* SVG Progress Border */}
      <Svg width={size} height={size} style={styles.svg}>
        <Defs>
          <LinearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={progressColor} stopOpacity="1" />
            <Stop offset="100%" stopColor={progressColor} stopOpacity="0.7" />
          </LinearGradient>
        </Defs>

        {/* Background border */}
        <Rect
          x={strokeWidth / 2}
          y={strokeWidth / 2}
          width={rectWidth}
          height={rectHeight}
          rx={cornerRadius}
          ry={cornerRadius}
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={strokeWidth}
          fill="none"
        />

        {/* Progress border */}
        <AnimatedRect
          x={strokeWidth / 2}
          y={strokeWidth / 2}
          width={rectWidth}
          height={rectHeight}
          rx={cornerRadius}
          ry={cornerRadius}
          stroke="url(#progressGradient)"
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={perimeter}
          strokeLinecap="round"
          animatedProps={animatedProps}
        />
      </Svg>

      {/* Cycle Indicator (if completed cycles exist) */}
      {showCycleIndicator && (
        <AnimatedView style={[styles.cycleBadge, cycleStyle]}>
          <Text style={styles.cycleText}>×{stats.cycleNumber}</Text>
        </AnimatedView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none', // Allow touches to pass through to the album art
  },
  svg: {
    position: 'absolute',
  },
  cycleBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    backgroundColor: 'rgba(255, 215, 0, 0.95)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  cycleText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});
