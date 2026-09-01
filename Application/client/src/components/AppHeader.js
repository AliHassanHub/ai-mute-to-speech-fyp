import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function AppHeader({
  title,
  subtitle,
  showBack = false,
  onBackPress,
  rightIcon,
  onRightPress,
}) {
  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {showBack && (
          <Pressable
            onPress={onBackPress}
            style={styles.backButton}
            hitSlop={10}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        )}
        <View>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {rightIcon && (
        <Pressable onPress={onRightPress} style={styles.rightButton} hitSlop={10}>
          <Ionicons name={rightIcon} size={22} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15,23,42,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  title: {
    fontSize: typography.h3,
    fontWeight: typography.bold,
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    fontSize: typography.small,
    color: colors.textSecondary,
  },
  rightButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(15,23,42,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
});
