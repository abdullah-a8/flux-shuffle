import React from 'react';
import { View, Text, StyleSheet, Pressable, Image, ScrollView } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useSpotify } from '@/contexts/SpotifyContext';
import { LogOut, Mail, Crown } from 'lucide-react-native';

export default function ProfileTab() {
  const { user, logout } = useSpotify();
  const scale = useSharedValue(1);

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

  const handleLogout = async () => {
    await logout();
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
        </View>

        {user && (
          <>
            {/* Profile Card */}
            <View style={styles.profileCard}>
              <View style={styles.imageContainer}>
                <Image
                  source={{
                    uri: user.images[0]?.url || 'https://images.pexels.com/photos/771742/pexels-photo-771742.jpeg?auto=compress&cs=tinysrgb&w=150&h=150&fit=crop'
                  }}
                  style={styles.userImage}
                />
                {user.product && (
                  <View style={styles.premiumBadge}>
                    <Crown size={12} color="#1DB954" fill="#1DB954" />
                  </View>
                )}
              </View>

              <Text style={styles.userName}>{user.display_name}</Text>

              {user.product && (
                <View style={styles.premiumPill}>
                  <Text style={styles.premiumText}>
                    {user.product === 'premium' ? 'Premium Member' : user.product.toUpperCase()}
                  </Text>
                </View>
              )}
            </View>

            {/* Account Info Card */}
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <View style={styles.iconContainer}>
                  <Mail size={18} color="#1DB954" />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Email</Text>
                  <Text style={styles.infoValue}>{user.email}</Text>
                </View>
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Fixed Disconnect Button */}
      <View style={styles.footer}>
        <Pressable
          onPress={handleLogout}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
        >
          <Animated.View style={[styles.logoutButton, animatedStyle]}>
            <LogOut size={20} color="#dc2626" />
            <Text style={styles.logoutText}>Disconnect from Spotify</Text>
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 32,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: -0.5,
  },

  // Profile Card Styles
  profileCard: {
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
    marginHorizontal: 24,
    marginBottom: 20,
    paddingVertical: 40,
    paddingHorizontal: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  imageContainer: {
    position: 'relative',
    marginBottom: 20,
  },
  userImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1a1a1a',
    borderWidth: 3,
    borderColor: '#1DB954',
  },
  premiumBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#0a0a0a',
    borderRadius: 16,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1DB954',
  },
  userName: {
    fontSize: 26,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  premiumPill: {
    backgroundColor: 'rgba(29, 185, 84, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.3)',
  },
  premiumText: {
    color: '#1DB954',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // Info Card Styles
  infoCard: {
    backgroundColor: '#0a0a0a',
    marginHorizontal: 24,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(29, 185, 84, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 15,
    color: '#fff',
    fontWeight: '500',
  },

  // Footer Styles
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 16,
    backgroundColor: '#000',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(220, 38, 38, 0.4)',
  },
  logoutText: {
    color: '#dc2626',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 10,
    letterSpacing: 0.2,
  },
});