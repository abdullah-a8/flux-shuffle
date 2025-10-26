/**
 * Expo Config Plugin for Android Notifications
 * 
 * Adds necessary permissions and configurations for persistent notifications
 * and foreground service support on Android
 */

const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Add Android permissions and foreground service configuration
 */
const withAndroidNotifications = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    // Ensure uses-permission array exists
    if (!androidManifest['uses-permission']) {
      androidManifest['uses-permission'] = [];
    }

    const permissions = androidManifest['uses-permission'];

    // Add FOREGROUND_SERVICE permission if not exists
    if (!permissions.find(p => p.$['android:name'] === 'android.permission.FOREGROUND_SERVICE')) {
      permissions.push({
        $: {
          'android:name': 'android.permission.FOREGROUND_SERVICE',
        },
      });
    }

    // Add FOREGROUND_SERVICE_DATA_SYNC permission for Android 14+ (API 34+)
    if (!permissions.find(p => p.$['android:name'] === 'android.permission.FOREGROUND_SERVICE_DATA_SYNC')) {
      permissions.push({
        $: {
          'android:name': 'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
        },
      });
    }

    // Add POST_NOTIFICATIONS permission for Android 13+ (API 33+)
    if (!permissions.find(p => p.$['android:name'] === 'android.permission.POST_NOTIFICATIONS')) {
      permissions.push({
        $: {
          'android:name': 'android.permission.POST_NOTIFICATIONS',
        },
      });
    }

    console.log('✅ Android notification permissions added');

    return config;
  });
};

module.exports = withAndroidNotifications;

