import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { GradientButton, InputField, AppHeader } from '../../components';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { useFieldErrors } from '../../hooks/useFieldErrors';
import { authApi } from '../../services/api';
import { getErrorMessage } from '../../utils/apiHelpers';
import { validateEmail, hasValidationErrors } from '../../utils/validation';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function ForgotPasswordScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { errors, setMultiple, clearFieldError } = useFieldErrors();
  const dialog = useDialog();
  const { showToast } = useToast();

  const validateForm = () => {
    const nextErrors = { email: validateEmail(email) };
    setMultiple(nextErrors);
    return !hasValidationErrors(nextErrors);
  };

  const handleSend = async () => {
    if (!validateForm()) return;

    const trimmedEmail = email.trim();
    setLoading(true);
    try {
      await authApi.forgotPassword(trimmedEmail);
      showToast('Reset PIN sent to your email.');
      navigation.navigate('OtpVerification', {
        email: trimmedEmail,
        flow: 'forgotPassword',
      });
    } catch (error) {
      dialog.show({
        title: 'Request Failed',
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
        title="Forgot Password"
        subtitle="We'll email you a 6-digit PIN"
        showBack
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>Enter your email to receive a 6-digit PIN.</Text>
        <InputField
          label="Email"
          value={email}
          onChangeText={(text) => { setEmail(text); clearFieldError('email'); }}
          onBlur={() => setMultiple({ email: validateEmail(email) })}
          placeholder="Enter your email"
          keyboardType="email-address"
          autoCapitalize="none"
          error={errors.email}
        />
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <GradientButton title="Send PIN" onPress={handleSend} />
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
