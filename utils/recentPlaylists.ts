import AsyncStorage from '@react-native-async-storage/async-storage';

const RECENT_PLAYLISTS_KEY = 'recent_playlists';
const MAX_RECENT_PLAYLISTS = 10;

/**
 * Add a playlist to the recent playlists list
 * Maintains a maximum of 10 recent playlists, most recent first
 */
export async function addRecentPlaylist(playlistId: string): Promise<void> {
  try {
    const recent = await AsyncStorage.getItem(RECENT_PLAYLISTS_KEY);
    const list: string[] = recent ? JSON.parse(recent) : [];

    // Remove the playlist if it already exists (to move it to the front)
    const filtered = list.filter(id => id !== playlistId);

    // Add to the beginning and limit to MAX_RECENT_PLAYLISTS
    const updated = [playlistId, ...filtered].slice(0, MAX_RECENT_PLAYLISTS);

    await AsyncStorage.setItem(RECENT_PLAYLISTS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('[RecentPlaylists] Failed to add recent playlist:', error);
  }
}

/**
 * Get the list of recent playlist IDs, ordered by most recent first
 */
export async function getRecentPlaylists(): Promise<string[]> {
  try {
    const recent = await AsyncStorage.getItem(RECENT_PLAYLISTS_KEY);
    return recent ? JSON.parse(recent) : [];
  } catch (error) {
    console.error('[RecentPlaylists] Failed to get recent playlists:', error);
    return [];
  }
}

/**
 * Clear the recent playlists list
 */
export async function clearRecentPlaylists(): Promise<void> {
  try {
    await AsyncStorage.removeItem(RECENT_PLAYLISTS_KEY);
  } catch (error) {
    console.error('[RecentPlaylists] Failed to clear recent playlists:', error);
  }
}
