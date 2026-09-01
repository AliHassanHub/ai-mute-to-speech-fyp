import { EMG_SAMPLE_INTERVAL_MS, EMG_SAMPLING_RATE_HZ, ALLOW_EMG_SIMULATION } from '../constants/emgConfig';
import {
  NUS_NOTIFY_UUID,
  NUS_SERVICE_UUID,
  bleLog,
  emgLog,
} from '../constants/bleConfig';
import { generateSimulatedSample, parseEmgLine } from '../utils/emgSignal';
import { getConnectedBleDevice } from './bleService';

let streamTimer = null;
let sampleBuffer = [];
let onSampleCallback = null;
let streamOptions = null;
let hardwareSubscription = null;
let streamMode = 'idle';
let streamError = null;
let lineBuffer = '';
let recordingActive = false;
let liveSampleListener = null;
let lastLiveSample = null;
let streamStats = {
  samplesReceived: 0,
  startedAtMs: null,
  firstSampleAtMs: null,
  lastSampleAtMs: null,
  calculatedHz: null,
  firstSample: null,
  lastSample: null,
  notificationsReceived: 0,
  bytesReceived: 0,
  invalidLines: 0,
  source: null,
};

function resetStreamStats() {
  streamStats = {
    samplesReceived: 0,
    startedAtMs: null,
    firstSampleAtMs: null,
    lastSampleAtMs: null,
    calculatedHz: null,
    firstSample: null,
    lastSample: null,
    notificationsReceived: 0,
    bytesReceived: 0,
    invalidLines: 0,
    source: null,
  };
}

function decodeBase64(value) {
  if (!value) return '';
  try {
    if (typeof globalThis.atob === 'function') {
      return globalThis.atob(value);
    }
  } catch {
    return '';
  }
  return '';
}

function trackSampleRate(sample = null) {
  const now = Date.now();
  if (!streamStats.firstSampleAtMs) {
    streamStats.firstSampleAtMs = now;
    streamStats.firstSample = sample;
    emgLog(
      `First ${streamStats.source === 'hardware' ? 'REAL' : streamStats.source} packet`,
      sample ? `EMG:${sample[0]} POT:${sample[1]}` : '',
      `| latency from stream start: ${streamStats.startedAtMs ? now - streamStats.startedAtMs : '?'} ms`
    );
  }
  streamStats.lastSampleAtMs = now;
  streamStats.lastSample = sample;
  streamStats.samplesReceived += 1;

  const elapsedMs = now - streamStats.firstSampleAtMs;
  if (elapsedMs >= 1000) {
    // n-1 intervals between n samples.
    streamStats.calculatedHz = Number(
      ((streamStats.samplesReceived - 1) / (elapsedMs / 1000)).toFixed(1)
    );
    if (streamStats.samplesReceived === 50 || streamStats.samplesReceived % 100 === 0) {
      emgLog('Sample count:', streamStats.samplesReceived);
      emgLog('Last packet timestamp:', new Date(now).toISOString());
      emgLog('Measured Hz:', streamStats.calculatedHz, `(source: ${streamStats.source})`);
    }
  }
}

function dispatchSample(sample) {
  lastLiveSample = sample;
  liveSampleListener?.(sample);
  if (recordingActive && onSampleCallback) {
    sampleBuffer.push(sample);
    onSampleCallback(sample, sampleBuffer.length);
  }
}

function handleParsedLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return;

  if (trimmed.toUpperCase().startsWith('STATUS:')) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      emgLog('status line', trimmed);
    }
    return;
  }

  const sample = parseEmgLine(trimmed);
  if (!sample) {
    streamStats.invalidLines += 1;
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      emgLog('ignored invalid line', trimmed);
    }
    return;
  }

  trackSampleRate(sample);
  if (streamMode === 'ready' || streamMode === 'connecting') {
    streamMode = 'streaming';
  }
  dispatchSample(sample);
}

function teardownHardwareSubscription() {
  if (hardwareSubscription) {
    try {
      hardwareSubscription.remove();
    } catch {
    }
    hardwareSubscription = null;
  }
  lineBuffer = '';
}

async function ensureHardwareSubscription() {
  if (hardwareSubscription) {
    return true;
  }

  const device = getConnectedBleDevice();
  if (!device) {
    throw new Error('No BLE device connected. Connect ESP32_BT_Device first.');
  }

  lineBuffer = '';
  streamStats.source = 'hardware';

  emgLog('Subscribing to NUS notify on', device.id);

  hardwareSubscription = device.monitorCharacteristicForService(
    NUS_SERVICE_UUID,
    NUS_NOTIFY_UUID,
    (error, characteristic) => {
      if (error) {
        streamError = error.message || 'EMG notification error.';
        streamMode = 'error';
        bleLog('notification error', streamError);
        return;
      }
      if (!characteristic?.value) return;

      const chunk = decodeBase64(characteristic.value);
      streamStats.notificationsReceived += 1;
      streamStats.bytesReceived += chunk.length;

      lineBuffer += chunk;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      lines.forEach((line) => handleParsedLine(line));
    }
  );

  bleLog('notification subscribed');
  streamMode = 'ready';
  return true;
}

function startSimulatedStream(onSample, options) {
  let frameIndex = 0;
  const totalFrames = Math.max(
    options.totalFrames ?? Math.floor((options.durationMs ?? 16000) / EMG_SAMPLE_INTERVAL_MS),
    1
  );

  streamMode = 'streaming';
  streamStats.source = 'simulated';
  emgLog('WARNING: starting SIMULATED stream — no BLE hardware attached');

  streamTimer = setInterval(() => {
    const sample = generateSimulatedSample({
      frameIndex,
      totalFrames,
      potValue: options.potValue ?? 39,
      baseline: options.baseline ?? 60,
      word: options.word ?? null,
    });
    frameIndex += 1;
    trackSampleRate(sample);
    onSample(sample);
  }, EMG_SAMPLE_INTERVAL_MS);
}

/**
 * Keep one BLE notify subscription alive while connected so the UI can show
 * live POT before/during/after recording. Reuses the same subscription when
 * recording starts — never opens a second notify channel.
 */
export async function ensureLiveMonitor(onLiveSample) {
  if (typeof onLiveSample === 'function') {
    liveSampleListener = onLiveSample;
  }

  const connectedDevice = getConnectedBleDevice();
  if (!connectedDevice) {
    return { mode: 'idle', sample: null };
  }

  if (!hardwareSubscription && !streamTimer) {
    streamError = null;
    resetStreamStats();
    streamStats.startedAtMs = Date.now();
    streamMode = 'connecting';
    await ensureHardwareSubscription();
  }

  if (lastLiveSample && liveSampleListener) {
    liveSampleListener(lastLiveSample);
  }

  return {
    mode: hardwareSubscription ? 'hardware' : streamTimer ? 'simulated' : 'idle',
    sample: lastLiveSample,
  };
}

export function stopLiveMonitor() {
  if (recordingActive) {
    return;
  }
  liveSampleListener = null;
  stopEmgStream({ keepMonitor: false, clearLiveSample: true });
}

export function getLastLiveSample() {
  return lastLiveSample;
}

export function clearLiveEmgState() {
  liveSampleListener = null;
  lastLiveSample = null;
  stopEmgStream({ keepMonitor: false, clearLiveSample: true });
}

/**
 * Start EMG stream.
 *
 * - If a BLE device is connected: real hardware only (never silent simulation).
 * - If no device is connected: optional simulation when ALLOW_EMG_SIMULATION / forceSimulation.
 */
export async function startEmgStream(options = {}) {
  streamOptions = options;
  sampleBuffer = [];
  onSampleCallback = options.onSample ?? null;
  streamError = null;
  resetStreamStats();
  streamStats.startedAtMs = Date.now();
  recordingActive = true;

  const connectedDevice = getConnectedBleDevice();
  const forceSimulation = options.forceSimulation === true;
  const allowSimulation =
    forceSimulation || (!connectedDevice && ALLOW_EMG_SIMULATION);

  if (connectedDevice && !forceSimulation) {
    try {
      if (streamTimer) {
        clearInterval(streamTimer);
        streamTimer = null;
      }
      streamMode = hardwareSubscription ? 'streaming' : 'connecting';
      await ensureHardwareSubscription();
      streamMode = 'streaming';
      return {
        samplingRate: EMG_SAMPLING_RATE_HZ,
        mode: 'hardware',
        streamMode,
      };
    } catch (error) {
      streamMode = 'error';
      streamError = error?.message || 'Failed to subscribe to EMG notifications.';
      recordingActive = false;
      onSampleCallback = null;
      stopEmgStream({ keepMonitor: Boolean(liveSampleListener) });
      throw new Error(
        streamError ||
          'Connected, but EMG stream unavailable.'
      );
    }
  }

  if (!allowSimulation) {
    streamMode = 'error';
    recordingActive = false;
    onSampleCallback = null;
    throw new Error(
      'Hardware EMG stream unavailable. Connect your EMG device to continue.'
    );
  }

  teardownHardwareSubscription();
  startSimulatedStream((sample) => {
    dispatchSample(sample);
  }, options);
  return {
    samplingRate: EMG_SAMPLING_RATE_HZ,
    mode: 'simulated',
    streamMode,
  };
}

export function stopEmgStream(options = {}) {
  const keepMonitor = options.keepMonitor === true;
  const clearLiveSample = options.clearLiveSample === true;
  const samples = [...sampleBuffer];

  recordingActive = false;
  onSampleCallback = null;
  sampleBuffer = [];
  streamOptions = null;

  if (streamTimer) {
    clearInterval(streamTimer);
    streamTimer = null;
  }

  if (keepMonitor && liveSampleListener && hardwareSubscription) {
    streamMode = 'ready';
    return samples;
  }

  if (!keepMonitor) {
    liveSampleListener = null;
  }
  if (clearLiveSample) {
    lastLiveSample = null;
  }

  teardownHardwareSubscription();

  if (streamMode === 'streaming' || streamMode === 'connecting' || streamMode === 'ready') {
    streamMode = keepMonitor && liveSampleListener ? 'ready' : 'idle';
  }

  return samples;
}

export function getStreamSampleCount() {
  return sampleBuffer.length;
}

export function isStreamActive() {
  return Boolean(streamTimer || hardwareSubscription);
}

export function getEmgStreamMode() {
  return streamMode;
}

export function getEmgStreamError() {
  return streamError;
}

export function getEmgStreamDiagnostics() {
  const elapsedMs = streamStats.firstSampleAtMs
    ? (streamStats.lastSampleAtMs || Date.now()) - streamStats.firstSampleAtMs
    : 0;

  return {
    streamMode,
    mode: hardwareSubscription ? 'hardware' : streamTimer ? 'simulated' : 'idle',
    /** Simulation cannot be true while a hardware notify subscription exists. */
    simulationActive: Boolean(streamTimer),
    samplesReceived: streamStats.samplesReceived,
    notificationsReceived: streamStats.notificationsReceived,
    bytesReceived: streamStats.bytesReceived,
    invalidLines: streamStats.invalidLines,
    firstSample: streamStats.firstSample,
    lastSample: streamStats.lastSample,
    firstSampleAtMs: streamStats.firstSampleAtMs,
    lastSampleAtMs: streamStats.lastSampleAtMs,
    elapsedMs,
    calculatedHz: streamStats.calculatedHz,
    error: streamError,
  };
}

/**
 * Hard assertion used by hardware QA: proves the samples now in the buffer came
 * from a BLE notify subscription and that no simulated generator is running.
 */
export function assertHardwareOnly() {
  return {
    hardwareSubscribed: Boolean(hardwareSubscription),
    simulationTimerRunning: Boolean(streamTimer),
    simulationAllowedByConfig: ALLOW_EMG_SIMULATION,
    source: streamStats.source,
    samplesReceived: streamStats.samplesReceived,
    verdict:
      hardwareSubscription && !streamTimer
        ? 'HARDWARE_ONLY'
        : streamTimer
          ? 'SIMULATION_RUNNING'
          : 'NO_STREAM',
  };
}
