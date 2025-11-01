/**
 * Stats Card Component
 *
 * Displays aggregate listening statistics in the Profile tab.
 * Shows total songs heard, playlists tracked, cycles completed, and most played playlist.
 *
 * Design Philosophy:
 * - Minimal & Modern: Clean card design matching ProfileTab aesthetic
 * - Functional: Every stat is meaningful and accurate
 * - Coherent: Follows existing design system (colors, spacing, typography)
 * - Smooth: Animated entrance with Reanimated for 60fps performance
 */

import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Music, ListMusic, RotateCw, Star } from 'lucide-react-native';
import type { GlobalStats } from '@/utils/statistics';
import { useSpotify } from '@/contexts/SpotifyContext';

interface StatsCardProps {
  stats: GlobalStats | null | undefined;
  isLoading?: boolean;
}

/**
 * Individual stat row component with icon, label, and value
 */
function StatRow({
  icon: Icon,
  label,
  value,
  delay = 0,
}: {
  icon: React.ComponentType<any>;
  label: string;
  value: string | number;
  delay?: number;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: 400, easing: Easing.bezier(0.25, 0.1, 0.25, 1) })
    );
    translateY.value = withDelay(
      delay,
      withSpring(0, { damping: 15, stiffness: 120 })
    );
    // Shared values are stable and don't need to be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.statRow, animatedStyle]}>
      <View style={styles.iconContainer}>
        <Icon size={20} color="#1DB954" />
      </View>
      <View style={styles.statContent}>
        <Text style={styles.statLabel}>{label}</Text>
        <Text style={styles.statValue}>{value}</Text>
      </View>
    </Animated.View>
  );
}

/**
 * Main StatsCard Component
 */
export default function StatsCard({ stats, isLoading }: StatsCardProps) {
  const { allPlaylistsWithLiked } = useSpotify();

  // Card entrance animations
  const cardOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.95);

  useEffect(() => {
    cardOpacity.value = withTiming(1, { duration: 300 });
    cardScale.value = withSpring(1, { damping: 15, stiffness: 150 });
    // Shared values are stable and don't need to be in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  // Find playlist name for most played
  const getMostPlayedName = (): string => {
    if (!stats?.mostPlayed) return 'N/A';

    const playlist = allPlaylistsWithLiked.find(
      (p) => p.id === stats.mostPlayed?.playlistId
    );

    return playlist?.name || 'Unknown Playlist';
  };

  // Empty state - no playlists tracked yet
  if (!isLoading && (!stats || stats.playlistCount === 0)) {
    return (
      <Animated.View style={[styles.card, cardAnimatedStyle]}>
        <View style={styles.header}>
          <Text style={styles.title}>Listening Statistics</Text>
          <Music size={20} color="#1DB954" />
        </View>

        <View style={styles.emptyState}>
          <View style={styles.emptyIconContainer}>
            <Music size={32} color="#666" />
          </View>
          <Text style={styles.emptyTitle}>Start Listening</Text>
          <Text style={styles.emptyText}>
            Queue your first playlist to see your stats here
          </Text>
        </View>
      </Animated.View>
    );
  }

  // Loading state
  if (isLoading || !stats) {
    return (
      <Animated.View style={[styles.card, cardAnimatedStyle]}>
        <View style={styles.header}>
          <Text style={styles.title}>Listening Statistics</Text>
          <Music size={20} color="#1DB954" />
        </View>

        <View style={styles.loadingState}>
          <Text style={styles.loadingText}>Loading stats...</Text>
        </View>
      </Animated.View>
    );
  }

  // Main content - show stats
  return (
    <Animated.View style={[styles.card, cardAnimatedStyle]}>
      <View style={styles.header}>
        <Text style={styles.title}>Listening Statistics</Text>
        <Music size={20} color="#1DB954" />
      </View>

      <View style={styles.statsContainer}>
        <StatRow
          icon={Music}
          label="Songs Heard"
          value={stats.totalHeard.toLocaleString()}
          delay={0}
        />

        <StatRow
          icon={ListMusic}
          label="Playlists Tracked"
          value={stats.playlistCount}
          delay={50}
        />

        <StatRow
          icon={RotateCw}
          label="Complete Cycles"
          value={stats.totalCycles}
          delay={100}
        />

        {stats.mostPlayed && (
          <StatRow
            icon={Star}
            label="Most Played"
            value={getMostPlayedName()}
            delay={150}
          />
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0a0a0a',
    marginHorizontal: 24,
    marginBottom: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.3,
  },
  statsContainer: {
    gap: 20,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(29, 185, 84, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  statContent: {
    flex: 1,
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 24,
    color: '#fff',
    fontWeight: '700',
    letterSpacing: -0.5,
  },

  // Empty state styles
  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(102, 102, 102, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },

  // Loading state styles
  loadingState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
});
