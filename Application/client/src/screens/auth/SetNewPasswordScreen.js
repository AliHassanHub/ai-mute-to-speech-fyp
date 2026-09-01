import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { GradientButton, InputField, AppHeader } from '../../components';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { useFieldErrors } from '../../hooks/useFieldErrors';
import { authApi } from '../../services/api';
import { getErrorMessage } from '../../utils/apiHelpers';
import {
  validatePassword,
  validateConfirmPassword,
  hasValidationErrors,
} from '../../utils/validation';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function SetNewPasswordScreen({ navigation, route }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { errors, setMultiple, clearFieldError } = useFieldErrors();
  const dialog = useDialog();
  const { showToast } = useToast();
  const email = route.params?.email ?? '';

  const validateForm = () => {
    const nextErrors = {
      newPassword: validatePassword(newPassword),
      confirmPassword: validateConfirmPassword(newPassword, confirmPassword),
    };
    setMultiple(nextErrors);
    return !hasValidationErrors(nextErrors);
  };

  const handleUpdatePassword = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      await authApi.resetPassword(email, newPassword, confirmPassword);
      showToast('Password updated successfully.');
      dialog.show({
        title: 'Success',
        description: 'Your password has been updated. You can now log in with your new password.',
        buttons: [
          {
            text: 'Go to Login',
            onPress: () => {
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            },
          },
        ],
      });
    } catch (error) {
      dialog.show({
        title: 'Update Failed',
        description: getErrorMessage(error),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="Set New Password"
        subtitle="Enter your new password below"
        showBack
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Update Password</Text>
        <Text style={styles.subtitle}>
          {email ? `For ${email}` : 'Enter and confirm your new password.'}
        </Text>
        <InputField
          label="New Password"
          value={newPassword}
          onChangeText={(text) => { setNewPassword(text); clearFieldError('newPassword'); }}
          onBlur={() => setMultiple({ ...errors, newPassword: validatePassword(newPassword) })}
          placeholder="Enter new password"
          secureTextEntry
          error={errors.newPassword}
        />
        <InputField
          label="Confirm Password"
          value={confirmPassword}
          onChangeText={(text) => { setConfirmPassword(text); clearFieldError('confirmPassword'); }}
          onBlur={() => setMultiple({ ...errors, confirmPassword: validateConfirmPassword(newPassword, confirmPassword) })}
          placeholder="Confirm new password"
          secureTextEntry
          error={errors.confirmPassword}
        />
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <GradientButton title="Update Password" onPress={handleUpdatePassword} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.xl },
  title: {
    fontSize: typography.h2,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  loader: { marginVertical: spacing.lg },
});
