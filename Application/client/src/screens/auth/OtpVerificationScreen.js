import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { AppHeader, GlassCard, GradientButton, OTPInput, CustomModal } from '../../components';
import { useToast } from '../../context/ToastContext';
import { useDialog } from '../../context/DialogContext';
import { useAuth } from '../../context/AuthContext';
import { authApi } from '../../services/api';
import { getErrorMessage } from '../../utils/apiHelpers';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export default function OtpVerificationScreen({ navigation, route }) {
  const email = route.params?.email ?? '';
  const password = route.params?.password;
  const flow = route.params?.flow ?? 'signup';
  const isForgotPassword = flow === 'forgotPassword';
  const { showToast } = useToast();
  const dialog = useDialog();
  const { completeSignup } = useAuth();

  const [code, setCode] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const [successModal, setSuccessModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const isComplete = code.length === OTP_LENGTH;
  const canResend = secondsLeft === 0;

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const resetTimer = useCallback(() => {
    setSecondsLeft(RESEND_SECONDS);
  }, []);

  const handleResend = async () => {
    if (!canResend || !email || resending) return;
    setResending(true);
    try {
      if (isForgotPassword) {
        await authApi.forgotPassword(email);
        showToast('Reset PIN sent successfully.');
      } else {
        dialog.show({
          title: 'Resend Not Available',
          description: 'Please go back and submit the signup form again to receive a new code.',
          buttons: [{ text: 'OK', onPress: () => {} }],
        });
        return;
      }
      setCode('');
      resetTimer();
    } catch (error) {
      dialog.show({
        title: 'Resend Failed',
        description: getErrorMessage(error),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setResending(false);
    }
  };

  const handleVerify = async () => {
    if (!isComplete || loading) return;
    setLoading(true);
    try {
      if (isForgotPassword) {
        await authApi.verifyResetOtp(email, code);
        setSuccessModal(true);
      } else {
        await completeSignup(email, code, password);
        setSuccessModal(true);
      }
    } catch (error) {
      dialog.show({
        title: 'Verification Failed',
        description: getErrorMessage(error, 'Invalid or expired code. Please try again.'),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSuccessContinue = () => {
    setSuccessModal(false);
    if (isForgotPassword) {
      navigation.navigate('SetNewPassword', { email });
    } else {
      showToast('Account created successfully!');
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title={isForgotPassword ? 'Verify Reset PIN' : 'Verify Your Email'}
        subtitle={
          isForgotPassword
            ? 'Enter the 6-digit PIN sent to your email address.'
            : 'Enter the 6-digit verification code sent to your email address.'
        }
        showBack
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <GlassCard style={styles.emailCard}>
          <Text style={styles.emailLabel}>{isForgotPassword ? 'PIN sent to:' : 'Code sent to:'}</Text>
          <Text style={styles.emailValue}>{email || 'your email'}</Text>
        </GlassCard>

        <View style={styles.otpSection}>
          <OTPInput value={code} onChange={setCode} length={OTP_LENGTH} />
        </View>

        <View style={styles.timerRow}>
          {secondsLeft > 0 ? (
            <Text style={styles.timerText}>
              {isForgotPassword ? 'Resend PIN in' : 'Resend code in'} {secondsLeft}s
            </Text>
          ) : (
            <TouchableOpacity onPress={handleResend} activeOpacity={0.7} disabled={resending}>
              <Text style={styles.resendLink}>
                {resending ? 'Sending...' : isForgotPassword ? 'Resend PIN' : 'Resend Code'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.verifyWrap}>
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <GradientButton
              title={isForgotPassword ? 'Verify PIN' : 'Verify OTP'}
              onPress={handleVerify}
              disabled={!isComplete}
            />
          )}
        </View>
      </ScrollView>

      <CustomModal
        visible={successModal}
        variant="success"
        title={isForgotPassword ? 'PIN Verified' : 'Verification Successful'}
        message={
          isForgotPassword
            ? 'Your identity has been verified. You can now set a new password.'
            : 'Your email has been verified and your account is ready.'
        }
        buttonText="Continue"
        onClose={() => setSuccessModal(false)}
        onConfirm={handleSuccessContinue}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, paddingTop: spacing.md },
  emailCard: {
    marginBottom: spacing.xl,
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  emailLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  emailValue: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.text,
  },
  otpSection: {
    marginBottom: spacing.lg,
  },
  timerRow: {
    alignItems: 'center',
    minHeight: 28,
    marginBottom: spacing.xl,
  },
  timerText: {
    fontSize: typography.body,
    color: colors.textSecondary,
  },
  resendLink: {
    fontSize: typography.body,
    color: colors.primary,
    fontWeight: typography.semiBold,
  },
  verifyWrap: {
    marginTop: spacing.sm,
    alignItems: 'center',
  },
});
