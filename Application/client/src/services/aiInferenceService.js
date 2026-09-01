/**
 * AI inference buffer.
 *
 * Collects real EMG/POT samples until a complete verified inference window
 * exists, then hands that window to the caller exactly once.
 *
 * This module NEVER generates samples. It only accepts what the existing BLE
 * stream gives it, and only if the values are genuinely numeric. It has no
 * React Native or BLE imports so it can be unit tested without hardware.
 *
 * Fan-out, deliberately using the single existing subscription:
 *
 *   BLE notify -> emgStreamService -> onSample -> RecordSignalScreen
 *                                                  |-- recording buffer
 *                                                  `-- this AI buffer
 */

import {
  AI_MAX_WINDOW_SAMPLES,
  AI_WINDOW_SAMPLES,
  EMG_ADC_MAX,
  POT_MAX,
} from '../constants/emgConfig';

/** Rejection reasons, returned rather than thrown so the stream never breaks. */
export const SAMPLE_REJECTED = {
  NOT_A_SAMPLE: 'not-a-sample',
  EMG_NOT_FINITE: 'emg-not-finite',
  POT_NOT_FINITE: 'pot-not-finite',
  EMG_OUT_OF_RANGE: 'emg-out-of-range',
  POT_OUT_OF_RANGE: 'pot-out-of-range',
  TIMESTAMP_INVALID: 'timestamp-invalid',
  BUFFER_CLOSED: 'buffer-closed',
};

/**
 * Validate one sample without altering it.
 *
 * Accepts the [emg, pot] tuple the existing parser produces, or an
 * { emg, pot, timestamp } object. Returns { ok, row } or { ok: false, reason }.
 * Invalid samples are never silently repaired.
 */
export function validateSample(sample, timestamp = null) {
  let emg;
  let pot;
  let ts = timestamp;

  if (Array.isArray(sample)) {
    if (sample.length < 2) {
      return { ok: false, reason: SAMPLE_REJECTED.NOT_A_SAMPLE };
    }
    [emg, pot] = sample;
  } else if (sample && typeof sample === 'object') {
    emg = sample.emg;
    pot = sample.pot;
    if (sample.timestamp !== undefined) {
      ts = sample.timestamp;
    }
  } else {
    return { ok: false, reason: SAMPLE_REJECTED.NOT_A_SAMPLE };
  }

  // typeof guards reject strings, booleans and null rather than coercing them.
  if (typeof emg !== 'number' || !Number.isFinite(emg)) {
    return { ok: false, reason: SAMPLE_REJECTED.EMG_NOT_FINITE };
  }
  if (typeof pot !== 'number' || !Number.isFinite(pot)) {
    return { ok: false, reason: SAMPLE_REJECTED.POT_NOT_FINITE };
  }
  if (emg < 0 || emg > EMG_ADC_MAX) {
    return { ok: false, reason: SAMPLE_REJECTED.EMG_OUT_OF_RANGE };
  }
  if (pot < 0 || pot > POT_MAX) {
    return { ok: false, reason: SAMPLE_REJECTED.POT_OUT_OF_RANGE };
  }

  if (ts != null) {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 0) {
      return { ok: false, reason: SAMPLE_REJECTED.TIMESTAMP_INVALID };
    }
  }

  return {
    ok: true,
    row: {
      emg,
      pot,
      timestamp: ts != null ? ts : Date.now(),
    },
  };
}

/**
 * A single-window AI buffer.
 *
 * Kept as a class so tests can create isolated instances, with a module-level
 * singleton exported below for the app to share.
 */
export class AiInferenceBuffer {
  constructor({ windowSamples = AI_WINDOW_SAMPLES, maxSamples = AI_MAX_WINDOW_SAMPLES } = {}) {
    this.windowSamples = windowSamples;
    this.maxSamples = maxSamples;
    this.reset();
  }

  reset() {
    this.rows = [];
    this.rejected = 0;
    this.lastRejectReason = null;
    this.predictionInFlight = false;
    this.windowConsumed = false;
    this.closed = false;
    this.startedAtMs = null;
  }

  /** Stop accepting samples, e.g. after a BLE disconnect. */
  close() {
    this.closed = true;
  }

  open() {
    this.closed = false;
  }

  /**
   * Append one sample.
   * @returns {{accepted: boolean, count: number, reason?: string}}
   */
  addSample(sample, timestamp = null) {
    if (this.closed) {
      return { accepted: false, count: this.rows.length, reason: SAMPLE_REJECTED.BUFFER_CLOSED };
    }

    const result = validateSample(sample, timestamp);
    if (!result.ok) {
      this.rejected += 1;
      this.lastRejectReason = result.reason;
      return { accepted: false, count: this.rows.length, reason: result.reason };
    }

    if (this.startedAtMs == null) {
      this.startedAtMs = Date.now();
    }

    this.rows.push(result.row);

    // Keep a rolling window so a long recording never exceeds what the
    // predictor accepts. The oldest samples fall off the front.
    if (this.rows.length > this.maxSamples) {
      this.rows.splice(0, this.rows.length - this.maxSamples);
    }

    return { accepted: true, count: this.rows.length };
  }

  getSampleCount() {
    return this.rows.length;
  }

  getRejectedCount() {
    return this.rejected;
  }

  getProgress() {
    return {
      count: this.rows.length,
      required: this.windowSamples,
      ratio: Math.min(1, this.rows.length / this.windowSamples),
      remaining: Math.max(0, this.windowSamples - this.rows.length),
      ready: this.rows.length >= this.windowSamples,
    };
  }

  isWindowReady() {
    return this.rows.length >= this.windowSamples;
  }

  /**
   * True only when a fresh, complete window is available and no request is
   * already running. This is the single gate that guarantees one request per
   * window.
   */
  canPredict() {
    return (
      !this.closed &&
      this.isWindowReady() &&
      !this.predictionInFlight &&
      !this.windowConsumed
    );
  }

  /**
   * Claim the window for exactly one prediction.
   *
   * Returns null if the window is not ready, a request is in flight, or the
   * window was already consumed. Callers must invoke releaseWindow() when the
   * request settles.
   */
  takeWindow() {
    if (!this.canPredict()) {
      return null;
    }

    this.predictionInFlight = true;
    this.windowConsumed = true;

    // The oldest complete window, so the samples are the ones the user actually
    // produced first rather than a trailing slice.
    return this.rows.slice(0, this.windowSamples);
  }

  /**
   * Release the in-flight lock.
   * @param {{allowRetry?: boolean}} options When allowRetry is true the same
   *   window may be claimed again, which is what a transient network failure
   *   needs. Defaults to false so a completed prediction is never repeated.
   */
  releaseWindow({ allowRetry = false } = {}) {
    this.predictionInFlight = false;
    if (allowRetry) {
      this.windowConsumed = false;
    }
  }

  isPredictionInFlight() {
    return this.predictionInFlight;
  }
}

/* ------------------------------------------------------------------ *
 * One HTTP prediction per completed window
 *
 * ProcessingScreen keeps `hasStarted` on a component ref. React Navigation
 * remounts and React Strict Mode in __DEV__ create a new instance, which
 * resets that ref and would POST the same aiRows twice. This module-level
 * registry survives remounts. Identity is the window's own samples, so a
 * new recording (different timestamps / values) is a new key.
 * ------------------------------------------------------------------ */

function windowIdentity(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return '';
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  return [
    rows.length,
    first.timestamp,
    first.emg,
    first.pot,
    last.timestamp,
    last.emg,
    last.pot,
  ].join(':');
}

const windowSubmissions = {
  inFlight: new Map(),
  completed: new Set(),
};

/**
 * Run `fn` at most once for this sample window.
 * Overlapping callers join the in-flight promise (one HTTP request).
 * A later new recording has a different identity and is allowed.
 */
export function runOnceForWindow(rows, fn) {
  const key = windowIdentity(rows);
  if (!key) {
    return Promise.resolve({ skipped: true, reason: 'empty-window' });
  }

  if (windowSubmissions.completed.has(key)) {
    return Promise.resolve({ skipped: true, reason: 'already-completed' });
  }

  if (windowSubmissions.inFlight.has(key)) {
    return windowSubmissions.inFlight.get(key);
  }

  const promise = Promise.resolve()
    .then(fn)
    .then((result) => {
      if (!result?.buffering) {
        windowSubmissions.completed.add(key);
      }
      return result;
    })
    .finally(() => {
      windowSubmissions.inFlight.delete(key);
    });

  windowSubmissions.inFlight.set(key, promise);
  return promise;
}

export function resetWindowSubmissions() {
  windowSubmissions.inFlight.clear();
  windowSubmissions.completed.clear();
}

export function __getWindowSubmissions() {
  return windowSubmissions;
}

export { windowIdentity };

/* ------------------------------------------------------------------ *
 * Shared singleton used by the recording screen
 * ------------------------------------------------------------------ */

const buffer = new AiInferenceBuffer();

export function resetAiBuffer() {
  buffer.reset();
  resetWindowSubmissions();
}

export function closeAiBuffer() {
  buffer.close();
}

export function openAiBuffer() {
  buffer.open();
}

export function addAiSample(sample, timestamp = null) {
  return buffer.addSample(sample, timestamp);
}

export function getAiSampleCount() {
  return buffer.getSampleCount();
}

export function getAiRejectedCount() {
  return buffer.getRejectedCount();
}

export function getAiProgress() {
  return buffer.getProgress();
}

export function isAiWindowReady() {
  return buffer.isWindowReady();
}

export function canRunAiPrediction() {
  return buffer.canPredict();
}

export function takeAiWindow() {
  return buffer.takeWindow();
}

export function releaseAiWindow(options) {
  return buffer.releaseWindow(options);
}

export function isAiPredictionInFlight() {
  return buffer.isPredictionInFlight();
}

/** Test seam only. */
export function __getAiBuffer() {
  return buffer;
}
