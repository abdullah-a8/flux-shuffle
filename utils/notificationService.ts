/**
 * Notification Service
 * 
 * Handles persistent notifications for queue progress on Android/iOS
 * Shows clean, minimal green-styled notifications for track queueing
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// Notification channel ID for queue progress
const QUEUE_CHANNEL_ID = 'queue-progress';
const NOTIFICATION_ID = 'queue-notification';

// Configure how notifications should be handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Request notification permissions from the user
 * Required for Android 13+ and iOS
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    // Check if running on a physical device
    if (!Device.isDevice) {
      console.log('[Notifications] Running on simulator/emulator - notifications may not work');
      return false;
    }

    // Check current permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    
    let finalStatus = existingStatus;
    
    // If not granted, request permissions
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: false, // Don't play sound for queue progress
        },
      });
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission denied');
      return false;
    }
    
    console.log('[Notifications] Permission granted');
    return true;
  } catch (error) {
    console.error('[Notifications] Error requesting permissions:', error);
    return false;
  }
}

/**
 * Setup Android notification channel
 * Required for Android 8.0+
 */
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    await Notifications.setNotificationChannelAsync(QUEUE_CHANNEL_ID, {
      name: 'Queue Progress',
      description: 'Shows progress when queueing tracks to Spotify',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null, // No sound for progress notifications
      vibrationPattern: [0],
      enableVibrate: false,
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      enableLights: true,
      lightColor: '#1DB954', // Spotify green
    });

    console.log('[Notifications] Channel created');
  } catch (error) {
    console.error('[Notifications] Error creating channel:', error);
  }
}

/**
 * Show initial queueing notification
 */
export async function showQueueStartNotification(
  playlistName: string,
  totalTracks: number
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: '🎵 Queueing Tracks',
        body: `Preparing ${totalTracks} tracks from ${playlistName}...`,
        color: '#1DB954', // Spotify green
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        sticky: true, // Keep notification visible
        autoDismiss: false,
        data: { type: 'queue-progress' },
      },
      trigger: null, // Show immediately
    });

    console.log('[Notifications] Queue start notification shown');
  } catch (error) {
    console.error('[Notifications] Error showing start notification:', error);
  }
}

/**
 * Update notification with current progress
 */
export async function updateQueueProgressNotification(
  progress: number,
  total: number,
  playlistName: string
): Promise<void> {
  try {
    const percentage = Math.round((progress / total) * 100);
    
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: '🎵 Queueing Tracks',
        body: `${progress}/${total} tracks queued (${percentage}%)`,
        color: '#1DB954',
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        sticky: true,
        autoDismiss: false,
        // Android progress bar
        ...(Platform.OS === 'android' && {
          android: {
            progress: {
              max: total,
              current: progress,
              indeterminate: false,
            },
          },
        }),
        data: { 
          type: 'queue-progress',
          progress,
          total,
        },
      },
      trigger: null,
    });
  } catch (error) {
    console.error('[Notifications] Error updating progress:', error);
  }
}

/**
 * Show completion notification
 */
export async function showQueueCompleteNotification(
  totalQueued: number,
  playlistName: string,
  remainingTracks?: number
): Promise<void> {
  try {
    const body = remainingTracks && remainingTracks > 0
      ? `✅ ${totalQueued} tracks queued! ${remainingTracks} unheard songs remaining.`
      : `✅ ${totalQueued} tracks queued successfully!`;

    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: '🎉 Queue Complete',
        body,
        color: '#1DB954',
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        sticky: false,
        autoDismiss: true,
        data: { 
          type: 'queue-complete',
          totalQueued,
        },
      },
      trigger: null,
    });

    console.log('[Notifications] Queue complete notification shown');

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      dismissNotification();
    }, 3000);
  } catch (error) {
    console.error('[Notifications] Error showing complete notification:', error);
  }
}

/**
 * Show error notification
 */
export async function showQueueErrorNotification(
  errorMessage: string = 'An error occurred while queueing tracks'
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: '❌ Queue Failed',
        body: errorMessage,
        color: '#ff6b35', // Error red
        priority: Notifications.AndroidNotificationPriority.HIGH,
        sticky: false,
        autoDismiss: true,
        data: { type: 'queue-error' },
      },
      trigger: null,
    });

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      dismissNotification();
    }, 5000);
  } catch (error) {
    console.error('[Notifications] Error showing error notification:', error);
  }
}

/**
 * Dismiss the queue notification
 */
export async function dismissNotification(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(NOTIFICATION_ID);
    console.log('[Notifications] Notification dismissed');
  } catch (error) {
    console.error('[Notifications] Error dismissing notification:', error);
  }
}

/**
 * Initialize notification service
 * Call this on app startup
 */
export async function initializeNotifications(): Promise<boolean> {
  try {
    // Setup channel first (Android)
    await setupNotificationChannel();
    
    // Request permissions
    const hasPermission = await requestNotificationPermissions();
    
    return hasPermission;
  } catch (error) {
    console.error('[Notifications] Error initializing:', error);
    return false;
  }
}

/**
 * Clean up all notifications
 */
export async function cleanupNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
    console.log('[Notifications] All notifications dismissed');
  } catch (error) {
    console.error('[Notifications] Error cleaning up:', error);
  }
}

