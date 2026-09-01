import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function StatCard({ label, value, accent }) {
  return (
    <GlassCard style={styles.card}>
      <Text style={[styles.value, accent && { color: accent }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'flex-start',
  },
  value: {
    fontSize: typography.h3,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: typography.small,
    color: colors.textSecondary,
  },
});
