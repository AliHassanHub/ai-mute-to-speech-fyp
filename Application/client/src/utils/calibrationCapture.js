import {
  MIN_CALIBRATION_SAMPLES,
} from '../constants/emgConfig';
import { computeSignalStats } from './emgSignal';

export function samplesToRows(samples, startedAtMs = Date.now()) {
  return samples.map((sample, index) => ({
    emg: Number(sample[0]),
    pot: Number(sample[1]),
    timestamp: startedAtMs + index * 20,
  }));
}

export function captureToPayload(samples, startedAtMs = Date.now()) {
  return {
    signal: {
      format: 'samples',
      rows: samplesToRows(samples, startedAtMs),
    },
  };
}

/**
 * Client-side quality gate aligned with Python quality_reason thresholds.
 */
export function validateCaptureQuality(samples) {
  if (!Array.isArray(samples) || samples.length < MIN_CALIBRATION_SAMPLES) {
    return {
      ok: false,
      reason: `Need at least ${MIN_CALIBRATION_SAMPLES} samples (~2 s).`,
      code: 'too-short',
    };
  }

  for (let index = 0; index < samples.length; index += 1) {
    const row = samples[index];
    if (!Array.isArray(row) || row.length < 2) {
      return { ok: false, reason: 'Invalid sample format.', code: 'bad-shape' };
    }
    if (!Number.isFinite(row[0]) || !Number.isFinite(row[1])) {
      return { ok: false, reason: 'Non-finite EMG or POT values.', code: 'nan-or-inf' };
    }
  }

  const stats = computeSignalStats(samples);
  const emgValues = samples.map((row) => row[0]);
  const emgRange =
    Math.max(...emgValues) - Math.min(...emgValues);

  if (stats.emgStd < 8 && emgRange < 50) {
    return {
      ok: false,
      reason: `Flat EMG signal (std=${stats.emgStd.toFixed(1)}).`,
      code: 'flat-emg',
    };
  }

  if (stats.potStd > 3.5) {
    return {
      ok: false,
      reason: `Unstable POT (std=${stats.potStd.toFixed(1)}). Hold position steady.`,
      code: 'unstable-pot',
    };
  }

  return {
    ok: true,
    reason: 'Good signal',
    code: 'ok',
    stats,
  };
}

export function buildWordStatusMap(profileResponse, vocabulary = []) {
  const words = Array.isArray(profileResponse?.words) ? profileResponse.words : [];
  const byWord = new Map(words.map((entry) => [String(entry.word).toLowerCase(), entry]));

  return vocabulary.map((word) => {
    const key = String(word).toLowerCase();
    const entry = byWord.get(key);
    const calibrated =
      entry?.state === 'calibrated' && Boolean(entry?.hasEmgReference);
    return {
      word: key,
      state: calibrated ? 'calibrated' : 'pending',
      hasEmgReference: Boolean(entry?.hasEmgReference),
      potCenter: entry?.potCenter ?? null,
      potRadius: entry?.potRadius ?? null,
      qualityScore: entry?.qualityScore ?? null,
      captureCount: entry?.captureCount ?? 0,
      calibratedAt: entry?.calibratedAt ?? null,
      globalSupported: true,
      userPersonalized: calibrated,
    };
  });
}

export function summarizePersonalization(wordStatuses = []) {
  const personalized = wordStatuses
    .filter((item) => item.userPersonalized)
    .map((item) => item.word);
  const globalFallback = wordStatuses
    .filter((item) => !item.userPersonalized)
    .map((item) => item.word);
  return { personalized, globalFallback };
}

export function profileWordsToPotMap(profileResponse, vocabulary = []) {
  const words = buildWordStatusMap(profileResponse, vocabulary);
  const map = {};
  words.forEach((item) => {
    if (item.potCenter != null) {
      map[item.word] = { potMean: item.potCenter };
    }
  });
  return map;
}

export function createIdempotencyKey(word) {
  return `word-${String(word).toLowerCase()}-${Date.now()}`;
}
