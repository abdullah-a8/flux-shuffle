import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator, TouchableOpacity } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSpotify } from '@/contexts/SpotifyContext';
import { useQueueShuffleMutation, useSpotifyDevices, usePlaylistProgress, useActiveQueuePlaylistId } from '@/hooks/useSpotifyQueries';
import { Music, Play, AlertCircle } from 'lucide-react-native';
import AlertModal from '@/components/AlertModal';
import PlaylistProgressIndicator from '@/components/PlaylistProgressIndicator';
import { hasQueuedSongs, openSpotifyApp } from '@/utils/spotify';
import { initializeNotifications } from '@/utils/notificationService';
import { addRecentPlaylist } from '@/utils/recentPlaylists';
import { isQueueActive } from '@/services/queueBackgroundService';
import type { SpotifyPlaylist } from '@/types/spotify';

// Helper function to get time-based greeting
function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return 'Good morning';
  } else if (hour >= 12 && hour < 17) {
    return 'Good afternoon';
  } else if (hour >= 17 && hour < 22) {
    return 'Good evening';
  } else {
    return 'Good night';
  }
}

// Animated Playlist Card Component
function AnimatedPlaylistCard({
  playlist,
  isLoading,
  isDisabled,
  isQueueing,
  onPress
}: {
  playlist: SpotifyPlaylist;
  isLoading: boolean;
  isDisabled: boolean;
  isQueueing: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  // Fetch progress stats for this playlist
  // Enable polling only when not currently loading/processing
  const { data: progressStats } = usePlaylistProgress(
    playlist.id,
    playlist.tracks.total,
    !isLoading && !isDisabled && !isQueueing
  );

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  const handlePressIn = () => {
    scale.value = withSpring(0.95, {
      damping: 15,
      stiffness: 150,
    });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, {
      damping: 15,
      stiffness: 150,
    });
  };

  // Format metadata with progress info
  const getMetaText = () => {
    if (isLoading) {
      return 'Loading your liked songs...';
    }

    if (isQueueing) {
      return 'Queueing tracks...';
    }

    const baseText = `${playlist.tracks.total} tracks • ${playlist.owner.display_name}`;

    // Add unheard count if we have progress stats
    if (progressStats && progressStats.remaining > 0) {
      return `${playlist.tracks.total} tracks • ${progressStats.remaining} unheard`;
    }

    return baseText;
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
    >
      <Animated.View style={[
        styles.playlistCard,
        (isLoading || isQueueing) && styles.playlistCardLoading,
        animatedStyle
      ]}>
        <View style={styles.playlistImageContainer}>
          <Image
            source={{
              uri: playlist.images?.[0]?.url || 'https://images.pexels.com/photos/1389429/pexels-photo-1389429.jpeg?auto=compress&cs=tinysrgb&w=300&h=300&fit=crop'
            }}
            style={[
              styles.playlistImage,
              (isLoading || isQueueing) && styles.playlistImageLoading
            ]}
          />
          {(isLoading || isQueueing) && (
            <View style={styles.playlistLoadingOverlay}>
              <ActivityIndicator size="small" color="#1DB954" />
            </View>
          )}
          {/* Progress indicator overlay */}
          {!isLoading && !isQueueing && (
            <PlaylistProgressIndicator stats={progressStats ?? null} size={60} strokeWidth={3} />
          )}
        </View>
        <View style={styles.playlistInfo}>
          <Text style={styles.playlistName} numberOfLines={2}>
            {playlist.name}
          </Text>
          <Text style={styles.playlistMeta}>
            {getMetaText()}
          </Text>
        </View>
        <View style={[
          styles.playButton,
          (isLoading || isQueueing) && styles.playButtonDisabled
        ]}>
          {isLoading || isQueueing ? (
            <ActivityIndicator size="small" color="#1DB954" />
          ) : (
            <Play size={20} color="#000" fill="#1DB954" />
          )}
        </View>
      </Animated.View>
    </Pressable>
  );
}

export default function HomeTab() {
  const {
    isAuthenticated,
    isLoading,
    user,
    allPlaylistsWithLiked,
    playlistsLoading,
    savedTracksLoading,
    needsReauth,
    login
  } = useSpotify();

  // Alert modal state
  const [alertModal, setAlertModal] = useState({
    isVisible: false,
    type: 'generic' as 'no-device' | 'queue-not-empty' | 'generic',
    pendingPlaylist: null as SpotifyPlaylist | null,
    queueCount: 0,
  });

  // Queue mutation (now uses notifications)
  const { mutate: shufflePlaylist, isPending } = useQueueShuffleMutation();

  // Device query with caching
  const { data: devices = [], refetch: refetchDevices } = useSpotifyDevices(isAuthenticated);

  // Active queue playlist ID for showing loading state
  const { data: activeQueuePlaylistId } = useActiveQueuePlaylistId();

  // Initialize notifications on mount
  useEffect(() => {
    initializeNotifications().then(hasPermission => {
      if (!hasPermission) {
        console.log('[HomeTab] Notification permissions not granted');
      }
    });
  }, []);

  const handleLogin = async () => {
    await login();
  };

  const handlePlaylistSelect = async (playlist: SpotifyPlaylist) => {
    try {
      // ✅ Check if a queue is already processing
      const queueIsActive = await isQueueActive();
      if (queueIsActive) {
        console.log('[HomeTab] Queue already active, ignoring playlist selection');
        return;
      }

      // Check for active device using cached devices
      const hasDevice = devices && devices.length > 0;
      if (!hasDevice) {
        // Refetch devices to be sure before showing error
        const { data: freshDevices } = await refetchDevices();
        if (!freshDevices || freshDevices.length === 0) {
          setAlertModal({
            isVisible: true,
            type: 'no-device',
            pendingPlaylist: playlist,
            queueCount: 0,
          });
          return;
        }
      }

      // Check if queue has songs
      const queueStatus = await hasQueuedSongs();
      if (queueStatus.hasQueue) {
        setAlertModal({
          isVisible: true,
          type: 'queue-not-empty',
          pendingPlaylist: playlist,
          queueCount: queueStatus.queueCount,
        });
        return;
      }

      // Add to recent playlists
      await addRecentPlaylist(playlist.id);

      // All checks passed, proceed with shuffle
      proceedWithShuffle(playlist);
    } catch (error) {
      console.error('Error checking prerequisites:', error);
      // If checks fail, still allow the user to try
      proceedWithShuffle(playlist);
    }
  };

  const proceedWithShuffle = (playlist: SpotifyPlaylist) => {
    // Simply trigger the mutation - notifications will handle UI feedback
    shufflePlaylist({ playlist });
  };

  const handleAlertPrimaryAction = async () => {
    const { pendingPlaylist, type } = alertModal;
    
    // If it's a no-device alert, open Spotify
    if (type === 'no-device') {
      setAlertModal({ isVisible: false, type: 'generic', pendingPlaylist: null, queueCount: 0 });

      // Open Spotify app to the specific playlist
      const playlistId = pendingPlaylist?.id === 'liked-songs' ? 'liked-songs' : pendingPlaylist?.id;
      await openSpotifyApp(playlistId);
      
      // Wait longer for Spotify to start up and register device, then retry with multiple attempts
      const retryWithBackoff = async (attempt: number = 1, maxAttempts: number = 3) => {
        if (attempt > maxAttempts || !pendingPlaylist) {
          return;
        }

        const delay = 2000 * attempt; // 2s, 4s, 6s
        await new Promise(resolve => setTimeout(resolve, delay));

        // Check if device is available now by refetching devices
        const { data: freshDevices } = await refetchDevices();
        const hasDevice = freshDevices && freshDevices.length > 0;

        if (hasDevice) {
          // Device found! Proceed with shuffle
          await handlePlaylistSelect(pendingPlaylist);
        } else if (attempt < maxAttempts) {
          // No device yet, try again
          console.log(`[HomeTab] No device found on attempt ${attempt}, retrying...`);
          await retryWithBackoff(attempt + 1, maxAttempts);
        } else {
          // Give up after max attempts, show the modal again
          console.log('[HomeTab] No device found after all attempts');
          setAlertModal({
            isVisible: true,
            type: 'no-device',
            pendingPlaylist,
            queueCount: 0,
          });
        }
      };
      
      retryWithBackoff(1, 3);
    } else {
      // For other alerts, just close and retry
      setAlertModal({ isVisible: false, type: 'generic', pendingPlaylist: null, queueCount: 0 });

      if (pendingPlaylist) {
        // Refetch devices before retrying
        await refetchDevices();
        // Re-run the checks and proceed if they pass
        await handlePlaylistSelect(pendingPlaylist);
      }
    }
  };

  const handleAlertClose = () => {
    setAlertModal({ isVisible: false, type: 'generic', pendingPlaylist: null, queueCount: 0 });
  };

  // Automatically trigger login if not authenticated
  React.useEffect(() => {
    if (!isAuthenticated && !isLoading) {
      handleLogin();
    }
  }, [isAuthenticated, isLoading]);

  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#1DB954" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Show a loading state while attempting to log in
  if (!isAuthenticated) {
    return (
      <View style={styles.centerContainer}>
        <Music size={80} color="#1DB954" />
        <Text style={styles.title}>Flux Shuffle</Text>
        <Text style={styles.subtitle}>
          Connecting to Spotify...
        </Text>
        <ActivityIndicator size="large" color="#1DB954" style={styles.loginIndicator} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView style={styles.container}>
        <View style={styles.headerContainer}>
          <LinearGradient
            colors={['#1a1a1a', '#0d0d0d', '#000000']}
            locations={[0, 0.5, 1]}
            style={styles.gradientHeader}
          >
            <Text style={styles.greetingText}>{getTimeBasedGreeting()}, {user?.display_name}</Text>
            <Text style={styles.headerSubtext}>Choose a playlist to shuffle</Text>
          </LinearGradient>
        </View>

        {/* Re-authentication banner */}
        {needsReauth && (
          <View style={styles.reauthBanner}>
            <AlertCircle size={20} color="#ff6b35" />
            <View style={styles.reauthContent}>
              <Text style={styles.reauthTitle}>Update Required</Text>
              <Text style={styles.reauthText}>
                To access your Liked Songs, please reconnect your Spotify account.
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.reauthButton} 
              onPress={login}
            >
              <Text style={styles.reauthButtonText}>Reconnect</Text>
            </TouchableOpacity>
          </View>
        )}

        {playlistsLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#1DB954" />
            <Text style={styles.loadingText}>Loading playlists...</Text>
          </View>
        ) : allPlaylistsWithLiked.length === 0 ? (
          <View style={styles.centerContainer}>
            <Text style={styles.loadingText}>No playlists found</Text>
          </View>
        ) : (
          <View style={styles.playlistGrid}>
            {allPlaylistsWithLiked.map((playlist) => {
              const isLikedSongs = playlist.id === 'liked-songs';
              const isLikedSongsLoading = isLikedSongs && savedTracksLoading;
              const isThisPlaylistQueueing = activeQueuePlaylistId === playlist.id;

              return (
                <AnimatedPlaylistCard
                  key={playlist.id}
                  playlist={playlist}
                  isLoading={isLikedSongsLoading}
                  isDisabled={isPending || isLikedSongsLoading || !!activeQueuePlaylistId}
                  isQueueing={isThisPlaylistQueueing}
                  onPress={() => handlePlaylistSelect(playlist)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* 🚨 Alert modal for device and queue checks */}
      <AlertModal
        isVisible={alertModal.isVisible}
        type={alertModal.type}
        queueCount={alertModal.queueCount}
        onPrimaryPress={handleAlertPrimaryAction}
        onSecondaryPress={handleAlertClose}
        onClose={handleAlertClose}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#000',
  },
  headerContainer: {
    overflow: 'hidden',
  },
  gradientHeader: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 28,
  },
  greetingText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -0.5,
    lineHeight: 38,
    marginBottom: 12,
  },
  headerSubtext: {
    fontSize: 16,
    fontWeight: '400',
    color: '#a0a0a0',
    letterSpacing: 0.3,
    lineHeight: 24,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: -0.5,
    lineHeight: 34,
    marginBottom: 12,
  },
  header: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 24,
    marginBottom: 16,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#b3b3b3',
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 20,
    lineHeight: 24,
  },
  loginButton: {
    backgroundColor: '#1DB954',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 25,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  loginButtonText: {
    color: '#000',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  loadingText: {
    color: '#b3b3b3',
    fontSize: 16,
    marginTop: 16,
  },
  playlistGrid: {
    padding: 16,
    gap: 16,
  },
  playlistCard: {
    flexDirection: 'row',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginBottom: 8,
  },
  playlistCardLoading: {
    opacity: 0.7,
  },
  playlistImageContainer: {
    position: 'relative',
    width: 60,
    height: 60,
  },
  playlistImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  playlistImageLoading: {
    opacity: 0.5,
  },
  playlistLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 8,
  },
  playlistInfo: {
    flex: 1,
    marginLeft: 16,
  },
  playlistName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  playlistMeta: {
    color: '#b3b3b3',
    fontSize: 14,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1DB954',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButtonDisabled: {
    backgroundColor: 'rgba(29, 185, 84, 0.3)', // Dimmed Spotify green for cohesive look
  },
  reauthBanner: {
    flexDirection: 'row',
    backgroundColor: '#2a1810',
    borderColor: '#ff6b35',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    alignItems: 'center',
  },
  reauthContent: {
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
  },
  reauthTitle: {
    color: '#ff6b35',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  reauthText: {
    color: '#b3b3b3',
    fontSize: 14,
    lineHeight: 18,
  },
  reauthButton: {
    backgroundColor: '#ff6b35',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  reauthButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
  },
  loginIndicator: {
    marginTop: 24,
  },
});