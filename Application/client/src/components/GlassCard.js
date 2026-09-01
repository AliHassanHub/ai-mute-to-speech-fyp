import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';

export default function GlassCard({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 6,
  },
});
