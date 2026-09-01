import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LineChart } from 'react-native-chart-kit';
import { AppHeader, GlassCard, EmgModeBanner } from '../../components';
import { useSession } from '../../context/SessionContext';
import { useAppState } from '../../context/AppStateContext';
import { useDialog } from '../../context/DialogContext';
import {
  AI_WINDOW_SAMPLES,
  AI_WINDOW_SECONDS,
  EMG_SAMPLING_RATE_HZ,
  RECOMMENDED_RECORDING_SEC,
} from '../../constants/emgConfig';
import { nearestWordForPot } from '../../utils/emgSignal';
import {
  startEmgStream,
  stopEmgStream,
  ensureLiveMonitor,
  stopLiveMonitor,
  getEmgStreamDiagnostics,
  assertHardwareOnly,
} from '../../services/emgStreamService';
import {
  addAiSample,
  canRunAiPrediction,
  closeAiBuffer,
  getAiProgress,
  getAiRejectedCount,
  openAiBuffer,
  resetAiBuffer,
  takeAiWindow,
} from '../../services/aiInferenceService';
import { emgLog } from '../../constants/bleConfig';
import { calibrationApi, inferenceApi } from '../../services/api';
import { profileWordsToPotMap } from '../../utils/calibrationCapture';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

const MAX_POINTS = 24;
const CHART_HEIGHT = 180;
const CHART_HORIZONTAL_INSET = 16;

const chartConfig = {
  backgroundColor: colors.surface,
  backgroundGradientFrom: colors.surface,
  backgroundGradientTo: colors.background,
  decimalPlaces: 0,
  color: (opacity = 1) => (opacity === 1 ? colors.primary : 'rgba(79, 70, 229, 0.2)'),
  labelColor: () => colors.text,
  strokeWidth: 2,
  propsForDots: { r: '0' },
};

export default function RecordSignalScreen({ navigation }) {
  const parentNav = navigation.getParent();
  const { ensureSession } = useSession();
  const { deviceConnected, calibrationDone } = useAppState();
  const { token } = useAuth();
  const { show: showDialog, hide: hideDialog } = useDialog();
  const showDialogRef = useRef(showDialog);
  const hideDialogRef = useRef(hideDialog);

  showDialogRef.current = showDialog;
  hideDialogRef.current = hideDialog;

  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);
  const [currentPot, setCurrentPot] = useState(null);
  const [streamMode, setStreamMode] = useState('idle');
  const [measuredHz, setMeasuredHz] = useState(null);
  const [chartValues, setChartValues] = useState(() => Array(MAX_POINTS).fill(60));
  const [wordProfiles, setWordProfiles] = useState({});
  const [aiSampleCount, setAiSampleCount] = useState(0);
  const [aiPhase, setAiPhase] = useState('idle');

  const collectedRef = useRef([]);
  const diagnosticsTimerRef = useRef(null);
  const recordingRef = useRef(false);
  const aiTriggeredRef = useRef(false);
  const hardwareStreamRef = useRef(false);
  const livePotHandlerRef = useRef((sample) => {
    setCurrentPot(sample[1]);
  });

  recordingRef.current = recording;

  const handleLivePotSample = useCallback((sample) => {
    setCurrentPot(sample[1]);
  }, []);

  livePotHandlerRef.current = handleLivePotSample;

  const resumeLiveMonitor = useCallback(async () => {
    if (!deviceConnected || recordingRef.current) {
      return;
    }
    const result = await ensureLiveMonitor(livePotHandlerRef.current);
    if (result.mode === 'hardware') {
      setStreamMode('hardware');
    }
  }, [deviceConnected]);

  useEffect(() => {
    ensureSession().catch(() => {});
  }, [ensureSession]);

  useEffect(() => {
    if (!token) return;
    Promise.all([calibrationApi.getProfile(token), inferenceApi.aiHealth(token)])
      .then(([profile, health]) => {
        const vocabulary = Array.isArray(health.labels)
          ? health.labels.map((label) => String(label).toLowerCase())
          : [];
        const personalized = profileWordsToPotMap(profile, vocabulary);
        if (Object.keys(personalized).length > 0) {
          setWordProfiles(personalized);
          return;
        }
        return calibrationApi.get(token).then((data) => {
          try {
            const parsed = JSON.parse(data.calibration?.calibrationData ?? '{}');
            if (parsed.wordProfiles) {
              setWordProfiles(parsed.wordProfiles);
            }
          } catch {
          }
        });
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);

  const goToDashboard = useCallback(() => {
    hideDialogRef.current();
    navigation.navigate('Dashboard');
  }, [navigation]);

  const showGateDialog = useCallback(() => {
    if (deviceConnected && calibrationDone) {
      return;
    }

    if (!deviceConnected) {
      showDialogRef.current({
        title: 'Device Required',
        description: 'Connect your EMG sensor before recording.',
        buttons: [
          {
            text: 'Connect',
            onPress: () => parentNav?.navigate('DeviceConnection'),
          },
          { text: 'Back', onPress: goToDashboard },
        ],
      });
      return;
    }

    if (!calibrationDone) {
      showDialogRef.current({
        title: 'Calibration Required',
        description: 'Complete per-word calibration before recording.',
        buttons: [
          {
            text: 'Calibrate',
            onPress: () => parentNav?.navigate('Calibration'),
          },
          { text: 'Back', onPress: goToDashboard },
        ],
      });
    }
  }, [calibrationDone, deviceConnected, goToDashboard, parentNav]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const timer = setTimeout(() => {
        if (!cancelled) {
          showGateDialog();
        }
      }, 300);

      if (deviceConnected) {
        resumeLiveMonitor().catch(() => {});
      }

      return () => {
        cancelled = true;
        clearTimeout(timer);
        hideDialogRef.current();
        if (!recordingRef.current) {
          stopLiveMonitor();
        }
        // Leaving the screen abandons any partial AI window.
        resetAiBuffer();
      };
    }, [deviceConnected, resumeLiveMonitor, showGateDialog])
  );

  useEffect(() => {
    if (!deviceConnected) {
      setCurrentPot(null);
      setStreamMode('idle');
      return;
    }
    resumeLiveMonitor().catch(() => {});
  }, [deviceConnected, resumeLiveMonitor]);

  const activeWord = useMemo(
    () => (currentPot == null ? null : nearestWordForPot(currentPot, wordProfiles)),
    [currentPot, wordProfiles]
  );

  const clearDiagnosticsTimer = useCallback(() => {
    if (diagnosticsTimerRef.current) {
      clearInterval(diagnosticsTimerRef.current);
      diagnosticsTimerRef.current = null;
    }
  }, []);

  /**
   * A BLE drop mid-recording must stop AI buffering immediately. Predicting
   * from a window that straddles a disconnect would mix stale data.
   */
  useEffect(() => {
    if (deviceConnected) return;
    if (!recordingRef.current) return;

    clearDiagnosticsTimer();
    stopEmgStream({ keepMonitor: false, clearLiveSample: true });
    closeAiBuffer();
    resetAiBuffer();
    aiTriggeredRef.current = false;
    hardwareStreamRef.current = false;

    setRecording(false);
    setStreamMode('idle');
    setCurrentPot(null);
    setAiSampleCount(0);
    setAiPhase('disconnected');
    emgLog('[AI] BLE disconnected — AI buffering stopped');

    showDialogRef.current({
      title: 'EMG Device Disconnected',
      description:
        'EMG device disconnected. Reconnect the device and record the word again.',
      buttons: [{ text: 'OK', onPress: () => hideDialogRef.current() }],
    });
  }, [clearDiagnosticsTimer, deviceConnected]);

  /**
   * Hand the completed window to the Processing screen.
   *
   * Guarded so exactly one prediction leaves per window: aiTriggeredRef plus
   * the buffer's own in-flight/consumed flags.
   */
  const maybeTriggerAiPrediction = useCallback(() => {
    if (aiTriggeredRef.current) return;

    // Hardware only. A simulated stream must never reach the model.
    if (!hardwareStreamRef.current) return;
    if (!canRunAiPrediction()) return;

    const rows = takeAiWindow();
    if (!rows) return;

    aiTriggeredRef.current = true;
    setAiPhase('ready');
    emgLog(`[AI] buffer ready: ${rows.length}/${AI_WINDOW_SAMPLES}`);
    emgLog('[AI] rejected samples:', getAiRejectedCount());

    // This phase is a single window, not continuous prediction, so the stream
    // stops once the window is complete.
    clearDiagnosticsTimer();
    stopEmgStream({ keepMonitor: true });
    setRecording(false);
    setStreamMode('hardware');
    resumeLiveMonitor().catch(() => {});

    navigation.navigate('Processing', {
      mode: 'ai-window',
      aiRows: rows,
      sampleCount: rows.length,
      signalLabel: activeWord,
      potValue: currentPot == null ? null : Math.round(currentPot),
      durationMs: Math.round(rows.length * (1000 / EMG_SAMPLING_RATE_HZ)),
    });
  }, [activeWord, clearDiagnosticsTimer, currentPot, navigation, resumeLiveMonitor]);

  // Always call the freshest trigger: onSample is created once per recording and
  // would otherwise capture a stale closure over activeWord/potValue.
  const triggerRef = useRef(maybeTriggerAiPrediction);
  triggerRef.current = maybeTriggerAiPrediction;

  const startRecording = useCallback(async () => {
    collectedRef.current = [];
    setSeconds(0);
    setSampleCount(0);
    setMeasuredHz(null);

    // A new recording never reuses samples from the previous word.
    resetAiBuffer();
    openAiBuffer();
    aiTriggeredRef.current = false;
    hardwareStreamRef.current = false;
    setAiSampleCount(0);
    setAiPhase('collecting');
    setRecording(true);

    try {
      const stream = await startEmgStream({
        potValue: currentPot,
        word: activeWord,
        baseline: 60,
        durationMs: RECOMMENDED_RECORDING_SEC * 1000,
        onSample: (sample, count) => {
          collectedRef.current.push(sample);
          setSampleCount(count);
          setCurrentPot(sample[1]);
          setChartValues((prev) => [...prev.slice(1), sample[0]]);

          // Fan-out from the single existing BLE subscription.
          const added = addAiSample(sample);
          if (added.accepted) {
            setAiSampleCount(added.count);
            if (
              added.count % 100 === 0 ||
              added.count === 128 ||
              added.count === 256 ||
              added.count === 384 ||
              added.count === 512 ||
              added.count === 640 ||
              added.count === AI_WINDOW_SAMPLES
            ) {
              emgLog(`[AI] buffer: ${added.count}/${AI_WINDOW_SAMPLES}`);
            }
          }

          triggerRef.current?.();
        },
      });
      setStreamMode(stream.mode);

      // Only a real hardware stream may feed the model.
      hardwareStreamRef.current = stream.mode === 'hardware';
      if (!hardwareStreamRef.current) {
        setAiPhase('unavailable');
        closeAiBuffer();
        emgLog('[AI] prediction disabled: stream mode is', stream.mode);
      }

      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        // Record which transport actually produced the samples in this session.
        emgLog('hardware-only assertion', assertHardwareOnly());

        if (diagnosticsTimerRef.current) {
          clearInterval(diagnosticsTimerRef.current);
        }
        diagnosticsTimerRef.current = setInterval(() => {
          const diagnostics = getEmgStreamDiagnostics();
          if (diagnostics.calculatedHz != null) {
            setMeasuredHz(diagnostics.calculatedHz);
            emgLog('rate', {
              mode: diagnostics.mode,
              simulationActive: diagnostics.simulationActive,
              notifications: diagnostics.notificationsReceived,
              bytes: diagnostics.bytesReceived,
              samplesReceived: diagnostics.samplesReceived,
              invalidLines: diagnostics.invalidLines,
              elapsedMs: diagnostics.elapsedMs,
              calculatedHz: diagnostics.calculatedHz,
            });
          }
        }, 2000);
      }
    } catch (error) {
      setRecording(false);
      setStreamMode('idle');
      setAiPhase('idle');
      resetAiBuffer();
      showDialog({
        title: 'EMG Stream Unavailable',
        description: error?.message || 'Could not start EMG stream. Real hardware is not streaming.',
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    }
  }, [activeWord, currentPot, showDialog]);

  const stopRecording = useCallback(() => {
    clearDiagnosticsTimer();

    if (aiTriggeredRef.current) {
      stopEmgStream({ keepMonitor: true });
      setRecording(false);
      setStreamMode('hardware');
      resumeLiveMonitor().catch(() => {});
      return;
    }

    const samples = stopEmgStream({ keepMonitor: true });
    const rawSignalData = samples.length ? samples : collectedRef.current;
    setRecording(false);
    setStreamMode(deviceConnected ? 'hardware' : 'idle');
    resumeLiveMonitor().catch(() => {});

    // Never send a short window to the model. 50/100/200/767 samples are
    // buffering states, not predictions.
    if (rawSignalData.length < AI_WINDOW_SAMPLES) {
      resetAiBuffer();
      setAiSampleCount(0);
      setAiPhase('idle');
      showDialog({
        title: 'Window Incomplete',
        description: `AI prediction needs ${AI_WINDOW_SAMPLES} samples (~${Math.round(AI_WINDOW_SECONDS)}s at ${EMG_SAMPLING_RATE_HZ} Hz). You captured ${rawSignalData.length}. This is not a prediction yet.`,
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    if (hardwareStreamRef.current && canRunAiPrediction()) {
      triggerRef.current?.();
      return;
    }

    resetAiBuffer();
    setAiSampleCount(0);
    setAiPhase('idle');
    showDialog({
      title: 'Prediction Not Sent',
      description:
        'A complete window was captured, but AI prediction is only sent from a live hardware stream. Record again with the EMG device connected.',
      buttons: [{ text: 'OK', onPress: () => {} }],
    });
  }, [clearDiagnosticsTimer, deviceConnected, resumeLiveMonitor, showDialog]);

  const toggleRecord = () => {
    if (recording) {
      stopRecording();
      return;
    }
    startRecording();
  };

  const pad = (n) => String(n).padStart(2, '0');
  const timeStr = `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
  const { width: windowWidth } = useWindowDimensions();
  const [chartAreaWidth, setChartAreaWidth] = useState(
    () => Math.max(160, windowWidth - spacing.lg * 2 - spacing.md * 2)
  );
  const chartWidth = Math.max(120, chartAreaWidth - CHART_HORIZONTAL_INSET);

  const modeLabel = deviceConnected ? 'Hardware' : 'Idle';
  const potDisplay = currentPot == null ? '—' : String(Math.round(currentPot));

  const chartData = useMemo(
    () => ({
      labels: chartValues.map(() => ''),
      datasets: [{ data: chartValues.length ? chartValues : [60] }],
    }),
    [chartValues]
  );

  const aiWindowReady = aiSampleCount >= AI_WINDOW_SAMPLES;

  const aiProgressRatio = Math.min(1, aiSampleCount / AI_WINDOW_SAMPLES);
  const aiStatusText = (() => {
    switch (aiPhase) {
      case 'collecting':
        return aiSampleCount >= AI_WINDOW_SAMPLES
          ? 'Signal window ready — processing…'
          : 'Collecting EMG signal';
      case 'ready':
        return 'Signal window ready — processing…';
      case 'unavailable':
        return 'AI prediction needs a live hardware stream';
      case 'disconnected':
        return 'EMG device disconnected';
      default:
        return `Record ~${Math.round(AI_WINDOW_SECONDS)}s to enable AI prediction`;
    }
  })();

  return (
    <View style={styles.container}>
      <AppHeader
        title="EMG Recording"
        subtitle="Capture word signal at 50 Hz (EMG + pot)"
        showBack
        onBackPress={() => {
          if (diagnosticsTimerRef.current) {
            clearInterval(diagnosticsTimerRef.current);
            diagnosticsTimerRef.current = null;
          }
          if (recording) {
            stopEmgStream({ keepMonitor: true });
          } else {
            stopLiveMonitor();
          }
          resetAiBuffer();
          setAiSampleCount(0);
          setAiPhase('idle');
          goToDashboard();
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <EmgModeBanner mode={streamMode} />

        <GlassCard style={styles.infoCard}>
          <View style={styles.infoGrid}>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>Mode</Text>
              <Text style={styles.infoValue} numberOfLines={1}>
                {modeLabel}
              </Text>
            </View>
            <View style={styles.infoCell}>
              <Text style={styles.infoLabel}>POT</Text>
              <Text style={styles.infoValue} numberOfLines={1}>
                {potDisplay}
              </Text>
            </View>
          </View>
        </GlassCard>

        <GlassCard style={styles.waveformCard}>
          <Text style={styles.waveformLabel}>Live EMG (ADC)</Text>
          <View
            style={styles.chartWrapper}
            onLayout={(event) => {
              const nextWidth = Math.floor(event.nativeEvent.layout.width);
              if (nextWidth > 0 && Math.abs(nextWidth - chartAreaWidth) > 1) {
                setChartAreaWidth(nextWidth);
              }
            }}
          >
            <LineChart
              data={chartData}
              width={chartWidth}
              height={CHART_HEIGHT}
              chartConfig={chartConfig}
              bezier
              withDots={false}
              fromZero
              withShadow={false}
              withInnerLines
              yAxisSuffix=""
              paddingRight={36}
              style={styles.chart}
            />
          </View>
          <Text style={styles.sampleText}>
            Samples: {sampleCount} / {AI_WINDOW_SAMPLES} for AI
            {measuredHz != null
              ? ` · measured ~${measuredHz} Hz`
              : ` · target ${EMG_SAMPLING_RATE_HZ} Hz`}
          </Text>
          <Text style={styles.hintText}>
            {recording
              ? aiWindowReady
                ? 'Signal window ready — sending to AI…'
                : `Keep the potentiometer steady. Prediction needs ${AI_WINDOW_SAMPLES} samples (~${Math.round(AI_WINDOW_SECONDS)}s).`
              : 'Rotate the potentiometer to your word position, then record while mouthing the word silently.'}
          </Text>
        </GlassCard>

        <GlassCard style={styles.aiCard}>
          <View style={styles.aiHeaderRow}>
            <Text style={styles.aiTitle}>AI prediction</Text>
            <Text
              style={[
                styles.aiCount,
                aiSampleCount >= AI_WINDOW_SAMPLES ? styles.aiCountReady : null,
              ]}
            >
              {aiSampleCount} / {AI_WINDOW_SAMPLES} samples
            </Text>
          </View>
          <View style={styles.aiTrack}>
            <View
              style={[
                styles.aiBar,
                { width: `${aiProgressRatio * 100}%` },
                aiSampleCount >= AI_WINDOW_SAMPLES ? styles.aiBarReady : null,
              ]}
            />
          </View>
          <Text
            style={[
              styles.aiStatus,
              aiPhase === 'disconnected' || aiPhase === 'unavailable'
                ? styles.aiStatusWarn
                : null,
            ]}
          >
            {aiStatusText}
          </Text>
          <Text style={styles.aiNote}>
            The model needs a full {AI_WINDOW_SAMPLES}-sample window
            (~{Math.round(AI_WINDOW_SECONDS)}s at {EMG_SAMPLING_RATE_HZ} Hz).
            Prediction starts automatically when the window is complete.
          </Text>
        </GlassCard>

        <View style={styles.controls}>
          <Text style={styles.timer}>{timeStr}</Text>
          <Text style={[styles.qualityText, aiWindowReady ? styles.qualityOk : null]}>
            {aiWindowReady
              ? 'Signal window ready'
              : recording
                ? `${aiSampleCount} / ${AI_WINDOW_SAMPLES} — prediction starts at ${AI_WINDOW_SAMPLES}`
                : `Need ${AI_WINDOW_SAMPLES} samples (~${Math.round(AI_WINDOW_SECONDS)}s)`}
          </Text>
          <TouchableOpacity
            style={[styles.recordBtn, recording && styles.recordBtnActive]}
            onPress={toggleRecord}
            activeOpacity={0.8}
          >
            <Text style={styles.recordBtnText}>
              {recording ? 'Stop Recording' : 'Record'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  infoCard: { marginBottom: spacing.md },
  infoGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  infoCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  infoLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: typography.small,
    fontWeight: typography.semiBold,
    color: colors.text,
    lineHeight: 18,
  },
  waveformCard: { marginBottom: spacing.md },
  waveformLabel: {
    fontSize: typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  chartWrapper: {
    width: '100%',
    height: CHART_HEIGHT,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chart: {
    marginLeft: 0,
    marginRight: 0,
    paddingRight: 0,
    borderRadius: 12,
  },
  sampleText: {
    fontSize: typography.small,
    color: colors.text,
    marginTop: spacing.sm,
    fontWeight: typography.semiBold,
    lineHeight: 18,
  },
  hintText: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  aiCard: { marginBottom: spacing.md },
  aiHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.xs,
  },
  aiTitle: {
    flexShrink: 1,
    fontSize: typography.small,
    fontWeight: typography.semiBold,
    color: colors.text,
    lineHeight: 18,
  },
  aiCount: {
    flexShrink: 0,
    fontSize: typography.small,
    color: colors.textSecondary,
    fontWeight: typography.semiBold,
    lineHeight: 18,
  },
  aiCountReady: { color: colors.success },
  aiTrack: {
    height: 8,
    width: '100%',
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  aiBar: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  aiBarReady: { backgroundColor: colors.success },
  aiStatus: {
    marginTop: spacing.sm,
    fontSize: typography.small,
    color: colors.text,
    lineHeight: 18,
  },
  aiStatusWarn: { color: colors.warning },
  aiNote: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  controls: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  timer: {
    fontSize: 36,
    fontWeight: typography.bold,
    color: colors.text,
    textAlign: 'center',
    lineHeight: 44,
    marginBottom: spacing.sm,
  },
  qualityText: {
    textAlign: 'center',
    color: colors.warning,
    marginBottom: spacing.lg,
    fontSize: typography.small,
    lineHeight: 18,
    paddingHorizontal: spacing.md,
  },
  qualityOk: { color: colors.success },
  recordBtn: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
  recordBtnActive: { backgroundColor: colors.error },
  recordBtnText: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: typography.semiBold,
  },
});
