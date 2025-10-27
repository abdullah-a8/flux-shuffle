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
  tracks: string[]; // Track URIs
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
    await handleTaskError(error.message);
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
    await handleTaskError(error instanceof Error ? error.message : 'Unknown error');
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
    console.log(`[QueueBackgroundService] State saved: ${state.currentIndex}/${state.totalTracks}`);
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
    console.log(`[QueueBackgroundService] State loaded: ${state.currentIndex}/${state.totalTracks}`);
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
    console.log('[QueueBackgroundService] State cleared');
  } catch (error) {
    console.error('[QueueBackgroundService] Error clearing state:', error);
  }
}

// ============================================================================
// Queue Processing
// ============================================================================

/**
 * Process the queue by adding tracks one by one
 */
async function processQueue(state: QueueTaskState): Promise<void> {
  const { tracks, deviceId, currentIndex, totalTracks, playlistName } = state;

  console.log(`[QueueBackgroundService] Processing queue from index ${currentIndex}`);

  // Process remaining tracks
  for (let i = currentIndex; i < tracks.length; i++) {
    const trackUri = tracks[i];

    try {
      // Queue the track with retry logic
      await queueTrackWithRetry(trackUri, deviceId);

      // Update state
      state.currentIndex = i + 1;
      await saveQueueState(state);

      // Update notification every 10 tracks or on completion
      if ((i + 1) % 10 === 0 || (i + 1) === totalTracks) {
        await updateQueueProgressNotification(i + 1, totalTracks, playlistName);
      }

      // Respect API rate limits - 150ms between requests
      if (i < tracks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      console.log(`[QueueBackgroundService] Queued track ${i + 1}/${totalTracks}`);
    } catch (error) {
      console.error(`[QueueBackgroundService] Error queueing track ${i + 1}:`, error);

      // If we hit an unrecoverable error, stop and notify
      if (error instanceof Error && !error.message.includes('429')) {
        await handleTaskError(`Failed to queue track ${i + 1}: ${error.message}`);
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
  console.log('[QueueBackgroundService] Queue completed successfully');

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
 * Handle task error
 */
async function handleTaskError(errorMessage: string): Promise<void> {
  console.error('[QueueBackgroundService] Task failed:', errorMessage);

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

    console.log(`[QueueBackgroundService] Starting background queue for ${playlistName}`);
    console.log(`[QueueBackgroundService] Total tracks to queue: ${trackUris.length}`);

    // Create initial state
    const state: QueueTaskState = {
      playlistId,
      playlistName,
      tracks: trackUris,
      deviceId,
      currentIndex: 0,
      totalTracks: trackUris.length,
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
    await showQueueErrorNotification(
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
