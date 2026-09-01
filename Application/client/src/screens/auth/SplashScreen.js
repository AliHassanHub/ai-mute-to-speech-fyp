import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

const LOGO_SIZE = 100;

export default function SplashScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Image
          source={require('../../../assets/app-logo.png')}
          style={[styles.logoImage, { width: LOGO_SIZE, height: LOGO_SIZE }]}
          resizeMode="contain"
        />
        <Text style={styles.appName}>AI Mute-to-Speech</Text>
        <Text style={styles.tagline}>EMG to Speech Conversion</Text>
      </View>
      <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  logoContainer: { alignItems: 'center', marginBottom: spacing.xxl },
  logoImage: { marginBottom: spacing.lg },
  appName: {
    fontSize: typography.h1,
    fontWeight: typography.bold,
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  tagline: { fontSize: typography.caption, color: colors.textSecondary },
  loader: { marginTop: spacing.xl },
});
