import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { AppHeader, GradientButton, GlassCard, EmgModeBanner } from '../../components';
import { useAppState } from '../../context/AppStateContext';
import { useDialog } from '../../context/DialogContext';
import { useCalibration } from '../../hooks/useCalibration';
import { getErrorMessage } from '../../utils/apiHelpers';
import {
  NEUTRAL_CALIBRATION_SEC,
  EMG_SAMPLING_RATE_HZ,
  MIN_CALIBRATION_SAMPLES,
} from '../../constants/emgConfig';
import { captureToPayload, validateCaptureQuality } from '../../utils/calibrationCapture';
import {
  ensureLiveMonitor,
  startEmgStream,
  stopEmgStream,
  getEmgStreamMode,
} from '../../services/emgStreamService';
import { safeGoBack } from '../../navigation/navigationRef';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function BaselineCalibrationScreen({ navigation }) {
  const { deviceConnected } = useAppState();
  const dialog = useDialog();
  const { saveNeutralBaseline } = useCalibration();

  const [currentPot, setCurrentPot] = useState(null);
  const [streamMode, setStreamMode] = useState('idle');
  const [phase, setPhase] = useState('ready');
  const [status, setStatus] = useState('Relax your muscles with a comfortable pot position.');
  const [progress, setProgress] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);

  const livePotHandlerRef = useRef((sample) => setCurrentPot(sample[1]));
  const captureTimerRef = useRef(null);

  const handleLivePot = useCallback((sample) => {
    setCurrentPot(sample[1]);
  }, []);

  livePotHandlerRef.current = handleLivePot;

  useEffect(() => {
    if (!deviceConnected) return undefined;
    let active = true;
    ensureLiveMonitor(livePotHandlerRef.current).then((result) => {
      if (active && result.mode === 'hardware') {
        setStreamMode('hardware');
      }
    });
    return () => {
      active = false;
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
      stopEmgStream({ keepMonitor: true });
    };
  }, [deviceConnected]);

  const runNeutralCapture = async () => {
    if (!deviceConnected) {
      dialog.show({
        title: 'Device Required',
        description: 'Connect your EMG sensor before baseline calibration.',
        buttons: [
          { text: 'Connect', onPress: () => navigation.navigate('DeviceConnection') },
          { text: 'Cancel', onPress: () => {} },
        ],
      });
      return;
    }

    setPhase('capturing');
    setIsCapturing(true);
    setProgress(0);
    setStatus('Relax — capturing neutral baseline...');

    const samples = [];
    const totalFrames = NEUTRAL_CALIBRATION_SEC * EMG_SAMPLING_RATE_HZ;
    const startedAtMs = Date.now();

    try {
      const stream = await startEmgStream({
        potValue: currentPot ?? 0,
        word: null,
        baseline: 60,
        totalFrames,
        onSample: (sample) => {
          samples.push(sample);
          setProgress(Math.min(1, samples.length / totalFrames));
        },
      });
      setStreamMode(stream.mode);
    } catch (error) {
      setIsCapturing(false);
      setPhase('ready');
      setStatus('Could not start EMG stream.');
      dialog.show({
        title: 'EMG Stream Unavailable',
        description: error?.message || 'Hardware stream failed.',
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    captureTimerRef.current = setTimeout(async () => {
      stopEmgStream({ keepMonitor: true });
      setIsCapturing(false);

      if (getEmgStreamMode() === 'error') {
        setPhase('ready');
        setStatus('BLE disconnected during capture.');
        return;
      }

      const quality = validateCaptureQuality(samples);
      if (!quality.ok) {
        setPhase('ready');
        setStatus(`Poor signal — ${quality.reason}`);
        dialog.show({
          title: 'Poor Signal',
          description: `${quality.reason} Please try again.`,
          buttons: [{ text: 'OK', onPress: () => {} }],
        });
        return;
      }

      if (samples.length < MIN_CALIBRATION_SAMPLES) {
        setPhase('ready');
        setStatus('Not enough samples — repeat capture.');
        return;
      }

      setPhase('saving');
      setStatus('Saving neutral baseline...');

      try {
        await saveNeutralBaseline([captureToPayload(samples, startedAtMs)]);
        setPhase('done');
        setStatus('Baseline ready');
        dialog.show({
          title: 'Baseline Ready',
          description: 'Neutral baseline saved. You can now calibrate individual words.',
          buttons: [
            {
              text: 'Continue',
              onPress: () => navigation.replace('Calibration'),
            },
          ],
        });
      } catch (error) {
        setPhase('ready');
        setStatus('Save failed');
        dialog.show({
          title: 'Baseline Save Failed',
          description: getErrorMessage(error),
          buttons: [{ text: 'OK', onPress: () => {} }],
        });
      }
    }, NEUTRAL_CALIBRATION_SEC * 1000);
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title="Neutral Baseline"
        subtitle="Relax muscles before word calibration"
        showBack
        onBackPress={() => safeGoBack(navigation)}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <EmgModeBanner mode={streamMode} />
        <GlassCard>
          <Text style={styles.title}>Capture Relaxed Baseline</Text>
          <Text style={styles.description}>
            Sit comfortably, relax your jaw and facial muscles, and hold a steady potentiometer
            position for about {NEUTRAL_CALIBRATION_SEC} seconds.
          </Text>

          <View style={styles.potBox}>
            <Text style={styles.potLabel}>Current POT</Text>
            <Text style={styles.potValue}>
              {currentPot == null ? '—' : Math.round(currentPot)}
            </Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.status}>{status}</Text>

          {phase !== 'done' ? (
            <GradientButton
              title={isCapturing ? 'Capturing...' : 'Start Baseline Capture'}
              onPress={runNeutralCapture}
              disabled={isCapturing || phase === 'saving'}
            />
          ) : (
            <GradientButton
              title="Back to Calibration"
              onPress={() => navigation.replace('Calibration')}
            />
          )}
        </GlassCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  title: {
    fontSize: typography.h3,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  description: {
    fontSize: typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  potBox: {
    alignItems: 'center',
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  potLabel: { fontSize: typography.small, color: colors.textSecondary },
  potValue: {
    fontSize: typography.h1,
    fontWeight: typography.bold,
    color: colors.accent,
    marginTop: spacing.xs,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.accent,
  },
  status: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
});
