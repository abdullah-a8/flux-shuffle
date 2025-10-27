import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { AlertTriangle, Smartphone, Music } from 'lucide-react-native';

interface AlertModalProps {
  isVisible: boolean;
  type: 'no-device' | 'queue-not-empty' | 'generic';
  title?: string;
  message?: string;
  primaryButtonText?: string;
  secondaryButtonText?: string;
  queueCount?: number;
  onPrimaryPress?: () => void;
  onSecondaryPress?: () => void;
  onClose?: () => void;
}

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);

export default function AlertModal({
  isVisible,
  type,
  title,
  message,
  primaryButtonText,
  secondaryButtonText,
  queueCount,
  onPrimaryPress,
  onSecondaryPress,
  onClose,
}: AlertModalProps) {
  // Shared values for animations
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (isVisible) {
      // Animate the modal into view
      opacity.value = withTiming(1, { duration: 200 });
      scale.value = withSpring(1, { damping: 15, stiffness: 120 });
    } else {
      // Animate out when hiding
      opacity.value = withTiming(0, { duration: 150 });
      scale.value = withTiming(0.9, { duration: 150 });
    }
  }, [isVisible]);

  // Animated styles
  const animatedCardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  if (!isVisible) {
    return null;
  }

  // Get default content based on type
  const getContent = () => {
    switch (type) {
      case 'no-device':
        return {
          icon: <Smartphone size={56} color="#1DB954" />,
          title: title || 'Spotify Not Active',
          description: message || 'Start playing any song on Spotify to activate your device, then return here.',
          primaryButtonText: primaryButtonText || 'Open Spotify',
          secondaryButtonText: secondaryButtonText || 'Cancel',
          showSteps: true,
          steps: [
            'Open Spotify app',
            'Play any song',
            'Return and shuffle'
          ],
        };
      case 'queue-not-empty':
        return {
          icon: <Music size={56} color="#1DB954" />,
          title: title || 'Clear Queue First',
          description: message || (queueCount 
            ? `Found ${queueCount} song${queueCount === 1 ? '' : 's'} in your queue. Clear it for the best experience.`
            : 'Clear your Spotify queue for the best shuffle experience.'),
          primaryButtonText: primaryButtonText || 'Done, Try Again',
          secondaryButtonText: secondaryButtonText || 'Cancel',
          showSteps: false,
        };
      default:
        return {
          icon: <AlertTriangle size={56} color="#FF9500" />,
          title: title || 'Alert',
          description: message || 'Something needs your attention.',
          primaryButtonText: primaryButtonText || 'OK',
          secondaryButtonText: secondaryButtonText || 'Cancel',
          showSteps: false,
        };
    }
  };

  const content = getContent();

  return (
    <View style={StyleSheet.absoluteFill}>
      <AnimatedBlurView 
        intensity={80} 
        tint="dark" 
        style={styles.backdrop}
      >
        <Animated.View style={[styles.alertCard, animatedCardStyle]}>
          {/* Icon */}
          <View style={styles.iconContainer}>
            {content.icon}
          </View>
          
          {/* Title */}
          <Text style={styles.alertTitle}>{content.title}</Text>
          
          {/* Description */}
          <Text style={styles.alertDescription}>{content.description}</Text>
          
          {/* Steps (optional) */}
          {content.showSteps && content.steps && (
            <View style={styles.stepsContainer}>
              {content.steps.map((step, index) => (
                <View key={index} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
            </View>
          )}
          
          {/* Buttons */}
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={onPrimaryPress || onClose}
              activeOpacity={0.8}
            >
              <Text style={styles.primaryButtonText}>{content.primaryButtonText}</Text>
            </TouchableOpacity>
            
            {content.secondaryButtonText && (
              <TouchableOpacity
                style={[styles.button, styles.secondaryButton]}
                onPress={onSecondaryPress || onClose}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryButtonText}>{content.secondaryButtonText}</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </AnimatedBlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  alertCard: {
    backgroundColor: '#121212',
    borderRadius: 28,
    padding: 32,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 40,
    elevation: 20,
    borderWidth: 1,
    borderColor: 'rgba(29, 185, 84, 0.15)',
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(29, 185, 84, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  alertTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  alertDescription: {
    color: '#9CA3AF',
    fontSize: 15,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  stepsContainer: {
    width: '100%',
    backgroundColor: 'rgba(29, 185, 84, 0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 28,
    gap: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1DB954',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  stepText: {
    color: '#E5E7EB',
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButton: {
    backgroundColor: '#1DB954',
    shadowColor: '#1DB954',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  secondaryButtonText: {
    color: '#9CA3AF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
});
