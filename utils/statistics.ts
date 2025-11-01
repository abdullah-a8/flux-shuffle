/**
 * Statistics Utility
 *
 * Aggregates listening statistics across all tracked playlists.
 * Provides global stats for display in the Profile tab.
 *
 * Data Accuracy:
 * - Single source of truth: AsyncStorage with smart_shuffle_* keys
 * - Real-time aggregation from validated playlist memories
 * - Validated with FNV-1a hash checking for playlist changes
 * - Atomic updates ensure data consistency
 */

import { getTrackedPlaylists, getPlaylistProgress, loadShuffleMemory } from './smartShuffle';
import type { ShuffleStats } from './smartShuffle';

/**
 * Global statistics across all tracked playlists
 */
export interface GlobalStats {
  totalHeard: number;           // Total songs heard across all playlists
  playlistCount: number;        // Number of playlists being tracked
  totalCycles: number;          // Total complete cycles across all playlists
  mostPlayed: {
    playlistId: string;
    cycleNumber: number;
    played: number;
  } | null;
}

/**
 * Get aggregated statistics across all tracked playlists
 *
 * This function:
 * 1. Gets all playlist IDs that have shuffle memory
 * 2. For each playlist, fetches progress stats
 * 3. Aggregates: total heard, playlist count, total cycles
 * 4. Finds most played playlist (highest cycle number)
 *
 * Data Accuracy Guarantee:
 * - Only includes playlists with validated memory
 * - Skips playlists with errors or invalid data
 * - Uses same validation as smart shuffle system
 * - Real-time data from AsyncStorage
 *
 * @returns GlobalStats object with aggregated data
 */
export async function getGlobalStats(): Promise<GlobalStats> {
  try {
    // Get all tracked playlist IDs
    const playlistIds = await getTrackedPlaylists();

    if (playlistIds.length === 0) {
      return {
        totalHeard: 0,
        playlistCount: 0,
        totalCycles: 0,
        mostPlayed: null,
      };
    }

    // Aggregate stats from all playlists
    let totalHeard = 0;
    let totalCycles = 0;
    let mostPlayed: { playlistId: string; cycleNumber: number; played: number } | null = null;

    // Fetch progress for each playlist and aggregate
    // Use getPlaylistProgress which correctly handles totalTracks
    const progressPromises = playlistIds.map(async (playlistId) => {
      try {
        // Load memory to get totalTracks
        const memory = await loadShuffleMemory(playlistId);
        if (!memory) {
          return { playlistId, progress: null };
        }

        // Use the standard getPlaylistProgress function for consistency
        const progress = await getPlaylistProgress(playlistId, memory.totalTracks);

        return { playlistId, progress };
      } catch (error) {
        console.warn(`[Statistics] Failed to get progress for ${playlistId}:`, error);
        return { playlistId, progress: null };
      }
    });

    const results = await Promise.all(progressPromises);

    // Aggregate data
    for (const { playlistId, progress } of results) {
      if (!progress) continue;

      totalHeard += progress.played;
      totalCycles += progress.cycleNumber;

      // Track most played (highest cycle number, or most played in current cycle)
      if (!mostPlayed || progress.cycleNumber > mostPlayed.cycleNumber) {
        mostPlayed = {
          playlistId,
          cycleNumber: progress.cycleNumber,
          played: progress.played,
        };
      } else if (progress.cycleNumber === mostPlayed.cycleNumber && progress.played > mostPlayed.played) {
        // If same cycle number, use the one with more plays in current cycle
        mostPlayed = {
          playlistId,
          cycleNumber: progress.cycleNumber,
          played: progress.played,
        };
      }
    }

    return {
      totalHeard,
      playlistCount: playlistIds.length,
      totalCycles,
      mostPlayed,
    };
  } catch (error) {
    console.error('[Statistics] Error getting global stats:', error);
    return {
      totalHeard: 0,
      playlistCount: 0,
      totalCycles: 0,
      mostPlayed: null,
    };
  }
}

/**
 * Get detailed stats for a specific playlist
 *
 * @param playlistId - The playlist ID
 * @param totalTracks - Total tracks in the playlist
 * @returns ShuffleStats or null if not tracked
 */
export async function getPlaylistStats(
  playlistId: string,
  totalTracks: number
): Promise<ShuffleStats | null> {
  return getPlaylistProgress(playlistId, totalTracks);
}
