import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { AppHeader, GradientButton, GlassCard, EmgModeBanner } from '../../components';
import { useAppState } from '../../context/AppStateContext';
import { useDialog } from '../../context/DialogContext';
import { useCalibration } from '../../hooks/useCalibration';
import { getErrorMessage } from '../../utils/apiHelpers';
import {
  MIN_CALIBRATION_CAPTURES,
  PREFERRED_CALIBRATION_CAPTURES,
  MAX_CALIBRATION_CAPTURES,
  WORD_CALIBRATION_SEC,
  EMG_SAMPLING_RATE_HZ,
} from '../../constants/emgConfig';
import {
  captureToPayload,
  validateCaptureQuality,
  createIdempotencyKey,
} from '../../utils/calibrationCapture';
import {
  ensureLiveMonitor,
  startEmgStream,
  stopEmgStream,
  getEmgStreamMode,
} from '../../services/emgStreamService';
import { safeGoBack } from '../../navigation/navigationRef';
import { notifyCalibrationComplete } from '../../services/notificationService';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

const CAPTURE_SEC = WORD_CALIBRATION_SEC;

export default function WordCalibrationScreen({ navigation, route }) {
  const { word, previousPotCenter, suggestedPot, isRecalibrate } = route.params ?? {};
  const { deviceConnected } = useAppState();
  const dialog = useDialog();
  const { calibrateWord } = useCalibration();

  const [currentPot, setCurrentPot] = useState(null);
  const [streamMode, setStreamMode] = useState('idle');
  const [phase, setPhase] = useState('setup');
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [usableCaptures, setUsableCaptures] = useState([]);
  const [attemptCount, setAttemptCount] = useState(0);
  const [signalMessage, setSignalMessage] = useState('Adjust potentiometer');
  const [submitting, setSubmitting] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);

  const livePotHandlerRef = useRef((sample) => setCurrentPot(sample[1]));
  const captureTimerRef = useRef(null);
  const usableCapturesRef = useRef([]);
  const attemptCountRef = useRef(0);

  const displayWord = useMemo(
    () => String(word || '').replace(/^\w/, (c) => c.toUpperCase()),
    [word]
  );

  const handleLivePot = useCallback((sample) => {
    setCurrentPot(sample[1]);
  }, []);

  livePotHandlerRef.current = handleLivePot;

  useEffect(() => {
    usableCapturesRef.current = usableCaptures;
  }, [usableCaptures]);

  useEffect(() => {
    attemptCountRef.current = attemptCount;
  }, [attemptCount]);

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

  const progressLabel = useMemo(() => {
    const usable = usableCaptures.length;
    if (usable < MIN_CALIBRATION_CAPTURES) {
      return `Capture ${usable + 1} / ${MIN_CALIBRATION_CAPTURES}`;
    }
    if (usable < PREFERRED_CALIBRATION_CAPTURES) {
      return `${usable} / ${PREFERRED_CALIBRATION_CAPTURES} usable`;
    }
    return `${usable} usable captures`;
  }, [usableCaptures.length]);

  const runSingleCapture = () =>
    new Promise((resolve) => {
      const samples = [];
      const totalFrames = CAPTURE_SEC * EMG_SAMPLING_RATE_HZ;
      const startedAtMs = Date.now();

      startEmgStream({
        potValue: currentPot ?? 0,
        word,
        baseline: 60,
        totalFrames,
        onSample: (sample) => {
          samples.push(sample);
          setCaptureProgress(Math.min(1, samples.length / totalFrames));
        },
      })
        .then((stream) => {
          setStreamMode(stream.mode);
          captureTimerRef.current = setTimeout(() => {
            stopEmgStream({ keepMonitor: true });
            resolve({ samples, startedAtMs });
          }, CAPTURE_SEC * 1000);
        })
        .catch((error) => {
          resolve({ error });
        });
    });

  const captureLoop = async () => {
    if (!deviceConnected) {
      dialog.show({
        title: 'Device Required',
        description: 'Connect your EMG sensor before calibration.',
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    setPhase('capturing');
    setIsCapturing(true);
    setCaptureProgress(0);
    setSignalMessage('Recording...');

    const { samples, startedAtMs, error } = await runSingleCapture();
    setIsCapturing(false);

    if (error) {
      setPhase('setup');
      setSignalMessage('EMG stream unavailable');
      dialog.show({
        title: 'Capture Failed',
        description: error.message || 'Could not start EMG stream.',
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    if (getEmgStreamMode() === 'error') {
      setPhase('setup');
      setSignalMessage('BLE disconnected');
      dialog.show({
        title: 'BLE Disconnected',
        description: 'Reconnect your device and try again.',
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    const nextAttempt = attemptCountRef.current + 1;
    setAttemptCount(nextAttempt);

    const quality = validateCaptureQuality(samples);
    if (!quality.ok) {
      setPhase('setup');
      setSignalMessage(`Poor signal — ${quality.reason}`);
      if (nextAttempt >= MAX_CALIBRATION_CAPTURES) {
        dialog.show({
          title: 'Too Many Attempts',
          description: 'Maximum capture attempts reached without enough usable samples.',
          buttons: [{ text: 'OK', onPress: () => navigation.goBack() }],
        });
      }
      return;
    }

    const payload = captureToPayload(samples, startedAtMs);
    const nextUsable = [...usableCapturesRef.current, payload];
    setUsableCaptures(nextUsable);
    setPhase('setup');
    setSignalMessage('Good signal');
    setCaptureProgress(0);

    if (nextUsable.length >= PREFERRED_CALIBRATION_CAPTURES) {
      await submitCaptures(nextUsable);
      return;
    }

    if (nextUsable.length >= MIN_CALIBRATION_CAPTURES) {
      dialog.show({
        title: 'Minimum Reached',
        description: `You have ${nextUsable.length} usable captures. Add more for better quality or finish now.`,
        buttons: [
          { text: 'Add More', onPress: () => {} },
          { text: 'Finish', onPress: () => submitCaptures(nextUsable) },
        ],
      });
    }
  };

  const submitCaptures = async (captures = usableCapturesRef.current) => {
    if (captures.length < MIN_CALIBRATION_CAPTURES) {
      dialog.show({
        title: 'Insufficient Captures',
        description: `Need at least ${MIN_CALIBRATION_CAPTURES} usable captures.`,
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    setSubmitting(true);
    setPhase('saving');
    setSignalMessage('Saving calibration...');

    try {
      const result = await calibrateWord(
        word,
        captures.slice(0, MAX_CALIBRATION_CAPTURES),
        createIdempotencyKey(word)
      );
      notifyCalibrationComplete({
        word,
        calibrationId: result?.entryId ?? result?.calibrationId ?? result?.word,
      }).catch(() => {});
      navigation.replace('CalibrationResult', {
        wordResult: result,
        isRecalibrate,
      });
    } catch (error) {
      setPhase('setup');
      setSignalMessage('Save failed');
      dialog.show({
        title: 'Calibration Failed',
        description: getErrorMessage(error),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setSubmitting(false);
    }
  };

  const startCalibration = () => {
    if (phase === 'capturing' || submitting) return;
    if (!sessionStarted) {
      setSessionStarted(true);
      setSignalMessage('Perform a short capture for each attempt');
    }
    captureLoop();
  };

  return (
    <View style={styles.container}>
      <AppHeader
        title={isRecalibrate ? `Recalibrate ${displayWord}` : `Calibrate ${displayWord}`}
        subtitle="Hold a steady pot position for each capture"
        showBack
        onBackPress={() => {
          if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
          stopEmgStream({ keepMonitor: true });
          safeGoBack(navigation);
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <EmgModeBanner mode={streamMode} />
        <GlassCard>
          <Text style={styles.wordTitle}>Word: {displayWord}</Text>

          <View style={styles.potRow}>
            <Text style={styles.potLabel}>Current POT</Text>
            <Text style={styles.potLive}>
              {currentPot == null ? '—' : Math.round(currentPot)}
            </Text>
          </View>

          {previousPotCenter != null ? (
            <Text style={styles.hint}>Previous calibrated POT: {previousPotCenter}</Text>
          ) : suggestedPot != null ? (
            <Text style={styles.hint}>Suggested reference POT: {suggestedPot}</Text>
          ) : null}

          <Text style={styles.statusLabel}>Status</Text>
          <Text
            style={[
              styles.statusValue,
              signalMessage.startsWith('Good') ? styles.good : styles.neutral,
            ]}
          >
            {signalMessage}
          </Text>

          {phase === 'capturing' || phase === 'saving' ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressBar, { width: `${captureProgress * 100}%` }]} />
            </View>
          ) : null}

          <Text style={styles.progressText}>{progressLabel}</Text>
          <Text style={styles.attempts}>
            Attempts: {attemptCount} · Usable: {usableCaptures.length}
          </Text>

          {submitting ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : !sessionStarted ? (
            <GradientButton title="Start Calibration" onPress={startCalibration} />
          ) : (
            <>
              {usableCaptures.length < MIN_CALIBRATION_CAPTURES ? (
                <GradientButton
                  title={isCapturing ? 'Recording...' : 'Capture Sample'}
                  onPress={startCalibration}
                  disabled={isCapturing || phase === 'saving'}
                />
              ) : (
                <GradientButton
                  title={
                    usableCaptures.length < PREFERRED_CALIBRATION_CAPTURES
                      ? 'Capture Another'
                      : 'Finish Calibration'
                  }
                  onPress={
                    usableCaptures.length < PREFERRED_CALIBRATION_CAPTURES
                      ? startCalibration
                      : () => submitCaptures()
                  }
                  disabled={isCapturing || phase === 'saving'}
                />
              )}
              {usableCaptures.length >= MIN_CALIBRATION_CAPTURES ? (
                <GradientButton
                  title="Save Now"
                  onPress={() => submitCaptures()}
                  disabled={isCapturing || phase === 'saving'}
                  style={styles.secondaryBtn}
                />
              ) : null}
            </>
          )}
        </GlassCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  wordTitle: {
    fontSize: typography.h2,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  potRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  potLabel: { fontSize: typography.body, color: colors.textSecondary },
  potLive: {
    fontSize: typography.h2,
    fontWeight: typography.bold,
    color: colors.accent,
  },
  hint: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  statusLabel: {
    fontSize: typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  statusValue: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    marginBottom: spacing.md,
  },
  good: { color: colors.success },
  neutral: { color: colors.textSecondary },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressBar: { height: '100%', backgroundColor: colors.accent },
  progressText: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  attempts: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  loader: { marginVertical: spacing.md },
  secondaryBtn: { marginTop: spacing.sm },
});
