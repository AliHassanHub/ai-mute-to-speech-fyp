import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { GradientButton, InputField, AppHeader } from '../../components';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { useFieldErrors } from '../../hooks/useFieldErrors';
import { authApi } from '../../services/api';
import { getErrorMessage } from '../../utils/apiHelpers';
import {
  validateName,
  validateEmail,
  validatePassword,
  validateConfirmPassword,
  hasValidationErrors,
} from '../../utils/validation';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function SignupScreen({ navigation }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { errors, setMultiple, clearFieldError } = useFieldErrors();
  const dialog = useDialog();
  const { showToast } = useToast();

  const validateForm = () => {
    const nextErrors = {
      name: validateName(name),
      email: validateEmail(email),
      password: validatePassword(password),
      confirmPassword: validateConfirmPassword(password, confirmPassword),
    };
    setMultiple(nextErrors);
    return !hasValidationErrors(nextErrors);
  };

  const handleSignup = async () => {
    if (!validateForm()) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    setLoading(true);
    try {
      const data = await authApi.signup(trimmedName, trimmedEmail, password, confirmPassword);
      // Use the email the backend stored (after normalizeEmail), not the raw form value.
      const verifiedEmail = data.email || trimmedEmail;
      showToast('Verification code sent to your email.');
      navigation.navigate('OtpVerification', {
        email: verifiedEmail,
        password,
        flow: 'signup',
      });
    } catch (error) {
      dialog.show({
        title: 'Signup Failed',
        description: getErrorMessage(error),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader title="Create Account" subtitle="Set up your mute-to-speech profile" showBack onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <InputField
          label="Name"
          value={name}
          onChangeText={(text) => { setName(text); clearFieldError('name'); }}
          onBlur={() => setMultiple({ ...errors, name: validateName(name) })}
          placeholder="Enter your name"
          autoCapitalize="words"
          error={errors.name}
        />
        <InputField
          label="Email"
          value={email}
          onChangeText={(text) => { setEmail(text); clearFieldError('email'); }}
          onBlur={() => setMultiple({ ...errors, email: validateEmail(email) })}
          placeholder="Enter your email"
          keyboardType="email-address"
          autoCapitalize="none"
          error={errors.email}
        />
        <InputField
          label="Password"
          value={password}
          onChangeText={(text) => { setPassword(text); clearFieldError('password'); }}
          onBlur={() => setMultiple({ ...errors, password: validatePassword(password) })}
          placeholder="Create a password"
          secureTextEntry
          error={errors.password}
        />
        <InputField
          label="Confirm Password"
          value={confirmPassword}
          onChangeText={(text) => { setConfirmPassword(text); clearFieldError('confirmPassword'); }}
          onBlur={() => setMultiple({ ...errors, confirmPassword: validateConfirmPassword(password, confirmPassword) })}
          placeholder="Confirm your password"
          secureTextEntry
          error={errors.confirmPassword}
        />
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <GradientButton title="Create Account" onPress={handleSignup} />
        )}
        <View style={styles.loginRow}>
          <Text style={styles.loginText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Login')}>
            <Text style={styles.loginLink}>Login</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.xl },
  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  loginText: { fontSize: typography.body, color: colors.textSecondary },
  loginLink: { fontSize: typography.body, color: colors.primary, fontWeight: typography.semiBold },
  loader: { marginVertical: spacing.lg },
});
