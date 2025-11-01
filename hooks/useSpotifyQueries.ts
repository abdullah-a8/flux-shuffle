import { useQuery, useMutation, useQueryClient, CancelledError } from '@tanstack/react-query';
import { SpotifyService } from '@/utils/spotify';
import type { SpotifyUser, SpotifyPlaylist, SpotifyTrack } from '@/types/spotify';
import { getSmartShuffledTracks, getPlaylistProgress, type ShuffleStats } from '@/utils/smartShuffle';
import { getGlobalStats, type GlobalStats } from '@/utils/statistics';
import {
  showQueueErrorNotification,
  dismissNotification,
} from '@/utils/notificationService';
import { startBackgroundQueue } from '@/services/queueBackgroundService';

const spotifyService = SpotifyService;

// Query keys
export const spotifyQueryKeys = {
  user: ['spotify', 'user'] as const,
  playlists: ['spotify', 'playlists'] as const,
  playlistTracks: (playlistId: string) => ['spotify', 'playlist', playlistId, 'tracks'] as const,
  savedTracks: ['spotify', 'saved-tracks'] as const,
  devices: ['spotify', 'devices'] as const,
  queueStatus: ['spotify', 'queue-status'] as const,
  playlistProgress: (playlistId: string) => ['spotify', 'playlist', playlistId, 'progress'] as const,
  globalStats: ['spotify', 'global-stats'] as const,
};

// User query
export function useSpotifyUser() {
  return useQuery({
    queryKey: spotifyQueryKeys.user,
    queryFn: async (): Promise<SpotifyUser | null> => {
      return await spotifyService.getCurrentUser();
    },
    staleTime: 30 * 60 * 1000, // 30 minutes - user profile rarely changes
    gcTime: 60 * 60 * 1000, // 1 hour - keep in cache longer
    retry: 1,
  });
}

// Playlists query with improved caching
export function useSpotifyPlaylists(enabled: boolean = true) {
  return useQuery({
    queryKey: spotifyQueryKeys.playlists,
    queryFn: async (): Promise<SpotifyPlaylist[]> => {
      return await spotifyService.getUserPlaylists();
    },
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes - playlists don't change often
    gcTime: 20 * 60 * 1000, // 20 minutes - keep in cache longer
    refetchOnWindowFocus: true,
    refetchOnMount: false, // Don't refetch if we have cached data
    placeholderData: (previousData) => previousData, // Keep previous data while refetching
  });
}

// Saved tracks query with aggressive caching
export function useSpotifySavedTracks(enabled: boolean = true) {
  return useQuery({
    queryKey: spotifyQueryKeys.savedTracks,
    queryFn: async (): Promise<SpotifyTrack[]> => {
      try {
        return await spotifyService.getUserSavedTracks();
      } catch (error: any) {
        // If insufficient scope, return empty array instead of failing
        if (error?.message?.includes('Insufficient client scope')) {
          return [];
        }
        // Re-throw other errors
        throw error;
      }
    },
    enabled,
    staleTime: 15 * 60 * 1000, // 15 minutes - liked songs don't change that often
    gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache longer
    retry: (failureCount, error: any) => {
      // Don't retry on insufficient scope errors
      if (error?.message?.includes('Insufficient client scope')) {
        return false;
      }
      // Default retry behavior for other errors
      return failureCount < 3;
    },
    // Enable background refetch when user returns to app
    refetchOnWindowFocus: true,
    refetchOnMount: false, // Don't refetch if we have cached data
    // Keep previous data while refetching
    placeholderData: (previousData) => previousData,
  });
}

// Playlist tracks query with extended caching
export function usePlaylistTracks(playlistId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: playlistId ? spotifyQueryKeys.playlistTracks(playlistId) : ['spotify', 'playlist', 'none', 'tracks'],
    queryFn: async (): Promise<SpotifyTrack[]> => {
      if (!playlistId) return [];
      return await spotifyService.getPlaylistTracks(playlistId);
    },
    enabled: enabled && !!playlistId,
    staleTime: 15 * 60 * 1000, // 15 minutes - playlists don't change often
    gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache longer
    refetchOnMount: false, // Use cache if available
    placeholderData: (previousData) => previousData, // Keep previous data while refetching
  });
}

// Device list query with short-term caching and auto-refresh
export function useSpotifyDevices(enabled: boolean = true) {
  return useQuery({
    queryKey: spotifyQueryKeys.devices,
    queryFn: async () => {
      const devices = await spotifyService.getDevices();
      return devices ?? [];
    },
    enabled,
    staleTime: 30 * 1000, // 30 seconds - devices can change frequently
    gcTime: 60 * 1000, // 1 minute - don't keep too long
    refetchInterval: 30 * 1000, // Auto-refresh every 30 seconds when active
    retry: 2,
  });
}

// Queue status query for real-time progress updates
interface QueueStatus {
  isActive: boolean;
  progress: number;
  total: number;
  currentTrack?: string;
  playlistId?: string;
  playlistName?: string;
}

export function useQueueStatus(enabled: boolean = true) {
  return useQuery({
    queryKey: spotifyQueryKeys.queueStatus,
    queryFn: async (): Promise<QueueStatus> => {
      // This would be implemented to read from AsyncStorage or a service
      // For now, returning a default inactive state
      return {
        isActive: false,
        progress: 0,
        total: 0,
      };
    },
    enabled,
    staleTime: 1 * 1000, // 1 second - needs to be very fresh for progress
    refetchInterval: enabled ? 1 * 1000 : false, // Poll every second when enabled
  });
}

// Queue shuffle mutation
interface QueueShuffleParams {
  playlist: SpotifyPlaylist;
  tracks?: SpotifyTrack[];
}

export interface QueueShuffleProgress {
  isQueueing: boolean;
  progress: number;
  total: number;
  message: string | null;
}

// NOTE: batchQueueTracks has been removed and replaced with startBackgroundQueue
// from queueBackgroundService.ts which handles background execution properly

export function useQueueShuffleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (variables: QueueShuffleParams): Promise<boolean> => {
      const { playlist } = variables;
      let { tracks } = variables;

      // Fetch tracks if not provided
      if (!tracks || tracks.length === 0 || tracks.some(track => track.uri === null)) {
        if (playlist.id === 'liked-songs') {
          tracks = await queryClient.fetchQuery({
            queryKey: spotifyQueryKeys.savedTracks,
            queryFn: () => spotifyService.getUserSavedTracks(),
          });
        } else {
          tracks = await queryClient.fetchQuery({
            queryKey: spotifyQueryKeys.playlistTracks(playlist.id),
            queryFn: () => spotifyService.getPlaylistTracks(playlist.id),
          });
        }
      }

      if (!tracks || tracks.length === 0) return false;

      // Use smart shuffle with memory
      const { tracks: smartShuffledTracks, stats } = await getSmartShuffledTracks(
        playlist.id,
        tracks
      );

      if (!smartShuffledTracks || smartShuffledTracks.length === 0) {
        console.error('[QueueShuffle] Smart shuffle returned no tracks');
        return false;
      }

      const first = smartShuffledTracks[0];

      // Get Device and Play First Track
      const playlistUri = playlist.id === 'liked-songs' ? 'spotify:collection:tracks' : playlist.uri;
      const ensuredDeviceId = await spotifyService.ensureActiveDevice(first.uri, playlistUri);
      if (!ensuredDeviceId) {
        await showQueueErrorNotification('No active Spotify device found. Please open Spotify.');
        return false;
      }
      await spotifyService.transferPlayback(ensuredDeviceId, true);
      await spotifyService.playUris([first.uri], ensuredDeviceId);

      // Start background queue process with foreground service
      // This will continue even if the app is backgrounded
      const success = await startBackgroundQueue({
        playlistId: playlist.id,
        playlistName: playlist.name,
        tracks: smartShuffledTracks,
        deviceId: ensuredDeviceId,
        firstTrackUri: first.uri,
        stats: {
          remaining: stats.remaining,
        },
      });

      return success;
    },
    onSuccess: async (success, variables) => {
      if (success) {
        // Invalidate progress and stats queries to reflect updated state
        // This ensures UI updates after tracks are marked as played
        await queryClient.invalidateQueries({
          queryKey: spotifyQueryKeys.playlistProgress(variables.playlist.id),
        });
        await queryClient.invalidateQueries({
          queryKey: spotifyQueryKeys.globalStats,
        });
      }
    },
    onError: (error) => {
      if (error instanceof CancelledError) {
        console.log('Shuffle was cancelled by React Query.');
        dismissNotification();
        return;
      }

      console.error('Queue shuffle failed:', error);
      showQueueErrorNotification(error instanceof Error ? error.message : 'An error occurred');
    },
  });
}

// Playlist progress query - tracks how many songs have been heard
export function usePlaylistProgress(playlistId: string | null, totalTracks: number, enabled: boolean = true, enablePolling: boolean = false) {
  return useQuery({
    queryKey: playlistId ? spotifyQueryKeys.playlistProgress(playlistId) : ['spotify', 'playlist', 'none', 'progress'],
    queryFn: async (): Promise<ShuffleStats | null> => {
      if (!playlistId || totalTracks === 0) return null;
      return await getPlaylistProgress(playlistId, totalTracks);
    },
    enabled: enabled && !!playlistId && totalTracks > 0,
    staleTime: 3 * 1000, // 3 seconds - progress updates should be fresh
    gcTime: 60 * 1000, // 1 minute cache
    refetchOnMount: true, // Always fetch fresh on mount
    refetchOnWindowFocus: true, // Refetch when user returns to app
    refetchInterval: enablePolling ? 3 * 1000 : false, // Optional polling for real-time updates
    retry: 0, // Don't retry on error (progress is not critical)
  });
}

// Global stats query - aggregates statistics across all tracked playlists
export function useGlobalStats(enabled: boolean = true, enablePolling: boolean = false) {
  return useQuery({
    queryKey: spotifyQueryKeys.globalStats,
    queryFn: async (): Promise<GlobalStats> => {
      return await getGlobalStats();
    },
    enabled,
    staleTime: 3 * 1000, // 3 seconds - stats should be fresh
    gcTime: 60 * 1000, // 1 minute cache
    refetchOnMount: true, // Always fetch fresh when returning to profile
    refetchOnWindowFocus: true, // Refetch when user returns to app
    refetchInterval: enablePolling ? 3 * 1000 : false, // Optional polling for real-time updates
    retry: 0, // Don't retry on error (stats are not critical)
  });
}
