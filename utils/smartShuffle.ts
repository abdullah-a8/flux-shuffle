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

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate Spotify Track URI format
 *
 * Spotify URI Format: spotify:track:{id}
 * - Must start with "spotify:track:"
 * - Track ID must be exactly 22 characters (Spotify's base62 format)
 * - Track ID contains only alphanumeric characters (a-z, A-Z, 0-9)
 *
 * Examples:
 * - Valid: "spotify:track:3n3Ppam7vgaVa1iaRUc9Lp"
 * - Invalid: "spotify:track:" (no ID)
 * - Invalid: "spotify:track:abc" (ID too short)
 * - Invalid: "spotify:album:3n3Ppam7vgaVa1iaRUc9Lp" (wrong type)
 * - Invalid: null, undefined, empty string
 *
 * @param uri - The URI to validate
 * @returns true if valid Spotify track URI, false otherwise
 */
export function isValidSpotifyTrackUri(uri: string | null | undefined): boolean {
  // Check for null, undefined, or non-string values
  if (!uri || typeof uri !== 'string') {
    return false;
  }

  // Regex pattern for Spotify track URI:
  // - ^spotify:track: - Must start with "spotify:track:"
  // - [a-zA-Z0-9]{22}$ - Followed by exactly 22 alphanumeric characters
  const spotifyTrackUriPattern = /^spotify:track:[a-zA-Z0-9]{22}$/;

  return spotifyTrackUriPattern.test(uri);
}

/**
 * Validate an array of Spotify track URIs and filter out invalid ones
 *
 * @param uris - Array of URIs to validate
 * @returns Object containing valid URIs and count of invalid URIs
 */
export function validateTrackUris(uris: string[]): {
  validUris: string[];
  invalidCount: number;
  invalidUris: string[];
} {
  const validUris: string[] = [];
  const invalidUris: string[] = [];

  for (const uri of uris) {
    if (isValidSpotifyTrackUri(uri)) {
      validUris.push(uri);
    } else {
      invalidUris.push(uri);
      console.warn(`[Validation] Invalid Spotify track URI: ${uri}`);
    }
  }

  return {
    validUris,
    invalidCount: invalidUris.length,
    invalidUris,
  };
}

// ============================================================================
// Hashing Functions
// ============================================================================

/**
 * FNV-1a Hash Implementation (32-bit)
 * Fast, non-cryptographic hash algorithm with good distribution
 *
 * Benefits over sampling:
 * - Detects ALL playlist changes (adds, removes, reorders anywhere)
 * - No collision risk from partial sampling
 * - Fast performance even on large playlists
 *
 * Based on: FNV-1a (Fowler-Noll-Vo) hash algorithm
 * Performance: O(n) where n = number of tracks
 *
 * @see https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
 */
function fnv1aHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i); // XOR with byte
    // FNV prime: 0x01000193 (32-bit)
    // Using Math.imul for fast 32-bit multiplication
    hash = Math.imul(hash, 0x01000193);
  }

  // Convert to unsigned 32-bit integer and then to base36 string
  return (hash >>> 0).toString(36);
}

/**
 * Generate a fingerprint/hash of the playlist to detect changes
 *
 * Strategy:
 * - Uses FNV-1a hash algorithm for full playlist content hashing
 * - Includes track count for quick size change detection
 * - Concatenates all track IDs and hashes the result
 * - Detects: additions, removals, reorders anywhere in playlist
 *
 * Performance:
 * - Small playlists (<100): ~0.1ms
 * - Medium playlists (500): ~0.5ms
 * - Large playlists (2000): ~2ms
 * - Huge playlists (10000): ~10ms
 *
 * Format: "{count}_{hash}"
 * Example: "243_1x8k9mz"
 */
function generatePlaylistHash(tracks: SpotifyTrack[]): string {
  if (tracks.length === 0) return '0_0';

  // Concatenate all track IDs with delimiter
  // Using \n as delimiter (unlikely in Spotify IDs)
  const trackIdsString = tracks.map(t => t.id).join('\n');

  // Generate FNV-1a hash
  const contentHash = fnv1aHash(trackIdsString);

  // Format: count_hash
  // Count provides fast size-change detection
  // Hash provides content-change detection
  return `${tracks.length}_${contentHash}`;
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
export async function loadShuffleMemory(playlistId: string): Promise<ShuffleMemory | null> {
  try {
    const jsonValue = await AsyncStorage.getItem(getStorageKey(playlistId));

    if (jsonValue === null) {
      return null;
    }

    const memory = JSON.parse(jsonValue) as ShuffleMemory;
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
 * @param _skipLock - Internal parameter to skip lock checking during recursion (prevents deadlock)
 * @returns Promise with shuffled tracks and statistics
 */
export async function getSmartShuffledTracks(
  playlistId: string,
  allTracks: SpotifyTrack[],
  _skipLock: boolean = false
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
  // Skip lock checking when called recursively to prevent deadlock
  if (!_skipLock && shuffleLocks.has(playlistId)) {
    await shuffleLocks.get(playlistId);
  }

  // Create a promise for this operation and store it
  // Only set lock for external calls, not recursive calls
  let releaseLock: (() => void) | undefined;
  if (!_skipLock) {
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    shuffleLocks.set(playlistId, lockPromise);
  }

  try {
    // Step 1: Load existing memory or create fresh
    let memory = await loadShuffleMemory(playlistId);

    if (!memory) {
      memory = createFreshMemory(playlistId, allTracks);

      // ✅ CRITICAL FIX: Save fresh memory immediately to AsyncStorage
      // Without this, the memory only exists in-memory and is lost when trying to mark tracks
      await saveShuffleMemory(memory);
    }

    // Step 2: Detect playlist changes (songs added/removed)
    const currentHash = generatePlaylistHash(allTracks);
    const playlistChanged = memory.playlistHash !== currentHash;

    if (playlistChanged) {
      // Reset memory but keep cycle number
      memory = createFreshMemory(playlistId, allTracks, memory.cycleNumber);

      // ✅ Save updated memory after playlist change detection
      await saveShuffleMemory(memory);
    }

    // Step 3: Clean up orphaned track IDs (tracks that were removed from playlist)
    // This MUST happen before filtering unplayed tracks for accurate stats
    const currentTrackIds = new Set(allTracks.map(t => t.id));
    const orphanedIds = memory.playedTrackIds.filter(id => !currentTrackIds.has(id));

    if (orphanedIds.length > 0) {
      memory.playedTrackIds = memory.playedTrackIds.filter(id => currentTrackIds.has(id));

      // ✅ Save memory after cleaning orphaned tracks
      await saveShuffleMemory(memory);
    }

    // Step 4: Filter to get unplayed tracks (after orphan cleanup for accurate counts)
    const playedSet = new Set(memory.playedTrackIds);
    const unplayedTracks = allTracks.filter(track => !playedSet.has(track.id));

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
      // Pass _skipLock=true to prevent deadlock (we already hold the lock)
      const result = await getSmartShuffledTracks(playlistId, allTracks, true);

      // Mark that cycle was just completed
      result.stats.cycleComplete = true;

      return result;
    }

    // Step 6: Calculate how many tracks to return
    const setSize = calculateOptimalSetSize(allTracks.length);
    const tracksToReturn = Math.min(setSize, unplayedTracks.length);

    // Step 7: Shuffle unplayed tracks using true random algorithm
    const shuffled = trueRandomShuffle(unplayedTracks);
    const selectedTracks = shuffled.slice(0, tracksToReturn);

    // Step 8: Calculate current statistics (BEFORE marking as played)
    // NOTE: Tracks will be marked as played AFTER successful queueing
    // This ensures data integrity - if queueing fails, tracks won't be lost
    const stats: ShuffleStats = {
      played: memory.playedTrackIds.length,
      remaining: allTracks.length - memory.playedTrackIds.length,
      cycleComplete: false,
      cycleNumber: memory.cycleNumber,
      percentage: Math.round((memory.playedTrackIds.length / allTracks.length) * 100),
    };

    return {
      tracks: selectedTracks,
      stats,
    };
  } finally {
    // Release the lock for this playlist (only if we set it)
    // IMPORTANT: Signal completion first, then remove from map
    // This ensures waiting operations see the resolved promise
    if (releaseLock) {
      releaseLock();
      shuffleLocks.delete(playlistId);
    }
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

/**
 * Mark tracks as played after successful queueing
 * This function should be called ONLY after all tracks have been successfully queued
 *
 * @param playlistId - The playlist ID
 * @param trackIds - Array of track IDs to mark as played
 * @returns Promise<boolean> - true if successful, false otherwise
 */
export async function markTracksAsPlayed(
  playlistId: string,
  trackIds: string[]
): Promise<boolean> {
  try {
    // Load current memory
    const memory = await loadShuffleMemory(playlistId);

    if (!memory) {
      console.error('[SmartShuffle] Cannot mark tracks as played - no memory found');
      return false;
    }

    // Add track IDs to played list (avoid duplicates)
    const existingIds = new Set(memory.playedTrackIds);
    const newIds = trackIds.filter(id => !existingIds.has(id));

    if (newIds.length > 0) {
      memory.playedTrackIds.push(...newIds);
      memory.lastUpdated = Date.now();

      // Save updated memory
      await saveShuffleMemory(memory);
      return true;
    } else {
      return true;
    }
  } catch (error) {
    console.error('[SmartShuffle] Error marking tracks as played:', error);
    return false;
  }
}

/**
 * Rollback tracks that were NOT successfully queued
 * This function should be called when queueing fails partway through
 *
 * @param playlistId - The playlist ID
 * @param trackIds - Array of track IDs to remove from played list
 * @returns Promise<boolean> - true if successful, false otherwise
 */
export async function rollbackUnqueuedTracks(
  playlistId: string,
  trackIds: string[]
): Promise<boolean> {
  try {
    // Load current memory
    const memory = await loadShuffleMemory(playlistId);

    if (!memory) {
      console.error('[SmartShuffle] Cannot rollback tracks - no memory found');
      return false;
    }

    // Remove track IDs from played list
    const idsToRemove = new Set(trackIds);
    const originalLength = memory.playedTrackIds.length;
    memory.playedTrackIds = memory.playedTrackIds.filter(id => !idsToRemove.has(id));
    const removedCount = originalLength - memory.playedTrackIds.length;

    if (removedCount > 0) {
      memory.lastUpdated = Date.now();

      // Save updated memory
      await saveShuffleMemory(memory);
      return true;
    } else {
      return true;
    }
  } catch (error) {
    console.error('[SmartShuffle] Error rolling back tracks:', error);
    return false;
  }
}

