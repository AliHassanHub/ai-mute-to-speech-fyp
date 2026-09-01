import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

export default function PhotoPreviewModal({
  visible,
  imageUri,
  uploading = false,
  onUsePhoto,
  onChooseAgain,
  onCancel,
}) {
  if (!visible || !imageUri) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Preview Photo</Text>
          <Text style={styles.subtitle}>
            Make sure your face is clear and centered before uploading.
          </Text>

          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUri }} style={styles.previewImage} resizeMode="cover" />
            {uploading ? (
              <View style={styles.uploadingOverlay}>
                <ActivityIndicator size="large" color={colors.surface} />
                <Text style={styles.uploadingText}>Uploading...</Text>
              </View>
            ) : null}
          </View>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={onUsePhoto}
            disabled={uploading}
            style={[styles.primaryBtnWrap, uploading && styles.btnDisabled]}
          >
            <LinearGradient
              colors={[colors.primary, colors.secondary]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryBtn}
            >
              <Ionicons name="cloud-upload-outline" size={20} color={colors.surface} />
              <Text style={styles.primaryBtnText}>Use Photo & Upload</Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={onChooseAgain}
            disabled={uploading}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryBtnText}>Choose Another</Text>
          </TouchableOpacity>

          <Pressable onPress={onCancel} disabled={uploading} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    alignItems: 'center',
  },
  title: {
    fontSize: typography.h3,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  previewWrap: {
    width: 220,
    height: 220,
    borderRadius: 110,
    overflow: 'hidden',
    marginBottom: spacing.lg,
    borderWidth: 3,
    borderColor: colors.primary + '40',
    backgroundColor: colors.border,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  uploadingText: {
    color: colors.surface,
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
  },
  primaryBtnWrap: {
    width: '100%',
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  primaryBtn: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryBtnText: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: typography.semiBold,
  },
  secondaryBtn: {
    width: '100%',
    minHeight: 48,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  secondaryBtnText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: typography.semiBold,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: typography.body,
    fontWeight: typography.medium,
  },
  btnDisabled: {
    opacity: 0.7,
  },
});
