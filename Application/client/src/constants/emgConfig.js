export const MIN_CALIBRATION_CAPTURES = 8;
export const PREFERRED_CALIBRATION_CAPTURES = 10;
export const MAX_CALIBRATION_CAPTURES = 12;
export const MIN_CALIBRATION_SAMPLES = 100;

/** Legacy batch flow — kept for reference/fallback suggestions only. */
export const EMG_WORDS = ['help', 'no', 'pain', 'stop'];

export const DEFAULT_POT_BY_WORD = {
  help: 39,
  no: 27,
  pain: 6,
  stop: 15,
};

export const EMG_SAMPLING_RATE_HZ = 50;
export const EMG_SAMPLE_INTERVAL_MS = 1000 / EMG_SAMPLING_RATE_HZ;

export const MIN_SAMPLES = 50;
export const TARGET_SAMPLES = 384;
export const MIN_RECORDING_SEC = 8;
export const RECOMMENDED_RECORDING_SEC = 16;

/**
 * Verified AI inference window.
 *
 * The Python predictor's own hard gate is 50 samples, but measured agreement
 * with ground truth is 41.5% there and 87.8% at 384. 768 is the smallest window
 * that fully reproduces the verified result, and the Node backend refuses to
 * call Python below it. Do not lower this to make the app feel faster.
 */
export const AI_WINDOW_SAMPLES = 768;

/** The predictor rejects anything above this as a stale buffer. */
export const AI_MAX_WINDOW_SAMPLES = 1800;

/** ~15.36 s at 50 Hz. Surfaced in the UI so the wait is never a surprise. */
export const AI_WINDOW_SECONDS = AI_WINDOW_SAMPLES / EMG_SAMPLING_RATE_HZ;

/** Neutral baseline needed by the optional session-adaptation endpoint. */
export const AI_SESSION_BASELINE_SAMPLES = 80;

export const NEUTRAL_CALIBRATION_SEC = 6;
export const WORD_CALIBRATION_SEC = 4;

export const EMG_BASELINE_ADC = 60;
export const EMG_ADC_MAX = 4095;
export const POT_MAX = 100;

export const ALLOW_EMG_SIMULATION =
  typeof __DEV__ !== 'undefined' && __DEV__
    ? process.env.EXPO_PUBLIC_ALLOW_EMG_SIMULATION !== 'false'
    : process.env.EXPO_PUBLIC_ALLOW_EMG_SIMULATION === 'true';
