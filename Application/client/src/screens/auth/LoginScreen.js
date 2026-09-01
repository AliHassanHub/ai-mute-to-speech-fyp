import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { GradientButton, InputField, AppHeader } from '../../components';
import { useDialog } from '../../context/DialogContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useFieldErrors } from '../../hooks/useFieldErrors';
import { getErrorMessage } from '../../utils/apiHelpers';
import { validateEmail, validateLoginPassword, hasValidationErrors } from '../../utils/validation';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { errors, setMultiple, clearFieldError } = useFieldErrors();
  const dialog = useDialog();
  const { showToast } = useToast();
  const { login } = useAuth();

  const validateForm = () => {
    const nextErrors = {
      email: validateEmail(email),
      password: validateLoginPassword(password),
    };
    setMultiple(nextErrors);
    return !hasValidationErrors(nextErrors);
  };

  const handleLogin = async () => {
    if (!validateForm()) return;

    const trimmedEmail = email.trim();
    setLoading(true);
    try {
      await login(trimmedEmail, password);
      showToast('Welcome back! Login successful.');
    } catch (error) {
      dialog.show({
        title: 'Login Failed',
        description: getErrorMessage(error, 'Invalid email or password. Please try again.'),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader title="Login" subtitle="Sign in to continue" showBack onBackPress={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
          onBlur={() => setMultiple({ ...errors, password: validateLoginPassword(password) })}
          placeholder="Enter your password"
          secureTextEntry
          error={errors.password}
        />
        <TouchableOpacity style={styles.forgot} onPress={() => navigation.navigate('ForgotPassword')}>
          <Text style={styles.forgotText}>Forgot Password?</Text>
        </TouchableOpacity>
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <GradientButton title="Login" onPress={handleLogin} />
        )}
        <View style={styles.signupRow}>
          <Text style={styles.signupText}>Don't have an account? </Text>
          <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
            <Text style={styles.signupLink}>Sign Up</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.xl },
  forgot: { alignSelf: 'flex-end', marginBottom: spacing.lg },
  forgotText: { fontSize: typography.caption, color: colors.primary, fontWeight: typography.medium },
  signupRow: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.lg },
  signupText: { fontSize: typography.body, color: colors.textSecondary },
  signupLink: { fontSize: typography.body, color: colors.primary, fontWeight: typography.semiBold },
  loader: { marginVertical: spacing.lg },
});
