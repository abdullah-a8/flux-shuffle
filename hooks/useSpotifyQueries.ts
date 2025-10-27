import { useQuery, useMutation, useQueryClient, CancelledError } from '@tanstack/react-query';
import { SpotifyService } from '@/utils/spotify';
import type { SpotifyUser, SpotifyPlaylist, SpotifyTrack } from '@/types/spotify';
import { getSmartShuffledTracks, type ShuffleStats } from '@/utils/smartShuffle';
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
};

// User query
export function useSpotifyUser() {
  return useQuery({
    queryKey: spotifyQueryKeys.user,
    queryFn: async (): Promise<SpotifyUser | null> => {
      return await spotifyService.getCurrentUser();
    },
    staleTime: 10 * 60 * 1000, // 10 minutes
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
          console.warn('[useSpotifySavedTracks] Insufficient scope for saved tracks');
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

// Playlist tracks query
export function usePlaylistTracks(playlistId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: playlistId ? spotifyQueryKeys.playlistTracks(playlistId) : ['spotify', 'playlist', 'none', 'tracks'],
    queryFn: async (): Promise<SpotifyTrack[]> => {
      if (!playlistId) return [];
      return await spotifyService.getPlaylistTracks(playlistId);
    },
    enabled: enabled && !!playlistId,
    staleTime: 2 * 60 * 1000, // 2 minutes
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
      console.log(`[QueueShuffle] Using smart shuffle for playlist: ${playlist.id}`);
      
      const { tracks: smartShuffledTracks, stats } = await getSmartShuffledTracks(
        playlist.id,
        tracks
      );

      if (!smartShuffledTracks || smartShuffledTracks.length === 0) {
        console.error('[QueueShuffle] Smart shuffle returned no tracks');
        return false;
      }

      const first = smartShuffledTracks[0];
      const rest = smartShuffledTracks.slice(1);
      const totalToQueue = rest.length;

      console.log(`[QueueShuffle] Smart Shuffle Stats:`, stats);
      console.log(`[QueueShuffle] Queueing ${totalToQueue + 1} tracks`);
      
      if (stats.cycleComplete) {
        console.log('✨ [QueueShuffle] Cycle complete! Starting fresh with all songs.');
      }

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
