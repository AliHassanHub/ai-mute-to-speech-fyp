import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import * as ImagePicker from 'expo-image-picker';
import {
  AppHeader,
  InputField,
  GradientButton,
  GlassCard,
  PhotoPreviewModal,
} from '../../components';
import { profileApi } from '../../services/api';
import { resolveUploadUrl } from '../../services/api';
import { getErrorMessage } from '../../utils/apiHelpers';
import { useFieldErrors } from '../../hooks/useFieldErrors';
import {
  validateName,
  validatePassword,
  validateConfirmPassword,
  validateCurrentPassword,
  hasValidationErrors,
} from '../../utils/validation';
import { resetToLogin } from '../../navigation/navigationRef';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.85,
};

export default function EditProfileScreen({ navigation, route }) {
  const initialName = route.params?.userName ?? '';
  const initialEmail = route.params?.email ?? '';
  const initialImageUri = route.params?.profileImageUri ?? null;

  const [fullName, setFullName] = useState(initialName);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileImageUri, setProfileImageUri] = useState(initialImageUri);
  const [previewUri, setPreviewUri] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastPickerSource = useRef('gallery');

  const { errors, setMultiple, clearFieldError } = useFieldErrors();
  const dialog = useDialog();
  const { showToast } = useToast();
  const { token, updateUser, logout } = useAuth();

  const openPicker = async (source) => {
    const isCamera = source === 'camera';
    lastPickerSource.current = source;

    const permission = isCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permission.status !== 'granted') {
      dialog.show({
        title: 'Permission Needed',
        description: isCamera
          ? 'Please allow camera access to take a profile photo.'
          : 'Please allow access to your photo library to upload a profile photo.',
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    const result = isCamera
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);

    if (!result.canceled && result.assets?.[0]?.uri) {
      setPreviewUri(result.assets[0].uri);
      setShowPreview(true);
      setPhotoUploaded(false);
    }
  };

  const handleUploadPhoto = () => {
    if (Platform.OS === 'web') {
      openPicker('gallery');
      return;
    }

    Alert.alert('Profile Photo', 'Choose how you want to add your photo.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Take Photo', onPress: () => openPicker('camera') },
      { text: 'Choose from Gallery', onPress: () => openPicker('gallery') },
    ]);
  };

  const handleUsePhoto = async () => {
    if (!previewUri || uploadingPhoto) return;

    setUploadingPhoto(true);
    try {
      const imageData = await profileApi.uploadImage(previewUri, token);
      const updatedUser = imageData.user ?? imageData;
      await updateUser(updatedUser);

      const serverUrl = resolveUploadUrl(updatedUser.profile_image_url);
      setProfileImageUri(serverUrl ?? previewUri);
      setPhotoUploaded(true);
      setShowPreview(false);
      setPreviewUri(null);
      showToast('Profile photo uploaded successfully.');
    } catch (error) {
      dialog.show({
        title: 'Upload Failed',
        description: getErrorMessage(error),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleChooseAgain = () => {
    setShowPreview(false);
    setPreviewUri(null);
    setTimeout(() => openPicker(lastPickerSource.current), 300);
  };

  const handleCancelPreview = () => {
    if (uploadingPhoto) return;
    setShowPreview(false);
    setPreviewUri(null);
  };

  const validateForm = () => {
    const nextErrors = { fullName: validateName(fullName) };
    const isChangingPassword = Boolean(newPassword || confirmPassword || currentPassword);

    if (isChangingPassword) {
      nextErrors.currentPassword = validateCurrentPassword(currentPassword);
      nextErrors.newPassword = validatePassword(newPassword);
      nextErrors.confirmPassword = validateConfirmPassword(newPassword, confirmPassword);
    }

    setMultiple(nextErrors);
    return !hasValidationErrors(nextErrors);
  };

  const handleSave = async () => {
    if (loading || !validateForm()) return;

    const trimmedName = fullName.trim();
    setLoading(true);
    try {
      const profileData = await profileApi.update(trimmedName, token);
      let updatedUser = profileData.user ?? profileData;

      if (newPassword) {
        const pwdData = await profileApi.changePassword(
          currentPassword,
          newPassword,
          confirmPassword,
          token
        );
        if (pwdData.requireLogin) {
          await logout();
          showToast('Password changed. Please log in again.');
          resetToLogin();
          return;
        }
      }

      await updateUser(updatedUser);
      showToast('Profile updated successfully.');
      navigation.goBack();
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

  const displayImage = profileImageUri?.startsWith('http') ? profileImageUri : profileImageUri;

  return (
    <View style={styles.container}>
      <AppHeader
        title="Edit Profile"
        showBack
        onBackPress={() => navigation.goBack()}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.avatarSection}>
          <TouchableOpacity
            style={styles.avatarTouchable}
            onPress={handleUploadPhoto}
            activeOpacity={0.8}
            disabled={uploadingPhoto}
          >
            <View style={styles.avatar}>
              {displayImage ? (
                <Image source={{ uri: displayImage }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>{fullName.trim().charAt(0) || '?'}</Text>
              )}
              {uploadingPhoto ? (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color={colors.surface} />
                </View>
              ) : null}
            </View>
            <View style={styles.cameraBadge}>
              <Text style={styles.cameraBadgeText}>+</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.uploadPhotoBtn}
            onPress={handleUploadPhoto}
            activeOpacity={0.8}
            disabled={uploadingPhoto}
          >
            <Text style={styles.uploadPhotoText}>
              {uploadingPhoto ? 'Uploading photo...' : 'Change profile photo'}
            </Text>
          </TouchableOpacity>
          {photoUploaded ? (
            <Text style={styles.photoSavedHint}>Photo saved to your profile</Text>
          ) : null}
        </View>

        <InputField
          label="Full Name"
          value={fullName}
          onChangeText={(text) => { setFullName(text); clearFieldError('fullName'); }}
          onBlur={() => setMultiple({ ...errors, fullName: validateName(fullName) })}
          placeholder="Your name"
          error={errors.fullName}
        />
        <InputField
          label="Email"
          value={initialEmail}
          editable={false}
          placeholder="Email"
        />

        <Text style={styles.sectionTitle}>Change Password</Text>
        <GlassCard style={styles.passwordCard}>
          <InputField
            label="Current Password"
            value={currentPassword}
            onChangeText={(text) => { setCurrentPassword(text); clearFieldError('currentPassword'); }}
            onBlur={() => {
              if (currentPassword || newPassword || confirmPassword) {
                setMultiple({ ...errors, currentPassword: validateCurrentPassword(currentPassword) });
              }
            }}
            placeholder="Current password"
            secureTextEntry
            error={errors.currentPassword}
          />
          <InputField
            label="New Password"
            value={newPassword}
            onChangeText={(text) => { setNewPassword(text); clearFieldError('newPassword'); }}
            onBlur={() => {
              if (newPassword) {
                setMultiple({ ...errors, newPassword: validatePassword(newPassword) });
              }
            }}
            placeholder="New password"
            secureTextEntry
            error={errors.newPassword}
          />
          <InputField
            label="Confirm Password"
            value={confirmPassword}
            onChangeText={(text) => { setConfirmPassword(text); clearFieldError('confirmPassword'); }}
            onBlur={() => {
              if (confirmPassword) {
                setMultiple({ ...errors, confirmPassword: validateConfirmPassword(newPassword, confirmPassword) });
              }
            }}
            placeholder="Confirm password"
            secureTextEntry
            error={errors.confirmPassword}
          />
        </GlassCard>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
        ) : (
          <>
            <GradientButton
              title="Save Changes"
              onPress={handleSave}
              style={styles.gradientBtn}
            />
            <GradientButton
              title="Cancel"
              onPress={() => navigation.goBack()}
              style={styles.gradientBtn}
            />
          </>
        )}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      <PhotoPreviewModal
        visible={showPreview}
        imageUri={previewUri}
        uploading={uploadingPhoto}
        onUsePhoto={handleUsePhoto}
        onChooseAgain={handleChooseAgain}
        onCancel={handleCancelPreview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  avatarTouchable: {
    marginBottom: spacing.sm,
    position: 'relative',
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 36,
    fontWeight: typography.bold,
    color: colors.surface,
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadgeText: {
    color: colors.surface,
    fontSize: 18,
    fontWeight: typography.bold,
    lineHeight: 20,
  },
  uploadPhotoBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  uploadPhotoText: {
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
    color: colors.primary,
  },
  photoSavedHint: {
    fontSize: typography.small,
    color: colors.success,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  passwordCard: { marginBottom: spacing.lg },
  gradientBtn: {
    width: '100%',
    marginBottom: spacing.sm,
  },
  loader: { marginVertical: spacing.lg },
  bottomSpacer: { height: spacing.lg },
});
