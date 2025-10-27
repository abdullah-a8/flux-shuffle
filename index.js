/**
 * App Entry Point
 *
 * This file is the first to execute when the app starts.
 * It MUST register all background tasks in the global scope
 * before the React components are loaded.
 *
 * IMPORTANT: Do NOT import React or React Native components here.
 * Only register tasks using expo-task-manager.
 */

// Register background queue task BEFORE app initialization
// This is required by expo-task-manager - tasks must be defined in global scope
import './services/queueBackgroundService';

// Now load the actual Expo Router entry point
import 'expo-router/entry';
