import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GlassCard from './GlassCard';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function SettingsItem({
  title,
  icon,
  iconColor,
  rightElement,
  onPress,
  style,
}) {
  const iconTint = iconColor ?? colors.primary;
  const content = (
    <View style={styles.inner}>
      {icon != null && (
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={24} color={iconTint} />
        </View>
      )}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>
        {rightElement}
        {onPress ? (
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        ) : null}
      </View>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[styles.wrapper, style]}>
        <GlassCard style={styles.card}>{content}</GlassCard>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.wrapper, style]}>
      <GlassCard style={styles.card}>{content}</GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: { marginRight: spacing.md },
  title: {
    flex: 1,
    fontSize: typography.body,
    color: colors.text,
    fontWeight: typography.medium,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
