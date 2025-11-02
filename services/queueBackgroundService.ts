/**
 * Background Queue Service for Android
 *
 * Handles background queueing of tracks to Spotify using:
 * - expo-task-manager for background task execution
 * - Foreground service with persistent notification
 * - AsyncStorage for state persistence across app lifecycle
 *
 * This service allows the queueing process to continue even when
 * the app is in the background or minimized.
 */

import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SpotifyService } from '@/utils/spotify';
import type { SpotifyTrack } from '@/types/spotify';
import {
  showQueueStartNotification,
  updateQueueProgressNotification,
  showQueueCompleteNotification,
  showQueueErrorNotification,
  dismissNotification,
} from '@/utils/notificationService';
import { markTracksAsPlayed, rollbackUnqueuedTracks, validateTrackUris } from '@/utils/smartShuffle';
import { queryClient } from '@/utils/queryClient';
import { spotifyQueryKeys } from '@/hooks/useSpotifyQueries';

// ============================================================================
// Constants
// ============================================================================

export const QUEUE_BACKGROUND_TASK = 'QUEUE_BACKGROUND_TASK';
const STORAGE_KEY_PREFIX = 'queue_task_';
const STORAGE_KEY_STATE = `${STORAGE_KEY_PREFIX}state`;

// ============================================================================
// Types
// ============================================================================

interface QueueTaskState {
  playlistId: string;
  playlistName: string;
  tracks: string[]; // Track URIs (queued tracks only, excludes first track)
  firstTrackUri: string; // First track that was played immediately
  deviceId: string;
  currentIndex: number;
  totalTracks: number;
  isActive: boolean;
  startedAt: number;
  stats?: {
    remaining: number;
  };
}

// ============================================================================
// Task Definition (MUST be in global scope)
// ============================================================================

/**
 * Define the background task for queueing tracks
 * This MUST be called in the global scope, outside of React components
 */
TaskManager.defineTask(QUEUE_BACKGROUND_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[QueueBackgroundTask] Task error:', error);
    const state = await loadQueueState();
    await handleTaskError(state, error.message);
    return;
  }

  console.log('[QueueBackgroundTask] Task triggered, processing queue...');

  try {
    // Load current state
    const state = await loadQueueState();

    if (!state || !state.isActive) {
      console.log('[QueueBackgroundTask] No active queue state found');
      return;
    }

    // Process the queue
    await processQueue(state);
  } catch (error) {
    console.error('[QueueBackgroundTask] Error processing queue:', error);
    const state = await loadQueueState();
    await handleTaskError(state, error instanceof Error ? error.message : 'Unknown error');
  }
});

// ============================================================================
// State Management
// ============================================================================

/**
 * Save queue state to AsyncStorage
 */
async function saveQueueState(state: QueueTaskState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
  } catch (error) {
    console.error('[QueueBackgroundService] Error saving state:', error);
  }
}

/**
 * Load queue state from AsyncStorage
 */
async function loadQueueState(): Promise<QueueTaskState | null> {
  try {
    const stateJson = await AsyncStorage.getItem(STORAGE_KEY_STATE);
    if (!stateJson) return null;

    const state = JSON.parse(stateJson) as QueueTaskState;
    return state;
  } catch (error) {
    console.error('[QueueBackgroundService] Error loading state:', error);
    return null;
  }
}

/**
 * Clear queue state
 */
async function clearQueueState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY_STATE);
  } catch (error) {
    console.error('[QueueBackgroundService] Error clearing state:', error);
  }
}

// ============================================================================
// Queue Processing
// ============================================================================

/**
 * Process the queue by adding tracks one by one with smart progress updates
 *
 * Update Strategy (near real-time):
 * - Update every 3 tracks OR every 2 seconds (whichever comes first)
 * - Always update on completion
 * - Provides smooth visual feedback without excessive updates
 *
 * Device Health Checks:
 * - Check device health every 25 tracks
 * - Ensures device hasn't disconnected during long queue operations
 */
async function processQueue(state: QueueTaskState): Promise<void> {
  const { tracks, deviceId, currentIndex, totalTracks, playlistName } = state;

  let lastUpdateTime = Date.now();
  let lastUpdateIndex = currentIndex;

  // Process remaining tracks
  for (let i = currentIndex; i < tracks.length; i++) {
    const trackUri = tracks[i];

    try {
      // ✅ Safety Check: Verify state still exists (not cleared by stale cleanup)
      // Check every 25 tracks to avoid excessive AsyncStorage reads
      if (i > 0 && i % 25 === 0) {
        const currentState = await loadQueueState();
        if (!currentState || !currentState.isActive) {
          console.warn('[QueueBackgroundService] Queue state was cleared externally. Stopping processing.');
          return; // Exit gracefully without error notification
        }

        // Device Health Check: Verify device is still available
        const deviceHealthy = await SpotifyService.verifyDeviceHealth(deviceId);

        if (!deviceHealthy) {
          const errorMsg = `Device disconnected or unavailable during queueing (at track ${i + 1}/${totalTracks})`;
          console.error(`[QueueBackgroundService] ${errorMsg}`);
          await handleTaskError(state, errorMsg);
          return;
        }
      }
      // Queue the track with retry logic
      await queueTrackWithRetry(trackUri, deviceId);

      // Update state
      state.currentIndex = i + 1;
      await saveQueueState(state);

      const tracksSinceUpdate = (i + 1) - lastUpdateIndex;
      const timeSinceUpdate = Date.now() - lastUpdateTime;
      const isComplete = (i + 1) === totalTracks;

      // Smart update logic: Update every 3 tracks OR every 2 seconds OR on completion
      const shouldUpdate = tracksSinceUpdate >= 3 || timeSinceUpdate >= 2000 || isComplete;

      if (shouldUpdate) {
        await updateQueueProgressNotification(i + 1, totalTracks, playlistName);
        lastUpdateTime = Date.now();
        lastUpdateIndex = i + 1;
      }

      // Respect API rate limits - 150ms between requests
      if (i < tracks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    } catch (error) {
      console.error(`[QueueBackgroundService] Error queueing track ${i + 1}:`, error);

      // If we hit an unrecoverable error, stop and notify
      if (error instanceof Error && !error.message.includes('429')) {
        await handleTaskError(state, `Failed to queue track ${i + 1}: ${error.message}`);
        return;
      }
    }
  }

  // All tracks queued successfully
  await handleTaskComplete(state);
}

/**
 * Queue a single track with exponential backoff retry logic
 */
async function queueTrackWithRetry(
  trackUri: string,
  deviceId: string,
  retryCount = 0,
  maxRetries = 3
): Promise<void> {
  try {
    await SpotifyService.addToQueue(trackUri, deviceId);
  } catch (error: any) {
    // Handle rate limiting with exponential backoff
    if (error?.status === 429 || error?.message?.includes('429')) {
      if (retryCount < maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
        console.log(`[QueueBackgroundService] Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return queueTrackWithRetry(trackUri, deviceId, retryCount + 1, maxRetries);
      }
    }

    // Re-throw if not recoverable
    throw error;
  }
}

// ============================================================================
// Task Lifecycle
// ============================================================================

/**
 * Handle task completion
 *
 * Critical Flow:
 * 1. Mark tracks as played in AsyncStorage (data persistence)
 * 2. Invalidate React Query cache (UI update trigger)
 * 3. Show completion notification
 * 4. Clear queue state
 *
 * This order ensures data integrity and proper UI updates.
 */
async function handleTaskComplete(state: QueueTaskState): Promise<void> {
  try {
    // ✅ STEP 1: Mark all tracks as played in shuffle memory (AsyncStorage)
    // This includes BOTH the first track (played immediately) AND all queued tracks

    // Extract track IDs from queued tracks
    const queuedTrackIds = state.tracks.map(uri => {
      const parts = uri.split(':');
      return parts[parts.length - 1];
    });

    // Extract track ID from first track
    const firstTrackParts = state.firstTrackUri.split(':');
    const firstTrackId = firstTrackParts[firstTrackParts.length - 1];

    // Combine: first track + all queued tracks
    const allTrackIds = [firstTrackId, ...queuedTrackIds];

    console.log(`[QueueBackgroundService] Marking ${allTrackIds.length} tracks as played for playlist ${state.playlistId}`);
    const marked = await markTracksAsPlayed(state.playlistId, allTrackIds);

    if (!marked) {
      console.error('[QueueBackgroundService] Failed to mark tracks as played - data integrity issue!');
      // Continue with completion despite this error
    }

    // ✅ STEP 2: Invalidate React Query cache AFTER AsyncStorage updates
    // This ensures UI refetches fresh data with updated play counts
    console.log('[QueueBackgroundService] Invalidating React Query cache to trigger UI updates');

    try {
      // Invalidate playlist-specific progress query
      await queryClient.invalidateQueries({
        queryKey: spotifyQueryKeys.playlistProgress(state.playlistId),
        refetchType: 'active', // Only refetch if component is mounted
      });

      // Invalidate global stats query (for profile page)
      await queryClient.invalidateQueries({
        queryKey: spotifyQueryKeys.globalStats,
        refetchType: 'active', // Only refetch if component is mounted
      });

      // Invalidate active queue query to remove loading spinner immediately
      await queryClient.invalidateQueries({
        queryKey: spotifyQueryKeys.activeQueuePlaylistId,
        refetchType: 'active',
      });

      console.log('[QueueBackgroundService] ✅ Cache invalidation complete - UI will update');
    } catch (invalidationError) {
      console.error('[QueueBackgroundService] Error invalidating queries:', invalidationError);
      // Continue despite invalidation error - data is already saved
    }
  } catch (error) {
    console.error('[QueueBackgroundService] Error in task completion:', error);
    // Continue with completion despite errors
  }

  // ✅ STEP 3: Show completion notification
  await showQueueCompleteNotification(
    state.totalTracks,
    state.playlistName,
    state.stats?.remaining
  );

  // ✅ STEP 4: Clear queue state
  await clearQueueState();

  console.log('[QueueBackgroundService] ✅ Queue processing complete');
}

/**
 * Handle task error with rollback support
 *
 * Error Recovery Flow:
 * 1. Rollback unqueued tracks from shuffle memory (data consistency)
 * 2. Invalidate queries to ensure UI shows accurate state
 * 3. Show error notification to user
 * 4. Clear queue state
 *
 * This ensures the app remains in a consistent state even after errors.
 */
async function handleTaskError(state: QueueTaskState | null, errorMessage: string): Promise<void> {
  console.error('[QueueBackgroundService] Task failed:', errorMessage);

  // ✅ STEP 1: Rollback unqueued tracks from shuffle memory
  if (state && state.currentIndex < state.tracks.length) {
    try {
      // Calculate which tracks were NOT queued
      const unqueuedTracks = state.tracks.slice(state.currentIndex);
      const unqueuedTrackIds = unqueuedTracks.map(uri => {
        const parts = uri.split(':');
        return parts[parts.length - 1]; // Extract track ID from URI
      });

      console.log(`[QueueBackgroundService] Rolling back ${unqueuedTrackIds.length} unqueued tracks`);
      const rolledBack = await rollbackUnqueuedTracks(state.playlistId, unqueuedTrackIds);

      if (!rolledBack) {
        console.error('[QueueBackgroundService] Failed to rollback tracks - data integrity issue!');
      }

      // ✅ STEP 2: Invalidate queries after rollback to show accurate state
      try {
        await queryClient.invalidateQueries({
          queryKey: spotifyQueryKeys.playlistProgress(state.playlistId),
          refetchType: 'active',
        });
        await queryClient.invalidateQueries({
          queryKey: spotifyQueryKeys.globalStats,
          refetchType: 'active',
        });
        // Remove loading spinner immediately on error
        await queryClient.invalidateQueries({
          queryKey: spotifyQueryKeys.activeQueuePlaylistId,
          refetchType: 'active',
        });
        console.log('[QueueBackgroundService] Cache invalidated after error recovery');
      } catch (invalidationError) {
        console.error('[QueueBackgroundService] Error invalidating queries after rollback:', invalidationError);
      }
    } catch (error) {
      console.error('[QueueBackgroundService] Error during rollback:', error);
    }
  }

  // ✅ STEP 3: Show error notification
  await showQueueErrorNotification(errorMessage);

  // ✅ STEP 4: Clear state
  await clearQueueState();

  console.log('[QueueBackgroundService] Error handling complete');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Start background queueing process
 * This initiates the background task with foreground service notification
 */
export async function startBackgroundQueue(params: {
  playlistId: string;
  playlistName: string;
  tracks: SpotifyTrack[];
  deviceId: string;
  firstTrackUri: string;
  stats?: {
    remaining: number;
  };
}): Promise<boolean> {
  try {
    // ✅ CRITICAL: Prevent multiple concurrent queues
    const activeQueue = await isQueueActive();
    if (activeQueue) {
      console.warn('[QueueBackgroundService] Cannot start new queue - another queue is already active');
      await showQueueErrorNotification('A queue is already in progress. Please wait for it to complete.');
      return false;
    }

    const { playlistId, playlistName, tracks, deviceId, firstTrackUri, stats } = params;

    // Skip the first track (already played)
    const tracksToQueue = tracks.slice(1);
    const trackUris = tracksToQueue.map(t => t.uri);

    // ✅ CRITICAL: Validate all track URIs before queueing
    const validation = validateTrackUris(trackUris);

    if (validation.invalidCount > 0) {
      console.error(`[QueueBackgroundService] ❌ Found ${validation.invalidCount} invalid URIs`);
      validation.invalidUris.forEach((uri, idx) => {
        console.error(`  ${idx + 1}. Invalid URI: ${uri}`);
      });

      // If more than 10% of URIs are invalid, abort
      const invalidPercentage = (validation.invalidCount / trackUris.length) * 100;
      if (invalidPercentage > 10) {
        throw new Error(
          `Too many invalid URIs: ${validation.invalidCount}/${trackUris.length} (${invalidPercentage.toFixed(1)}%). Aborting queue operation.`
        );
      }

      console.warn(
        `[QueueBackgroundService] Proceeding with ${validation.validUris.length} valid URIs, skipping ${validation.invalidCount} invalid ones`
      );
    }

    // Use only validated URIs for queueing
    const validatedTrackUris = validation.validUris;

    // Create initial state
    const state: QueueTaskState = {
      playlistId,
      playlistName,
      tracks: validatedTrackUris, // ✅ Use validated URIs instead of raw trackUris
      firstTrackUri, // ✅ Store first track to mark it as played later
      deviceId,
      currentIndex: 0,
      totalTracks: validatedTrackUris.length, // ✅ Use validated count
      isActive: true,
      startedAt: Date.now(),
      stats,
    };

    // Save state
    await saveQueueState(state);

    // Show initial notification (foreground service notification)
    await showQueueStartNotification(playlistName, tracks.length);

    // ✅ FIX: Start processing asynchronously to avoid blocking UI
    // The queue will process in the background while UI remains responsive
    // Error handling is done within processQueue -> handleTaskError
    processQueue(state).catch(error => {
      console.error('[QueueBackgroundService] Unhandled error in processQueue:', error);
      handleTaskError(state, error instanceof Error ? error.message : 'Unknown error occurred');
    });

    // Return immediately so UI can update and show notification
    return true;
  } catch (error) {
    console.error('[QueueBackgroundService] Error starting background queue:', error);
    const state = await loadQueueState();
    await handleTaskError(
      state,
      error instanceof Error ? error.message : 'Failed to start queueing'
    );
    return false;
  }
}

/**
 * Stop the background queue
 */
export async function stopBackgroundQueue(): Promise<void> {
  console.log('[QueueBackgroundService] Stopping background queue');

  // Load current state and mark as inactive
  const state = await loadQueueState();
  if (state) {
    state.isActive = false;
    await saveQueueState(state);
  }

  // Dismiss notification
  await dismissNotification();
}

/**
 * Get current queue progress
 */
export async function getQueueProgress(): Promise<{
  isActive: boolean;
  progress: number;
  total: number;
  percentage: number;
} | null> {
  const state = await loadQueueState();
  if (!state) return null;

  return {
    isActive: state.isActive,
    progress: state.currentIndex,
    total: state.totalTracks,
    percentage: Math.round((state.currentIndex / state.totalTracks) * 100),
  };
}

/**
 * Get the playlist ID of the currently active queue
 * Returns null if no queue is active
 *
 * Use this to show loading states in UI for the playlist being queued
 */
export async function getActiveQueuePlaylistId(): Promise<string | null> {
  const state = await loadQueueState();

  if (!state || !state.isActive) {
    return null;
  }

  return state.playlistId;
}

/**
 * Check if a queue is currently active
 *
 * Also performs cleanup of stale queue states (e.g. from app crashes).
 * A queue is considered stale if it's been active for more than 45 minutes,
 * which is longer than any realistic queue could take.
 *
 * Calculation:
 * - Largest realistic playlist: ~10,000 tracks
 * - Rate: 150ms per track
 * - Max time: 10,000 × 0.15s = 1,500s ≈ 25 minutes
 * - Safe timeout: 45 minutes (80% buffer)
 */
export async function isQueueActive(): Promise<boolean> {
  const state = await loadQueueState();

  if (!state) return false;

  // Check if queue state is stale (likely from app crash/force-close)
  const STALE_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes
  const isStale = state.isActive && (Date.now() - state.startedAt > STALE_TIMEOUT_MS);

  if (isStale) {
    console.warn(
      `[QueueBackgroundService] Detected stale queue state (started ${Math.round((Date.now() - state.startedAt) / 60000)} minutes ago). Cleaning up...`
    );

    // Clear the stale state to allow new queues
    await clearQueueState();

    // Dismiss any lingering notification
    await dismissNotification();

    return false;
  }

  return state.isActive ?? false;
}
