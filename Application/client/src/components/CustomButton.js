import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function CustomButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  textStyle,
}) {
  const getButtonStyle = () => {
    const base = [styles.button];
    if (variant === 'secondary') base.push(styles.buttonSecondary);
    if (variant === 'outline') base.push(styles.buttonOutline);
    if (disabled) base.push(styles.buttonDisabled);
    if (style) base.push(style);
    return base;
  };

  const getTextStyle = () => {
    const base = [styles.text];
    if (variant === 'outline') base.push(styles.textOutline);
    if (textStyle) base.push(textStyle);
    return base;
  };

  return (
    <TouchableOpacity
      style={getButtonStyle()}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' ? colors.primary : colors.surface} />
      ) : (
        <Text style={getTextStyle()}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonSecondary: {
    backgroundColor: colors.secondary,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  text: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: typography.semiBold,
  },
  textOutline: {
    color: colors.primary,
  },
});
