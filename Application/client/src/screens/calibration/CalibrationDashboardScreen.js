import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, GradientButton, GlassCard } from '../../components';
import { useAppState } from '../../context/AppStateContext';
import { useDialog } from '../../context/DialogContext';
import { useCalibration } from '../../hooks/useCalibration';
import { getErrorMessage } from '../../utils/apiHelpers';
import { DEFAULT_POT_BY_WORD } from '../../constants/emgConfig';
import { safeGoBack } from '../../navigation/navigationRef';
import { notifyCalibrationRequired } from '../../services/notificationService';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

function WordRow({ item, onPress }) {
  const isCalibrated = item.userPersonalized;
  const iconName = isCalibrated ? 'checkmark-circle' : 'ellipse-outline';
  const iconColor = isCalibrated ? colors.success : colors.textMuted;

  return (
    <TouchableOpacity style={styles.wordRow} onPress={() => onPress(item)}>
      <View style={styles.wordMain}>
        <Ionicons name={iconName} size={20} color={iconColor} />
        <Text style={styles.wordLabel}>{item.word}</Text>
      </View>
      <View style={styles.wordMeta}>
        <Text style={styles.wordState}>
          {isCalibrated ? 'Calibrated' : 'Not calibrated'}
        </Text>
        {isCalibrated ? (
          <Text style={styles.wordSub}>POT {item.potCenter?.toFixed?.(1) ?? item.potCenter}</Text>
        ) : (
          <Text style={styles.wordSub}>Global model supported</Text>
        )}
      </View>
      <Ionicons
        name={isCalibrated ? 'refresh' : 'chevron-forward'}
        size={18}
        color={colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

export default function CalibrationDashboardScreen({ navigation }) {
  const { deviceConnected, setCalibrationDone } = useAppState();
  const dialog = useDialog();
  const { loadCalibrationDashboard } = useCalibration();

  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  const refreshDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadCalibrationDashboard();
      setDashboard(data);
      setCalibrationDone(data.isCalibrated);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [loadCalibrationDashboard, setCalibrationDone]);

  useFocusEffect(
    useCallback(() => {
      refreshDashboard();
    }, [refreshDashboard])
  );

  const ensureDevice = () => {
    if (deviceConnected) return true;
    dialog.show({
      title: 'Device Required',
      description: 'Connect your EMG sensor before calibration.',
      buttons: [
        { text: 'Connect', onPress: () => navigation.navigate('DeviceConnection') },
        { text: 'Cancel', onPress: () => {} },
      ],
    });
    return false;
  };

  const openWordCalibration = (item) => {
    if (!ensureDevice()) return;
    if (!dashboard?.hasBaseline) {
      dialog.show({
        title: 'Baseline Required',
        description: 'Capture a neutral relaxed baseline before calibrating words.',
        buttons: [
          {
            text: 'Capture Baseline',
            onPress: () => navigation.navigate('BaselineCalibration'),
          },
          { text: 'Cancel', onPress: () => {} },
        ],
      });
      return;
    }

    navigateToWord(item);
  };

  const navigateToWord = (item) => {
    if (!item.userPersonalized) {
      notifyCalibrationRequired({ word: item.word }).catch(() => {});
    }

    navigation.navigate('WordCalibration', {
      word: item.word,
      previousPotCenter: item.potCenter,
      suggestedPot: item.potCenter ?? DEFAULT_POT_BY_WORD[item.word] ?? null,
      isRecalibrate: item.userPersonalized,
    });
  };

  const openWordPicker = () => {
    if (!ensureDevice()) return;
    if (!dashboard?.hasBaseline) {
      navigation.navigate('BaselineCalibration');
      return;
    }
    setPickerVisible(true);
  };

  const handlePickWord = (item) => {
    setPickerVisible(false);
    navigateToWord(item);
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="Personalized Calibration"
        subtitle="Calibrate one word at a time"
        showBack
        onBackPress={() => safeGoBack(navigation)}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {dashboard ? (
          <>
            <GlassCard style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Progress</Text>
              <Text style={styles.summaryCount}>
                {dashboard.calibratedCount} / {dashboard.totalWords} calibrated
              </Text>
              <Text style={styles.summaryHint}>
                {dashboard.hasBaseline ? 'Baseline ready' : 'Baseline required before word calibration'}
              </Text>
              {!dashboard.hasBaseline ? (
                <GradientButton
                  title="Capture Neutral Baseline"
                  onPress={() => navigation.navigate('BaselineCalibration')}
                  style={styles.inlineBtn}
                />
              ) : null}
            </GlassCard>

            <GlassCard style={styles.listCard}>
              <Text style={styles.sectionTitle}>Words</Text>
              {dashboard.words.map((item) => (
                <WordRow key={item.word} item={item} onPress={openWordCalibration} />
              ))}
            </GlassCard>

            <GlassCard style={styles.listCard}>
              <Text style={styles.sectionTitle}>Personalization</Text>
              <Text style={styles.metaLine}>
                Personalized: {dashboard.summary.personalized.join(', ') || 'None yet'}
              </Text>
              <Text style={styles.metaLine}>
                Global fallback: {dashboard.summary.globalFallback.join(', ') || 'None'}
              </Text>
            </GlassCard>

            <GradientButton title="Calibrate a Word" onPress={openWordPicker} />
          </>
        ) : null}
      </ScrollView>

      <Modal visible={pickerVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerVisible(false)}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.modalTitle}>Choose a word</Text>
            {dashboard?.words?.map((item) => (
              <TouchableOpacity
                key={item.word}
                style={styles.modalRow}
                onPress={() => handlePickWord(item)}
              >
                <Text style={styles.modalWord}>{item.word}</Text>
                <Text style={styles.modalState}>
                  {item.userPersonalized ? 'Recalibrate' : 'Calibrate'}
                </Text>
              </TouchableOpacity>
            ))}
            <GradientButton title="Cancel" onPress={() => setPickerVisible(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  loader: { marginVertical: spacing.lg },
  error: { color: colors.error, marginBottom: spacing.md },
  summaryCard: { marginBottom: spacing.md },
  summaryTitle: {
    fontSize: typography.h3,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  summaryCount: {
    fontSize: typography.h2,
    fontWeight: typography.bold,
    color: colors.accent,
    marginBottom: spacing.xs,
  },
  summaryHint: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  inlineBtn: { marginTop: spacing.sm },
  listCard: { marginBottom: spacing.md },
  sectionTitle: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  wordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  wordMain: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  wordLabel: {
    fontSize: typography.body,
    color: colors.text,
    textTransform: 'capitalize',
    fontWeight: typography.semiBold,
  },
  wordMeta: { flex: 1.2, marginRight: spacing.sm },
  wordState: { fontSize: typography.small, color: colors.textSecondary },
  wordSub: { fontSize: typography.caption, color: colors.textMuted },
  metaLine: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    fontSize: typography.h3,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.md,
    textTransform: 'capitalize',
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalWord: {
    fontSize: typography.body,
    color: colors.text,
    textTransform: 'capitalize',
    fontWeight: typography.semiBold,
  },
  modalState: { fontSize: typography.small, color: colors.textSecondary },
});
