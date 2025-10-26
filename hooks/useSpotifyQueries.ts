import { useQuery, useMutation, useQueryClient, CancelledError } from '@tanstack/react-query';
import { SpotifyService } from '@/utils/spotify';
import type { SpotifyUser, SpotifyPlaylist, SpotifyTrack } from '@/types/spotify';
import { getSmartShuffledTracks, type ShuffleStats } from '@/utils/smartShuffle';

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

async function batchQueueTracks({
  tracks,
  deviceId,
  onProgress,
}: {
  tracks: SpotifyTrack[];
  deviceId: string;
  onProgress: (progress: { progress: number; total: number }) => void;
}) {
  const trackUris = tracks.map(t => t.uri);
  const total = trackUris.length;
  let completed = 0;

  // Queue tracks one by one to avoid rate limiting
  for (let i = 0; i < trackUris.length; i++) {
    const uri = trackUris[i];
    
    // Retry logic with exponential backoff for 429 errors
    let retryCount = 0;
    const maxRetries = 3;
    let success = false;
    
    while (!success && retryCount <= maxRetries) {
      try {
        await spotifyService.addToQueue(uri, deviceId);
        success = true;
      } catch (error: any) {
        if (error?.status === 429 || (error?.message && error.message.includes('429'))) {
          retryCount++;
          if (retryCount <= maxRetries) {
            // Exponential backoff: 1s, 2s, 4s
            const delay = Math.pow(2, retryCount - 1) * 1000;
            console.log(`Rate limited, retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.error(`Failed to queue track after ${maxRetries} retries:`, error);
            // Continue with next track instead of failing completely
          }
        } else {
          console.error('Error queueing track:', error);
          break; // Don't retry for non-rate-limit errors
        }
      }
    }

    completed++;
    onProgress({ progress: completed, total });

    // Add delay between requests to be respectful to the API
    // Skip delay on the last track
    if (i < trackUris.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 150)); // 150ms between requests
    }
  }
}

export function useQueueShuffleMutation(
  onProgressUpdate?: (progress: QueueShuffleProgress) => void
) {
  const queryClient = useQueryClient(); // Get the query client instance

  return useMutation({
    mutationFn: async (variables: QueueShuffleParams): Promise<boolean> => {
      const { playlist } = variables;
      let { tracks } = variables;

      // ✅ If tracks aren't provided, fetch them right here!
      if (!tracks || tracks.length === 0 || tracks.some(track => track.uri === null)) {
        // Check if this is the special "Liked Songs" playlist
        if (playlist.id === 'liked-songs') {
          // Fetch saved tracks instead of playlist tracks
          tracks = await queryClient.fetchQuery({
            queryKey: spotifyQueryKeys.savedTracks,
            queryFn: () => spotifyService.getUserSavedTracks(),
          });
        } else {
          // Use fetchQuery to get the data from the cache or network
          tracks = await queryClient.fetchQuery({
            queryKey: spotifyQueryKeys.playlistTracks(playlist.id),
            queryFn: () => spotifyService.getPlaylistTracks(playlist.id),
          });
        }
      }
      
      if (!tracks || tracks.length === 0) return false;

      // 🎯 Use smart shuffle with memory to ensure all songs play before repeating
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
      console.log(`[QueueShuffle] Queueing ${totalToQueue + 1} tracks (${stats.played + smartShuffledTracks.length}/${tracks.length} will be played after this)`);
      
      if (stats.cycleComplete) {
        console.log('✨ [QueueShuffle] Cycle complete! Starting fresh with all songs.');
      }

      // 1. Get Device and Play First Track
      const playlistUri = playlist.id === 'liked-songs' ? 'spotify:collection:tracks' : playlist.uri;
      const ensuredDeviceId = await spotifyService.ensureActiveDevice(first.uri, playlistUri);
      if (!ensuredDeviceId) {
        //await spotifyService.openSpotifyApp(playlist.id);
        return false;
      }
      await spotifyService.transferPlayback(ensuredDeviceId, true);
      await spotifyService.playUris([first.uri], ensuredDeviceId);

      // 2. Start Batch Queueing with Smart Shuffle Info
      // Note: We're queueing smartShuffledTracks.length total (not stats.remaining which is AFTER this operation)
      const initialMessage = stats.cycleComplete
        ? '✨ Cycle complete! Starting fresh with unheard songs...'
        : `Queueing ${smartShuffledTracks.length} unheard songs (${stats.percentage}% of playlist explored)...`;
        
      onProgressUpdate?.({
        isQueueing: true,
        progress: 0,
        total: totalToQueue,
        message: initialMessage,
      });

      // Queue the tracks (excluding first which is already playing)
      await batchQueueTracks({
        tracks: rest,
        deviceId: ensuredDeviceId,
        onProgress: ({ progress, total }) => {
          // Note: stats.played already includes the current batch we're queueing
          // So we just show the queueing progress, not double-counting
          const progressMessage = `Queued ${progress}/${total} tracks...`;
            
          onProgressUpdate?.({
            isQueueing: true,
            progress,
            total,
            message: progressMessage,
          });
        },
      });

      // 3. Finalize with Smart Shuffle Stats
      // Note: totalToQueue is rest.length, but we also played first track, so +1
      const totalProcessed = totalToQueue + 1;
      const finalMessage = stats.remaining > 0
        ? `✅ Queued ${totalProcessed} songs! ${stats.remaining} unheard songs remaining.`
        : `✅ All songs queued! Next shuffle will start a fresh cycle.`;
        
      onProgressUpdate?.({ 
        isQueueing: false, 
        progress: totalToQueue, 
        total: totalToQueue, 
        message: finalMessage 
      });
      
      // Show final message briefly before clearing
      if (finalMessage) {
        setTimeout(() => {
          onProgressUpdate?.({ isQueueing: false, progress: totalToQueue, total: totalToQueue, message: null });
        }, 2000);
      }
      
      //await spotifyService.openSpotifyApp(playlist.id);

      return true;
    },
    onError: (error) => {
      // CANCELLATION HANDLING: Check if the error is a CancelledError
      if (error instanceof CancelledError) {
        console.log('Shuffle was cancelled by React Query.');
        // We don't need to show a generic error message for a user-initiated cancellation
        onProgressUpdate?.({ isQueueing: false, progress: 0, total: 0, message: null });
        return;
      }
      
      // Handle actual errors
      console.error('Queue shuffle failed:', error);
      onProgressUpdate?.({ isQueueing: false, progress: 0, total: 0, message: 'An error occurred.' });
    },
  });
}
