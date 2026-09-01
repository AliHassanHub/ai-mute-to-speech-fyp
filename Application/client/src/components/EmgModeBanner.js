import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function EmgModeBanner({ mode }) {
  if (mode !== 'simulated') {
    return null;
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.title}>Demo / Simulation Mode</Text>
      <Text style={styles.subtitle}>
        EMG samples are simulated. Connect hardware for real sensor data.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: typography.caption,
    fontWeight: typography.bold,
    color: colors.warning,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.small,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
