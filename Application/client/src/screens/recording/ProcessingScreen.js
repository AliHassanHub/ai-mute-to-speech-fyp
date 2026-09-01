import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { useDialog } from '../../context/DialogContext';
import { useSession } from '../../context/SessionContext';
import { getErrorMessage } from '../../utils/apiHelpers';
import { describeInferenceError } from '../../utils/aiPrediction';
import { AI_WINDOW_SAMPLES, MIN_SAMPLES } from '../../constants/emgConfig';
import { safeGoBack } from '../../navigation/navigationRef';
import { emgLog } from '../../constants/bleConfig';
import { releaseAiWindow, resetAiBuffer, runOnceForWindow, windowIdentity } from '../../services/aiInferenceService';
import { notifyPredictionResult } from '../../services/notificationService';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function ProcessingScreen({ navigation, route }) {
  const progress = useRef(new Animated.Value(0)).current;
  const { saveRecording, processAndRecognize, predictWordFromWindow } = useSession();
  const dialog = useDialog();
  const [statusText, setStatusText] = useState('Validating EMG signal...');
  const hasStarted = useRef(false);

  const mode = route.params?.mode ?? 'recording';
  const rawSignalData = route.params?.rawSignalData ?? [];
  const aiRows = route.params?.aiRows ?? [];
  const durationMs = route.params?.durationMs ?? 1000;
  const sampleCount =
    route.params?.sampleCount ?? (mode === 'ai-window' ? aiRows.length : rawSignalData.length);
  const signalLabel = route.params?.signalLabel ?? null;

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 5000,
      useNativeDriver: false,
    });
    anim.start();

    (async () => {
      try {
        if (mode === 'ai-window') {
          // Direct window prediction. The buffer has already guaranteed a
          // complete window; this is a defence against a bad navigation param.
          if (!Array.isArray(aiRows) || aiRows.length < AI_WINDOW_SAMPLES) {
            throw new Error(
              `Signal window incomplete (${aiRows.length}/${AI_WINDOW_SAMPLES} samples).`
            );
          }

          setStatusText('Sending signal window to AI service...');
          emgLog('[AI] hardware samples:', aiRows.length);
          emgLog('[AI] prediction request sent');

          const result = await runOnceForWindow(aiRows, () =>
            predictWordFromWindow({ rows: aiRows })
          );

          if (result?.skipped) {
            // Another mount already owns this window (Strict Mode / remount).
            return;
          }

          if (result.buffering) {
            resetAiBuffer();
            emgLog(
              `[AI] buffering: ${result.receivedSamples}/${result.requiredSamples} — not an error`
            );
            dialog.show({
              title: 'Still Collecting',
              description: `Need ${result.requiredSamples} samples; received ${result.receivedSamples}. This is expected — keep recording until the window is full.`,
              buttons: [{ text: 'OK', onPress: () => safeGoBack(navigation) }],
            });
            return;
          }

          emgLog('[AI] prediction response received');
          emgLog('[AI] label:', result.prediction?.label);
          emgLog('[AI] accepted:', result.accepted);
          emgLog('[AI] confidence:', result.prediction?.confidence);

          if (result.accepted === true) {
            const predictedLabel =
              result.prediction?.label ?? result.recognizedText ?? result.label;
            notifyPredictionResult({
              label: predictedLabel,
              windowKey: windowIdentity(aiRows),
            }).catch(() => {});
          }

          // The window is finished either way; do not reuse these samples.
          resetAiBuffer();
          navigation.replace('Result', {
            result,
            signalRows: aiRows,
            durationMs,
          });
          return;
        }

        if (!Array.isArray(rawSignalData) || rawSignalData.length < MIN_SAMPLES) {
          throw new Error(
            `Signal too short (${rawSignalData.length} samples). Need at least ${MIN_SAMPLES}.`
          );
        }

        const isDualChannel = Array.isArray(rawSignalData[0]);
        if (!isDualChannel) {
          throw new Error('Recording must include EMG and potentiometer channels.');
        }

        setStatusText('Saving EMG recording to database...');
        const recording = await saveRecording({
          rawSignalData,
          durationMs,
          channelCount: 2,
          samplingRate: 50,
          signalLabel,
        });

        setStatusText('Running inference...');
        const result = await processAndRecognize({
          recordingId: recording.recordingId,
        });

        navigation.replace('Result', { result });
      } catch (error) {
        if (mode === 'ai-window') {
          // Allow the same window to be retried, then clear it so the next
          // recording starts clean.
          releaseAiWindow({ allowRetry: true });
          resetAiBuffer();
        }

        dialog.show({
          title: mode === 'ai-window' ? 'Prediction Failed' : 'Processing Failed',
          description:
            mode === 'ai-window' ? describeInferenceError(error) : getErrorMessage(error),
          buttons: [
            {
              text: 'Go Back',
              onPress: () => safeGoBack(navigation),
            },
          ],
        });
      }
    })();

    return () => anim.stop();
  }, [
    navigation,
    progress,
    saveRecording,
    processAndRecognize,
    predictWordFromWindow,
    mode,
    rawSignalData,
    aiRows,
    durationMs,
    signalLabel,
    dialog,
  ]);

  const widthInterpolate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.secondary} style={styles.spinner} />
      <Text style={styles.message}>AI Processing</Text>
      <Text style={styles.subMessage}>
        {sampleCount} samples · 50 Hz · EMG + POT
        {mode === 'ai-window' ? ' · calibrated word model' : ''}
      </Text>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressBar, { width: widthInterpolate }]} />
      </View>
      <Text style={styles.hint}>{statusText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  spinner: { marginBottom: spacing.lg },
  message: {
    fontSize: typography.h3,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  subMessage: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  progressTrack: {
    height: 8,
    width: '80%',
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  hint: { fontSize: typography.caption, color: colors.textSecondary, textAlign: 'center' },
});
