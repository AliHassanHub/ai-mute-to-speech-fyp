import React, { useRef } from 'react';
import { Text, StyleSheet, Pressable, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function GradientButton({
  title,
  onPress,
  disabled = false,
  style,
  textStyle,
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (toValue) => {
    Animated.timing(scale, {
      toValue,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => !disabled && animateTo(0.97)}
      onPressOut={() => !disabled && animateTo(1)}
      style={({ pressed }) => [style, disabled && styles.disabled, pressed && !disabled && { opacity: 0.95 }]}
    >
      <Animated.View style={[styles.outer, { transform: [{ scale }] }]}>
        <LinearGradient
          colors={[colors.primary, colors.secondary]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <Text style={[styles.text, textStyle]}>{title}</Text>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  outer: {
    borderRadius: 999,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  gradient: {
    minHeight: 52,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: typography.semiBold,
  },
  disabled: {
    opacity: 0.45,
  },
});
