import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { useFocusEffect } from '@react-navigation/native';
import { GlassCard, SettingsItem, SectionHeader } from '../../components';
import { resetToHome } from '../../navigation/navigationRef';
import {
  setNotificationPreferences,
  syncNotificationPreferencesFromUser,
} from '../../services/notificationService';
import { profileApi, calibrationApi, resolveUploadUrl } from '../../services/api';
import { getErrorMessage, getTranslationLanguageFromUser, getSpeechLanguageFromUser } from '../../utils/apiHelpers';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function ProfileScreen({ navigation }) {
  const dialog = useDialog();
  const { showToast } = useToast();
  const { token, user, logout, updateUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [calibrationProfile, setCalibrationProfile] = useState('Not calibrated');

  const translationLanguage = getTranslationLanguageFromUser(user);
  const speechLanguage = getSpeechLanguageFromUser(user);

  const userName = user?.name ?? 'User';
  const userEmail = user?.email ?? '';
  const profileImage = resolveUploadUrl(user?.profile_image_url);

  const loadProfile = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await profileApi.get(token);
      const profile = data.user ?? data;
      await updateUser(profile);
      setNotifications(profile.notifications_enabled ?? true);
      syncNotificationPreferencesFromUser(profile);

      const cal = await calibrationApi.status(token);
      setCalibrationProfile(cal.isCalibrated ? 'Default (Calibrated)' : 'Not calibrated');
    } catch (error) {
      dialog.show({
        title: 'Could Not Load Profile',
        description: getErrorMessage(error),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setLoading(false);
    }
  }, [token, updateUser, dialog]);

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [loadProfile])
  );

  const handleNotificationToggle = async (value) => {
    setNotifications(value);
    try {
      const data = await profileApi.updateNotifications(value, token);
      const nextPreferences = data.preferences ?? user?.notification_preferences;
      setNotificationPreferences({
        notificationsEnabled: value,
        preferences: nextPreferences,
      });
      await updateUser({
        notifications_enabled: value,
        ...(nextPreferences ? { notification_preferences: nextPreferences } : {}),
      });
      showToast(value ? 'Notifications enabled.' : 'Notifications disabled.');
    } catch (error) {
      setNotifications(!value);
      dialog.show({
        title: 'Update Failed',
        description: getErrorMessage(error),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    }
  };

  const handleLogout = () => {
    dialog.show({
      title: 'Logout',
      description: 'Are you sure you want to log out?',
      buttons: [
        { text: 'Cancel', style: 'cancel', onPress: () => {} },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            showToast('Logged out successfully.');
            resetToHome();
          },
        },
      ],
    });
  };

  const handleDeleteAccount = () => {
    dialog.show({
      title: 'Delete Account',
      description: 'This action cannot be undone. All your data will be permanently removed.',
      buttons: [
        { text: 'Cancel', style: 'cancel', onPress: () => {} },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await profileApi.deleteAccount(token);
              await logout();
              showToast('Account deleted successfully.');
              resetToHome();
            } catch (error) {
              dialog.show({
                title: 'Delete Failed',
                description: getErrorMessage(error),
                buttons: [{ text: 'OK', onPress: () => {} }],
              });
            }
          },
        },
      ],
    });
  };

  if (loading && !user) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.avatar}>
        {profileImage ? (
          <Image source={{ uri: profileImage }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarText}>
            {userName.trim().charAt(0) || '?'}
          </Text>
        )}
      </View>
      <Text style={styles.name}>{userName}</Text>
      <Text style={styles.email}>{userEmail}</Text>

      <GlassCard style={styles.card}>
        <Text style={styles.cardLabel}>Calibration profile</Text>
        <Text style={styles.cardValue}>{calibrationProfile}</Text>
      </GlassCard>

      <SectionHeader title="Account & Preferences" />
      <SettingsItem
        title="Edit Profile"
        icon="person-outline"
        iconColor={colors.primary}
        onPress={() =>
          navigation.navigate('EditProfile', {
            userName,
            email: userEmail,
            profileImageUri: profileImage,
          })
        }
      />
      <SettingsItem
        title="Language"
        icon="language-outline"
        iconColor={colors.primary}
        rightElement={
          <View style={styles.languageSummary}>
            <Text style={styles.valueText}>Translation: {translationLanguage}</Text>
            <Text style={styles.valueSubText}>Speech: {speechLanguage}</Text>
          </View>
        }
        onPress={() => navigation.navigate('LanguageSettings')}
      />
      <SettingsItem
        title="Notifications"
        icon="notifications-outline"
        iconColor={colors.primary}
        rightElement={
          <Switch
            value={notifications}
            onValueChange={handleNotificationToggle}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={colors.surface}
          />
        }
        onPress={() => navigation.navigate('NotificationSettings')}
      />

      <SectionHeader title="Account" />
      <SettingsItem
        title="Logout"
        icon="log-out-outline"
        iconColor={colors.error}
        onPress={handleLogout}
      />
      <SettingsItem
        title="Delete Account"
        icon="trash-outline"
        iconColor={colors.error}
        onPress={handleDeleteAccount}
      />

      <SectionHeader title="About" />
      <SettingsItem
        title="About App"
        icon="information-circle-outline"
        iconColor={colors.primary}
        rightElement={
          <Text style={styles.valueText}>AI Mute-to-Speech v1.0</Text>
        }
      />

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: typography.bold,
    color: colors.surface,
  },
  name: {
    fontSize: typography.h2,
    fontWeight: typography.bold,
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  email: {
    fontSize: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  card: { marginBottom: spacing.lg },
  cardLabel: { fontSize: typography.caption, color: colors.textSecondary },
  cardValue: {
    fontSize: typography.body,
    color: colors.text,
    marginTop: spacing.xs,
  },
  itemWrapper: { marginBottom: spacing.sm },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: { marginRight: spacing.md },
  rowLabel: {
    flex: 1,
    fontSize: typography.body,
    color: colors.text,
    fontWeight: typography.medium,
  },
  valueText: {
    fontSize: typography.body,
    color: colors.textSecondary,
  },
  languageSummary: {
    alignItems: 'flex-end',
  },
  valueSubText: {
    fontSize: typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  bottomSpacer: { height: spacing.lg },
});
