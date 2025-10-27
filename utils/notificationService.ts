/**
 * Notification Service - Material 3 Design
 *
 * Handles foreground service notifications for Android background queueing
 * with modern, sleek Material 3 design principles.
 *
 * CRITICAL ANDROID BEHAVIOR:
 * - Persistent notifications (sticky: true) act as foreground service notifications
 * - This keeps the JavaScript thread alive when the app is backgrounded
 * - Without this, Android will suspend JS execution and queueing stops
 * - The notification MUST remain visible while queueing is in progress
 *
 * MATERIAL 3 DESIGN FEATURES:
 * 1. **Visual Hierarchy** - Title/body/subtitle for clear information structure
 * 2. **Text-Based Progress** - Clear numerical progress (e.g., "50 of 150 tracks")
 * 3. **Percentage Display** - Quick reference (e.g., "33% complete")
 * 4. **Minimal Interruption** - LOW importance, silent, no vibration
 * 5. **Smart Updates** - Update every 3 tracks OR 2 seconds (near real-time)
 * 6. **Spotify Brand Integration** - #1DB954 green accent throughout
 * 7. **Clean Typography** - Professional, readable messaging
 *
 * PROGRESS UPDATE STRATEGY:
 * - Initial: "Starting..." with total track count
 * - During: Text updates every 3 tracks or 2 seconds with percentage
 * - Completion: Success message with remaining tracks info
 * - Error: Clear error indication with detailed subtitle
 *
 * TECHNICAL NOTES:
 * - Expo Notifications API doesn't support native Android progress bars
 * - Text-based progress provides excellent UX with maximum compatibility
 * - Updates are optimized for battery/performance
 *
 * Architecture:
 * - Uses expo-notifications for cross-platform notification API
 * - Integrates with queueBackgroundService.ts for background task execution
 * - Provides near real-time progress updates (optimized for battery/performance)
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

// Notification channel ID for queue progress (foreground service channel)
const QUEUE_CHANNEL_ID = 'queue-progress';
const NOTIFICATION_ID = 'queue-notification';

// Configure how notifications should be handled when app is in foreground
// These settings ensure the foreground service notification is always visible
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, // Show banner even in foreground
    shouldShowList: true, // Show in notification list
    shouldPlaySound: false, // Silent notifications for progress
    shouldSetBadge: false, // No badge updates
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
 * Setup Android notification channel with Material 3 design
 * Required for Android 8.0+
 *
 * This channel is used for foreground service notifications
 * that keep the background queueing process alive
 *
 * Design Philosophy:
 * - Minimal interruption (LOW importance)
 * - Silent (no sound/vibration)
 * - Visible on lockscreen for transparency
 * - Material 3 compliant styling
 */
export async function setupNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  try {
    await Notifications.setNotificationChannelAsync(QUEUE_CHANNEL_ID, {
      name: 'Music Queue',
      description: 'Shows real-time progress when queueing tracks. Required for background operation.',
      importance: Notifications.AndroidImportance.LOW, // Low priority - minimal interruption
      sound: null, // Silent - no audio feedback
      vibrationPattern: [0], // No vibration
      enableVibrate: false,
      showBadge: false, // No app badge counter
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC, // Visible on lockscreen
      enableLights: false, // No LED indicator
      bypassDnd: false, // Respect Do Not Disturb
    });

    console.log('[Notifications] Material 3 foreground service channel created');
  } catch (error) {
    console.error('[Notifications] Error creating channel:', error);
  }
}

/**
 * Show initial queueing notification with Material 3 design
 * This acts as the foreground service notification on Android
 *
 * Design Features:
 * - Clean typography with visual hierarchy
 * - Spotify brand color accent
 * - Persistent and non-dismissible during operation
 *
 * Note: Expo Notifications API doesn't support native Android progress bars.
 * Progress is shown via text updates for maximum compatibility.
 */
export async function showQueueStartNotification(
  playlistName: string,
  totalTracks: number
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: 'Queueing to Spotify',
        body: `${totalTracks} tracks from ${playlistName}`,
        subtitle: 'Starting...', // Secondary text for Material 3 hierarchy
        color: '#1DB954', // Spotify brand green - Material 3 accent
        priority: Notifications.AndroidNotificationPriority.LOW,
        sticky: true, // CRITICAL: Keeps foreground service alive
        autoDismiss: false,
        data: {
          type: 'queue-progress',
          isForegroundService: true,
          playlistName,
          totalTracks,
        },
      },
      trigger: null,
    });

    console.log('[Notifications] Material 3 notification started');
  } catch (error) {
    console.error('[Notifications] Error showing start notification:', error);
  }
}

/**
 * Update notification with current progress - Material 3 design
 * Updates the foreground service notification with near real-time progress
 *
 * Design Features:
 * - Clear numerical feedback (progress/total)
 * - Percentage display for quick reference
 * - Minimalist typography
 * - Maintains Material 3 visual hierarchy
 *
 * Note: Text-based progress updates provide excellent UX without requiring
 * native Android progress bar APIs not available in Expo.
 */
export async function updateQueueProgressNotification(
  progress: number,
  total: number,
  playlistName: string
): Promise<void> {
  try {
    const percentage = Math.round((progress / total) * 100);
    const remaining = total - progress;

    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: 'Queueing to Spotify',
        body: `${progress} of ${total} tracks • ${remaining} remaining`,
        subtitle: `${percentage}% complete`, // Material 3 secondary text
        color: '#1DB954', // Spotify green accent
        priority: Notifications.AndroidNotificationPriority.LOW,
        sticky: true,
        autoDismiss: false,
        data: {
          type: 'queue-progress',
          progress,
          total,
          percentage,
          playlistName,
          isForegroundService: true,
        },
      },
      trigger: null,
    });
  } catch (error) {
    console.error('[Notifications] Error updating progress:', error);
  }
}

/**
 * Show completion notification - Material 3 design
 *
 * Design Features:
 * - Success-oriented messaging
 * - Auto-dismissible after delay
 * - Clean, celebratory design
 * - Contextual information about remaining tracks
 */
export async function showQueueCompleteNotification(
  totalQueued: number,
  playlistName: string,
  remainingTracks?: number
): Promise<void> {
  try {
    const hasRemaining = remainingTracks && remainingTracks > 0;
    const body = hasRemaining
      ? `${totalQueued} tracks ready to play`
      : `All ${totalQueued} tracks queued`;

    const subtitle = hasRemaining
      ? `${remainingTracks} unheard tracks remaining in playlist`
      : 'Enjoy your music!';

    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: 'Queue Complete',
        body,
        subtitle, // Material 3 secondary text
        color: '#1DB954', // Success green
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        sticky: false, // Allow user dismissal
        autoDismiss: true,
        data: {
          type: 'queue-complete',
          totalQueued,
          remainingTracks,
          playlistName,
        },
        ...(Platform.OS === 'android' && {
          channelId: QUEUE_CHANNEL_ID,
        }),
      },
      trigger: null,
    });

    console.log('[Notifications] Material 3 completion notification shown');

    // Auto-dismiss after 4 seconds (slightly longer to read remaining tracks info)
    setTimeout(() => {
      dismissNotification();
    }, 4000);
  } catch (error) {
    console.error('[Notifications] Error showing complete notification:', error);
  }
}

/**
 * Show error notification - Material 3 design
 *
 * Design Features:
 * - Clear error indication
 * - Actionable error message
 * - Higher priority for visibility
 * - Dismissible after reading
 */
export async function showQueueErrorNotification(
  errorMessage: string = 'An error occurred while queueing tracks'
): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: 'Queue Failed',
        body: 'Unable to queue tracks',
        subtitle: errorMessage, // Detailed error in subtitle
        color: '#DC362E', // Material 3 error red
        priority: Notifications.AndroidNotificationPriority.HIGH, // Higher visibility for errors
        sticky: false,
        autoDismiss: true,
        data: {
          type: 'queue-error',
          errorMessage,
        },
        ...(Platform.OS === 'android' && {
          channelId: QUEUE_CHANNEL_ID,
        }),
      },
      trigger: null,
    });

    console.log('[Notifications] Material 3 error notification shown');

    // Auto-dismiss after 6 seconds (longer to read error details)
    setTimeout(() => {
      dismissNotification();
    }, 6000);
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

