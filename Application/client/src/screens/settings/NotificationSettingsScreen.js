import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppHeader, GradientButton, GlassCard, SectionHeader } from '../../components';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { safeGoBack } from '../../navigation/navigationRef';
import { profileApi } from '../../services/api';
import { getErrorMessage } from '../../utils/apiHelpers';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  NOTIFICATION_UI_LABELS,
  parseNotificationPreferences,
} from '../../constants/notifications';
import {
  requestNotificationPermission,
  setNotificationPreferences,
  syncNotificationPreferencesFromUser,
} from '../../services/notificationService';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

const SECTIONS = [
  {
    title: 'DEVICE',
    keys: ['deviceConnected', 'deviceDisconnected'],
  },
  {
    title: 'CALIBRATION',
    keys: ['calibrationComplete', 'calibrationRequired'],
  },
  {
    title: 'AI',
    keys: ['predictionResult'],
  },
];

function PreferenceRow({ label, value, onValueChange, disabled }) {
  return (
    <View style={styles.preferenceRow}>
      <Text style={styles.preferenceLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

export default function NotificationSettingsScreen({ navigation }) {
  const { token, updateUser } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [preferences, setPreferences] = useState({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });

  const loadNotificationSettings = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('Please log in to manage notification settings.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await profileApi.getNotifications(token);
      const nextEnabled = Boolean(data.notificationsEnabled ?? true);
      const nextPreferences = parseNotificationPreferences(data.preferences);

      setNotificationsEnabled(nextEnabled);
      setPreferences(nextPreferences);
      setNotificationPreferences({
        notificationsEnabled: nextEnabled,
        preferences: nextPreferences,
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load notification settings.'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      loadNotificationSettings();
    }, [loadNotificationSettings])
  );

  const handleMasterToggle = async (value) => {
    setNotificationsEnabled(value);

    if (value) {
      const status = await requestNotificationPermission();
      if (status !== 'granted') {
        showToast('Notification permission was not granted. In-app alerts will still appear when enabled.');
      }
    }
  };

  const handlePreferenceToggle = (key, value) => {
    setPreferences((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const handleSave = async () => {
    if (!token) {
      showToast('Please log in to save notification settings.');
      return;
    }

    setSaving(true);
    try {
      const data = await profileApi.updateNotificationSettings(
        {
          notificationsEnabled,
          preferences,
        },
        token
      );

      const nextEnabled = Boolean(data.notificationsEnabled ?? notificationsEnabled);
      const nextPreferences = parseNotificationPreferences(
        data.preferences ?? preferences
      );

      setNotificationsEnabled(nextEnabled);
      setPreferences(nextPreferences);
      setNotificationPreferences({
        notificationsEnabled: nextEnabled,
        preferences: nextPreferences,
      });

      await updateUser({
        notifications_enabled: nextEnabled,
        notification_preferences: nextPreferences,
      });
      syncNotificationPreferencesFromUser({
        notifications_enabled: nextEnabled,
        notification_preferences: nextPreferences,
      });

      showToast('Notification settings saved.');
      safeGoBack(navigation);
    } catch (err) {
      showToast(getErrorMessage(err, 'Could not save notification settings.'));
    } finally {
      setSaving(false);
    }
  };

  const categoryDisabled = !notificationsEnabled;

  return (
    <View style={styles.container}>
      <AppHeader
        title="Notification Settings"
        subtitle="Choose which events notify you"
        showBack
        onBackPress={() => safeGoBack(navigation)}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!loading ? (
          <>
            <GlassCard style={styles.card}>
              <View style={styles.masterRow}>
                <View style={styles.masterTextWrap}>
                  <Text style={styles.masterTitle}>Notifications</Text>
                  <Text style={styles.masterSubtitle}>Master switch</Text>
                </View>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={handleMasterToggle}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={colors.surface}
                />
              </View>
            </GlassCard>

            {SECTIONS.map((section) => (
              <View key={section.title}>
                <SectionHeader title={section.title} />
                <GlassCard style={styles.card}>
                  {section.keys.map((key) => (
                    <PreferenceRow
                      key={key}
                      label={NOTIFICATION_UI_LABELS[key]}
                      value={preferences[key]}
                      onValueChange={(value) => handlePreferenceToggle(key, value)}
                      disabled={categoryDisabled}
                    />
                  ))}
                </GlassCard>
              </View>
            ))}

            <GradientButton
              title={saving ? 'Saving...' : 'Save Changes'}
              onPress={handleSave}
              disabled={saving}
              style={styles.saveBtn}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  loader: { marginVertical: spacing.lg },
  errorText: {
    color: colors.warning,
    marginBottom: spacing.md,
    fontSize: typography.small,
  },
  card: { marginBottom: spacing.md },
  masterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  masterTextWrap: { flex: 1, marginRight: spacing.md },
  masterTitle: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.text,
  },
  masterSubtitle: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginTop: 2,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  preferenceLabel: {
    flex: 1,
    fontSize: typography.body,
    color: colors.text,
    marginRight: spacing.md,
  },
  saveBtn: { marginTop: spacing.sm },
});
