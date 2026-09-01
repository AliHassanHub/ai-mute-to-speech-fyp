import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function SectionHeader({ title, style }) {
  return <Text style={[styles.header, style]}>{title}</Text>;
}

const styles = StyleSheet.create({
  header: {
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
});
