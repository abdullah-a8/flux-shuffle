/**
 * Smart Shuffle with Memory
 * 
 * Implements an intelligent shuffle algorithm that ensures all songs in a playlist
 * are played before any song repeats. Uses client-side storage to track playback history.
 * 
 * Features:
 * - Adaptive set sizing based on playlist size
 * - Playlist change detection (songs added/removed)
 * - Cycle tracking (how many times user has heard full playlist)
 * - Persistent state across app sessions
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { trueRandomShuffle } from './spotify';
import type { SpotifyTrack } from '@/types/spotify';

// ============================================================================
// Types & Interfaces
// ============================================================================

/**
 * Memory state stored for each playlist
 */
interface ShuffleMemory {
  playlistId: string;
  playlistHash: string;        // Fingerprint to detect playlist changes
  playedTrackIds: string[];    // Track IDs that have been played in current cycle
  cycleNumber: number;          // How many complete cycles through the playlist
  totalTracks: number;          // Total tracks in playlist when last shuffled
  lastUpdated: number;          // Timestamp of last shuffle
}

/**
 * Statistics about current shuffle state
 */
export interface ShuffleStats {
  played: number;               // Number of tracks played in current cycle
  remaining: number;            // Number of tracks remaining in current cycle
  cycleComplete: boolean;       // Whether cycle just completed (all songs played)
  cycleNumber: number;          // Current cycle number
  percentage: number;           // Percentage of playlist heard (0-100)
}

/**
 * Result returned from smart shuffle operation
 */
export interface SmartShuffleResult {
  tracks: SpotifyTrack[];       // Shuffled tracks to queue
  stats: ShuffleStats;          // Current shuffle statistics
}

// ============================================================================
// Constants
// ============================================================================

const STORAGE_PREFIX = 'smart_shuffle_';

/**
 * In-memory lock to prevent race conditions during concurrent shuffle operations
 * Maps playlist ID to a promise that resolves when the operation completes
 */
const shuffleLocks = new Map<string, Promise<any>>();

/**
 * Get AsyncStorage key for a playlist
 */
const getStorageKey = (playlistId: string): string => `${STORAGE_PREFIX}${playlistId}`;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Generate a fingerprint/hash of the playlist to detect changes
 * Uses: total count + samples from 4 key positions (start, 1/3, 2/3, end)
 * This is more robust for detecting adds/removes/reorders in the middle
 */
function generatePlaylistHash(tracks: SpotifyTrack[]): string {
  if (tracks.length === 0) return '0____';

  // Sample tracks at key positions to better detect changes
  const positions = [
    0,
    Math.floor(tracks.length / 3),
    Math.floor(tracks.length * 2 / 3),
    tracks.length - 1
  ];

  const samples = positions
    .map(i => tracks[i]?.id || '')
    .join('_');

  return `${tracks.length}_${samples}`;
}

/**
 * Calculate optimal set size based on playlist size
 * Strategy:
 * - Small playlists (≤150): Queue everything
 * - Medium playlists (≤500): Split into 2 sets
 * - Large playlists (≤1500): Split into 3 sets
 * - Huge playlists (>1500): Split into 4+ sets, capped at 400 per set
 */
function calculateOptimalSetSize(totalTracks: number): number {
  if (totalTracks <= 150) {
    // Small playlists: queue everything in one go
    return totalTracks;
  } else if (totalTracks <= 500) {
    // Medium playlists: 2 sets
    return Math.floor(totalTracks / 2);
  } else if (totalTracks <= 1500) {
    // Large playlists: 3 sets
    return Math.floor(totalTracks / 3);
  } else {
    // Huge playlists: 4+ sets, but cap at 400 to avoid queueing too long
    return Math.min(400, Math.floor(totalTracks / 4));
  }
}

/**
 * Load shuffle memory from AsyncStorage
 * Returns null if no memory exists for this playlist
 */
async function loadShuffleMemory(playlistId: string): Promise<ShuffleMemory | null> {
  try {
    const jsonValue = await AsyncStorage.getItem(getStorageKey(playlistId));
    
    if (jsonValue === null) {
      return null;
    }
    
    const memory = JSON.parse(jsonValue) as ShuffleMemory;
    console.log(`[SmartShuffle] Loaded memory for ${playlistId}: ${memory.playedTrackIds.length}/${memory.totalTracks} played`);
    
    return memory;
  } catch (error) {
    console.error('[SmartShuffle] Error loading memory:', error);
    return null;
  }
}

/**
 * Save shuffle memory to AsyncStorage
 */
async function saveShuffleMemory(memory: ShuffleMemory): Promise<void> {
  try {
    const jsonValue = JSON.stringify(memory);
    await AsyncStorage.setItem(getStorageKey(memory.playlistId), jsonValue);
    
    console.log(`[SmartShuffle] Saved memory for ${memory.playlistId}: ${memory.playedTrackIds.length}/${memory.totalTracks} played`);
  } catch (error) {
    console.error('[SmartShuffle] Error saving memory:', error);
  }
}

/**
 * Create a fresh memory state for a new playlist or cycle reset
 */
function createFreshMemory(playlistId: string, tracks: SpotifyTrack[], cycleNumber: number = 0): ShuffleMemory {
  return {
    playlistId,
    playlistHash: generatePlaylistHash(tracks),
    playedTrackIds: [],
    cycleNumber,
    totalTracks: tracks.length,
    lastUpdated: Date.now(),
  };
}

// ============================================================================
// Main Smart Shuffle Function
// ============================================================================

/**
 * Get smartly shuffled tracks with memory
 * 
 * This is the main function that orchestrates the smart shuffle logic:
 * 1. Loads existing memory (or creates new)
 * 2. Detects playlist changes
 * 3. Filters out already-played tracks
 * 4. Checks for cycle completion
 * 5. Shuffles unplayed tracks
 * 6. Returns optimal set size
 * 7. Saves updated memory
 * 
 * @param playlistId - Unique identifier for the playlist
 * @param allTracks - All tracks in the playlist
 * @returns Promise with shuffled tracks and statistics
 */
export async function getSmartShuffledTracks(
  playlistId: string,
  allTracks: SpotifyTrack[]
): Promise<SmartShuffleResult> {
  
  // Validate input
  if (!playlistId) {
    throw new Error('[SmartShuffle] playlistId is required');
  }
  
  if (!allTracks || allTracks.length === 0) {
    console.warn('[SmartShuffle] No tracks provided');
    return {
      tracks: [],
      stats: {
        played: 0,
        remaining: 0,
        cycleComplete: false,
        cycleNumber: 0,
        percentage: 0,
      },
    };
  }

  // Race condition protection: If a shuffle is already in progress for this playlist, wait for it
  if (shuffleLocks.has(playlistId)) {
    console.log(`[SmartShuffle] Another shuffle operation in progress for ${playlistId}, waiting...`);
    await shuffleLocks.get(playlistId);
    console.log(`[SmartShuffle] Previous operation completed, proceeding with new shuffle`);
  }

  // Create a promise for this operation and store it
  let releaseLock: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  shuffleLocks.set(playlistId, lockPromise);

  try {
    console.log(`[SmartShuffle] Starting smart shuffle for ${playlistId} with ${allTracks.length} tracks`);

    // Step 1: Load existing memory or create fresh
    let memory = await loadShuffleMemory(playlistId);
    
    if (!memory) {
      console.log('[SmartShuffle] No existing memory found, creating fresh state');
      memory = createFreshMemory(playlistId, allTracks);
    }

    // Step 2: Detect playlist changes (songs added/removed)
    const currentHash = generatePlaylistHash(allTracks);
    const playlistChanged = memory.playlistHash !== currentHash;

    if (playlistChanged) {
      console.log('[SmartShuffle] Playlist changed detected (songs added/removed), resetting memory');
      console.log(`  Old: ${memory.playlistHash}`);
      console.log(`  New: ${currentHash}`);

      // Reset memory but keep cycle number
      memory = createFreshMemory(playlistId, allTracks, memory.cycleNumber);
    }

    // Step 3: Clean up orphaned track IDs (tracks that were removed from playlist)
    // This MUST happen before filtering unplayed tracks for accurate stats
    const currentTrackIds = new Set(allTracks.map(t => t.id));
    const orphanedIds = memory.playedTrackIds.filter(id => !currentTrackIds.has(id));

    if (orphanedIds.length > 0) {
      console.log(`[SmartShuffle] Removing ${orphanedIds.length} orphaned track IDs from memory`);
      memory.playedTrackIds = memory.playedTrackIds.filter(id => currentTrackIds.has(id));
    }

    // Step 4: Filter to get unplayed tracks (after orphan cleanup for accurate counts)
    const playedSet = new Set(memory.playedTrackIds);
    const unplayedTracks = allTracks.filter(track => !playedSet.has(track.id));

    console.log(`[SmartShuffle] Unplayed tracks: ${unplayedTracks.length}/${allTracks.length}`);

    // Step 5: Check if cycle is complete (all songs have been played)
    if (unplayedTracks.length === 0) {
      console.log('✨ [SmartShuffle] Cycle complete! All songs have been played. Starting fresh cycle...');

      // Increment cycle counter and reset
      const newCycleNumber = memory.cycleNumber + 1;
      memory = createFreshMemory(playlistId, allTracks, newCycleNumber);

      // CRITICAL: Save fresh memory to AsyncStorage BEFORE recursing
      // This prevents race conditions where the recursive call might load stale data
      await saveShuffleMemory(memory);

      // Recurse with fresh state to get tracks for new cycle
      const result = await getSmartShuffledTracks(playlistId, allTracks);

      // Mark that cycle was just completed
      result.stats.cycleComplete = true;

      return result;
    }

    // Step 6: Calculate how many tracks to return
    const setSize = calculateOptimalSetSize(allTracks.length);
    const tracksToReturn = Math.min(setSize, unplayedTracks.length);

    console.log(`[SmartShuffle] Set size: ${setSize}, Will return: ${tracksToReturn} tracks`);

    // Step 7: Shuffle unplayed tracks using true random algorithm
    const shuffled = trueRandomShuffle(unplayedTracks);
    const selectedTracks = shuffled.slice(0, tracksToReturn);

    console.log(`[SmartShuffle] Selected ${selectedTracks.length} tracks for queueing`);

    // Step 8: Mark selected tracks as played
    const selectedIds = selectedTracks.map(t => t.id);
    memory.playedTrackIds.push(...selectedIds);
    memory.lastUpdated = Date.now();

    // Step 9: Save updated memory
    await saveShuffleMemory(memory);

    // Step 10: Calculate statistics
    const stats: ShuffleStats = {
      played: memory.playedTrackIds.length,
      remaining: allTracks.length - memory.playedTrackIds.length,
      cycleComplete: false,
      cycleNumber: memory.cycleNumber,
      percentage: Math.round((memory.playedTrackIds.length / allTracks.length) * 100),
    };

    console.log(`[SmartShuffle] Stats: ${stats.played}/${allTracks.length} played (${stats.percentage}%), Cycle: ${stats.cycleNumber}`);

    return {
      tracks: selectedTracks,
      stats,
    };
  } finally {
    // Release the lock for this playlist
    // IMPORTANT: Signal completion first, then remove from map
    // This ensures waiting operations see the resolved promise
    releaseLock!();
    shuffleLocks.delete(playlistId);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get current progress for a playlist without shuffling
 * Useful for showing stats in UI
 */
export async function getPlaylistProgress(
  playlistId: string,
  totalTracks: number
): Promise<ShuffleStats | null> {
  try {
    const memory = await loadShuffleMemory(playlistId);
    
    if (!memory) {
      return null;
    }

    const played = memory.playedTrackIds.length;
    const remaining = totalTracks - played;
    
    return {
      played,
      remaining,
      cycleComplete: remaining === 0,
      cycleNumber: memory.cycleNumber,
      percentage: Math.round((played / totalTracks) * 100),
    };
  } catch (error) {
    console.error('[SmartShuffle] Error getting progress:', error);
    return null;
  }
}

/**
 * Reset shuffle memory for a specific playlist
 * Allows user to start fresh manually
 */
export async function resetPlaylistMemory(playlistId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(getStorageKey(playlistId));
    console.log(`[SmartShuffle] Memory reset for ${playlistId}`);
  } catch (error) {
    console.error('[SmartShuffle] Error resetting memory:', error);
  }
}

/**
 * Clear all shuffle memory (all playlists)
 * Useful for debugging or user logout
 */
export async function clearAllShuffleMemory(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const shuffleKeys = allKeys.filter(key => key.startsWith(STORAGE_PREFIX));
    
    if (shuffleKeys.length > 0) {
      await AsyncStorage.multiRemove(shuffleKeys);
      console.log(`[SmartShuffle] Cleared ${shuffleKeys.length} playlist memories`);
    }
  } catch (error) {
    console.error('[SmartShuffle] Error clearing all memory:', error);
  }
}

/**
 * Get list of all playlists that have shuffle memory
 * Useful for debugging and stats
 */
export async function getTrackedPlaylists(): Promise<string[]> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const shuffleKeys = allKeys.filter(key => key.startsWith(STORAGE_PREFIX));
    
    // Extract playlist IDs from keys
    const playlistIds = shuffleKeys.map(key => key.replace(STORAGE_PREFIX, ''));
    
    return playlistIds;
  } catch (error) {
    console.error('[SmartShuffle] Error getting tracked playlists:', error);
    return [];
  }
}

