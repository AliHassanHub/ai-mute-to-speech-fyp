import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Pressable,
} from 'react-native';
import { useDialog } from '../context/DialogContext';
import { colors } from '../theme/colors';
import spacing from '../theme/spacing';
import typography from '../theme/typography';

const BORDER_RADIUS = 20;
const PADDING = spacing.lg;

export default function AppDialog() {
  const { visible, title, description, buttons, hide } = useDialog();
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          friction: 8,
          tension: 100,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scale.setValue(0.9);
      opacity.setValue(0);
    }
  }, [visible, scale, opacity]);

  const handlePress = (btn) => {
    hide();
    if (btn.onPress) btn.onPress();
  };

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={hide}
      statusBarTranslucent
    >
      <Pressable style={styles.overlay} onPress={hide}>
        <Animated.View style={[styles.overlayBg, { opacity }]} />
        <Animated.View
          style={[styles.card, { transform: [{ scale }] }]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.content}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {description ? (
              <Text style={styles.description}>{description}</Text>
            ) : null}
          </View>
          <View style={styles.actions}>
            {(Array.isArray(buttons) ? buttons : []).map((btn, i) => {
              const isDestructive = btn.style === 'destructive';
              const isCancel = btn.style === 'cancel';
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.button,
                    isDestructive && styles.buttonDestructive,
                    isCancel && styles.buttonCancel,
                  ]}
                  onPress={() => handlePress(btn)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isDestructive && styles.buttonTextDestructive,
                      isCancel && styles.buttonTextCancel,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: BORDER_RADIUS,
    padding: PADDING,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  content: { marginBottom: spacing.lg },
  title: {
    fontSize: typography.h3,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCancel: {
    backgroundColor: colors.border,
  },
  buttonDestructive: {
    backgroundColor: colors.error,
  },
  buttonText: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.surface,
  },
  buttonTextCancel: {
    color: colors.text,
  },
  buttonTextDestructive: {
    color: colors.surface,
  },
});
