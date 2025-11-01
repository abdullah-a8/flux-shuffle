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
      // ✅ Device Health Check: Verify device is still available every 25 tracks
      if (i > 0 && i % 25 === 0) {
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
 */
async function handleTaskComplete(state: QueueTaskState): Promise<void> {
  try {
    // ✅ CRITICAL: Mark all tracks as played in shuffle memory
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

    const marked = await markTracksAsPlayed(state.playlistId, allTrackIds);

    if (!marked) {
      console.error('[QueueBackgroundService] Failed to mark tracks as played - data integrity issue!');
      // Continue with completion despite this error
    }
  } catch (error) {
    console.error('[QueueBackgroundService] Error marking tracks as played:', error);
    // Continue with completion despite this error
  }

  // Show completion notification
  await showQueueCompleteNotification(
    state.totalTracks,
    state.playlistName,
    state.stats?.remaining
  );

  // Clear state
  await clearQueueState();
}

/**
 * Handle task error with rollback support
 */
async function handleTaskError(state: QueueTaskState | null, errorMessage: string): Promise<void> {
  console.error('[QueueBackgroundService] Task failed:', errorMessage);

  // ✅ CRITICAL: Rollback unqueued tracks from shuffle memory
  if (state && state.currentIndex < state.tracks.length) {
    try {
      // Calculate which tracks were NOT queued
      const unqueuedTracks = state.tracks.slice(state.currentIndex);
      const unqueuedTrackIds = unqueuedTracks.map(uri => {
        const parts = uri.split(':');
        return parts[parts.length - 1]; // Extract track ID from URI
      });

      // Rollback these tracks from shuffle memory
      const rolledBack = await rollbackUnqueuedTracks(state.playlistId, unqueuedTrackIds);

      if (!rolledBack) {
        console.error('[QueueBackgroundService] Failed to rollback tracks - data integrity issue!');
      }
    } catch (error) {
      console.error('[QueueBackgroundService] Error during rollback:', error);
    }
  }

  // Show error notification
  await showQueueErrorNotification(errorMessage);

  // Clear state
  await clearQueueState();
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

    // Start processing immediately (no need to wait for background trigger)
    // We process in the current execution context
    await processQueue(state);

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
 * Check if a queue is currently active
 */
export async function isQueueActive(): Promise<boolean> {
  const state = await loadQueueState();
  return state?.isActive ?? false;
}
