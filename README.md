# Flux Shuffle

Listen to every song in your playlist before hearing any repeats. A smarter way to shuffle that uses real randomness and remembers what you've already heard.

## What It Does

Flux Shuffle fixes the problem with regular shuffle—you know, when you hear the same few songs over and over while others get ignored. This app makes sure you hear every track in your playlist exactly once before any song repeats. It uses actual mathematical randomness (not the fake kind) and keeps track of what you've already listened to.

Works with your Spotify playlists and liked songs. Just connect your account, pick a playlist, and let it queue up your music in a truly random order.

## Key Features

**Smart Shuffle with Memory**
- Tracks which songs you've already heard in each playlist
- Guarantees you'll hear every song before any repeat
- Automatically adapts when you add or remove tracks from playlists
- Shows you exactly how many songs you have left to hear

**True Random Algorithm**
- Uses the Fisher-Yates shuffle for mathematically unbiased randomization
- Generates randomness from cryptographically secure sources
- No patterns, no favorites—just pure chaos in the best way

**Background Queue Processing**
- Keeps working even when you minimize the app
- Shows progress notifications as it queues your music
- Handles large playlists (500+ tracks) without breaking a sweat
- Automatically checks that your Spotify device is still connected

**Playlist Statistics**
- See how many times you've cycled through each playlist
- Track total songs heard across all your playlists
- Visual progress indicators on album artwork
- Find out which playlist you've shuffled the most

**Spotify Integration**
- Works with all your playlists, including collaborative ones
- Includes your liked songs as a special playlist
- Secure authentication using industry-standard OAuth 2.0
- Automatically refreshes access tokens so you stay logged in

## How It Works

The app uses a playlist fingerprinting system to detect when you've made changes. Add new songs, remove old ones, or reorder tracks—it'll notice and adjust accordingly. When you shuffle, it divides your unheard songs into manageable sets and queues them to Spotify.

For smaller playlists (under 150 tracks), it queues everything at once. Larger playlists get split into sets to keep things manageable while still ensuring you hear everything before repeats.

The shuffle memory persists between sessions, so you can close the app and come back later without losing your progress. It remembers exactly where you left off.

## Technologies

**Platform**
- React Native 0.81 with Expo 54
- TypeScript for type safety
- File-based routing with Expo Router

**State & Data**
- TanStack Query for server state management
- AsyncStorage for persistent local data
- Context API for authentication state

**UI & Animations**
- React Native Reanimated for smooth, native animations
- Expo Blur for backdrop effects
- Lucide icons for modern iconography
- Dark theme optimized for OLED screens

**Spotify Integration**
- spotify-web-api-node for API communication
- PKCE OAuth 2.0 flow for secure authentication
- Deep linking for redirect handling
- Automatic token refresh management

**Randomness & Algorithms**
- expo-crypto for cryptographically secure random generation
- FNV-1a hashing for efficient playlist change detection
- Fisher-Yates shuffle implementation

**Background Processing**
- Expo Task Manager for background execution
- Expo Notifications for Material 3 notifications
- Foreground service keeps app running on Android

**Cross-Platform**
- Native builds for iOS and Android
- Static web export for browser support
- Platform-specific optimizations

## License

MIT License