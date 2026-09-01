import React, { useState } from 'react';
import { View, TextInput, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  error,
  editable = true,
  style,
  onBlur,
}) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isPasswordField = secureTextEntry;

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={[styles.label, error && styles.labelError]}>{label}</Text> : null}
      <View style={styles.inputWrapper}>
        <TextInput
          style={[
            styles.input,
            isPasswordField && styles.inputWithToggle,
            error && styles.inputError,
            !editable && styles.inputDisabled,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={isPasswordField && !isPasswordVisible}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          editable={editable}
          autoCorrect={false}
          onBlur={onBlur}
        />
        {isPasswordField && editable ? (
          <Pressable
            style={styles.toggleButton}
            onPress={() => setIsPasswordVisible((prev) => !prev)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
          >
            <Ionicons
              name={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  label: {
    fontSize: typography.caption,
    fontWeight: typography.medium,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  labelError: {
    color: colors.error,
  },
  inputWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.body,
    color: colors.text,
  },
  inputWithToggle: {
    paddingRight: spacing.xl + spacing.md,
  },
  inputDisabled: {
    backgroundColor: colors.border + '40',
    color: colors.textSecondary,
  },
  inputError: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  toggleButton: {
    position: 'absolute',
    right: spacing.md,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    fontSize: typography.small,
    color: colors.error,
    marginTop: spacing.xs,
  },
});
