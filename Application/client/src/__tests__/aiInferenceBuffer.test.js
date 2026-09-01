/**
 * AI inference buffer unit tests. No Bluetooth, no network.
 */

import {
  AiInferenceBuffer,
  SAMPLE_REJECTED,
  validateSample,
  runOnceForWindow,
  resetWindowSubmissions,
  windowIdentity,
  resetAiBuffer,
  addAiSample,
} from '../services/aiInferenceService';
import { AI_WINDOW_SAMPLES, EMG_ADC_MAX, POT_MAX } from '../constants/emgConfig';

/** Real-shaped samples: the parser emits [emg, pot] tuples. */
function tuple(i = 0, pot = 39) {
  return [900 + Math.round(120 * Math.sin(i / 7)), pot];
}

function fill(buffer, count, pot = 39) {
  for (let i = 0; i < count; i += 1) {
    buffer.addSample(tuple(i, pot));
  }
}

describe('validateSample', () => {
  it('accepts the [emg, pot] tuple shape the existing parser produces', () => {
    const result = validateSample([1234, 39]);
    expect(result.ok).toBe(true);
    expect(result.row.emg).toBe(1234);
    expect(result.row.pot).toBe(39);
    expect(typeof result.row.timestamp).toBe('number');
  });

  it('accepts an explicit object with a timestamp', () => {
    const result = validateSample({ emg: 10, pot: 5, timestamp: 1700000000000 });
    expect(result.ok).toBe(true);
    expect(result.row.timestamp).toBe(1700000000000);
  });

  it('stamps a timestamp when none is supplied', () => {
    const before = Date.now();
    const result = validateSample([100, 20]);
    expect(result.row.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('preserves the supplied timestamp over the generated one', () => {
    const result = validateSample([100, 20], 1234567890);
    expect(result.row.timestamp).toBe(1234567890);
  });

  it.each([
    ['NaN emg', [NaN, 39], SAMPLE_REJECTED.EMG_NOT_FINITE],
    ['Infinity emg', [Infinity, 39], SAMPLE_REJECTED.EMG_NOT_FINITE],
    ['-Infinity emg', [-Infinity, 39], SAMPLE_REJECTED.EMG_NOT_FINITE],
    ['string emg', ['1234', 39], SAMPLE_REJECTED.EMG_NOT_FINITE],
    ['null emg', [null, 39], SAMPLE_REJECTED.EMG_NOT_FINITE],
    ['boolean emg', [true, 39], SAMPLE_REJECTED.EMG_NOT_FINITE],
    ['NaN pot', [900, NaN], SAMPLE_REJECTED.POT_NOT_FINITE],
    ['string pot', [900, '39'], SAMPLE_REJECTED.POT_NOT_FINITE],
    ['missing pot', [900], SAMPLE_REJECTED.NOT_A_SAMPLE],
    ['emg above range', [EMG_ADC_MAX + 1, 39], SAMPLE_REJECTED.EMG_OUT_OF_RANGE],
    ['emg below range', [-1, 39], SAMPLE_REJECTED.EMG_OUT_OF_RANGE],
    ['pot above range', [900, POT_MAX + 1], SAMPLE_REJECTED.POT_OUT_OF_RANGE],
    ['pot below range', [900, -1], SAMPLE_REJECTED.POT_OUT_OF_RANGE],
    ['not a sample', 'EMG:900 POT:39', SAMPLE_REJECTED.NOT_A_SAMPLE],
    ['null sample', null, SAMPLE_REJECTED.NOT_A_SAMPLE],
    ['empty array', [], SAMPLE_REJECTED.NOT_A_SAMPLE],
  ])('rejects %s without repairing it', (_name, sample, reason) => {
    const result = validateSample(sample);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.row).toBeUndefined();
  });

  it('rejects an invalid timestamp', () => {
    expect(validateSample([900, 39], -1).reason).toBe(SAMPLE_REJECTED.TIMESTAMP_INVALID);
    expect(validateSample([900, 39], NaN).reason).toBe(SAMPLE_REJECTED.TIMESTAMP_INVALID);
    expect(validateSample({ emg: 900, pot: 39, timestamp: 'now' }).reason).toBe(
      SAMPLE_REJECTED.TIMESTAMP_INVALID
    );
  });

  it('accepts the exact hardware range boundaries', () => {
    expect(validateSample([0, 0]).ok).toBe(true);
    expect(validateSample([EMG_ADC_MAX, POT_MAX]).ok).toBe(true);
  });
});

describe('AiInferenceBuffer', () => {
  let buffer;

  beforeEach(() => {
    buffer = new AiInferenceBuffer();
  });

  it('starts empty and not ready', () => {
    expect(buffer.getSampleCount()).toBe(0);
    expect(buffer.isWindowReady()).toBe(false);
    expect(buffer.canPredict()).toBe(false);
    expect(buffer.takeWindow()).toBeNull();
    expect(buffer.getProgress()).toEqual({
      count: 0,
      required: AI_WINDOW_SAMPLES,
      ratio: 0,
      remaining: AI_WINDOW_SAMPLES,
      ready: false,
    });
  });

  it('uses 768 as the window size', () => {
    expect(buffer.windowSamples).toBe(768);
  });

  it('accumulates valid samples and preserves EMG + POT', () => {
    buffer.addSample([1234, 39]);
    buffer.addSample([1300, 39]);

    expect(buffer.getSampleCount()).toBe(2);
    expect(buffer.rows[0]).toMatchObject({ emg: 1234, pot: 39 });
    expect(buffer.rows[1]).toMatchObject({ emg: 1300, pot: 39 });
    expect(buffer.rows[0].timestamp).toBeDefined();
  });

  it('counts rejected samples without adding them', () => {
    buffer.addSample([900, 39]);
    buffer.addSample([NaN, 39]);
    buffer.addSample(['bad', 39]);
    buffer.addSample([900, 39]);

    expect(buffer.getSampleCount()).toBe(2);
    expect(buffer.getRejectedCount()).toBe(2);
  });

  it('does not trigger at 767 samples', () => {
    fill(buffer, 767);

    expect(buffer.getSampleCount()).toBe(767);
    expect(buffer.isWindowReady()).toBe(false);
    expect(buffer.canPredict()).toBe(false);
    expect(buffer.takeWindow()).toBeNull();
    expect(buffer.getProgress().remaining).toBe(1);
  });

  it('does not trigger at 1 or 100 samples', () => {
    fill(buffer, 1);
    expect(buffer.canPredict()).toBe(false);

    fill(buffer, 99);
    expect(buffer.getSampleCount()).toBe(100);
    expect(buffer.canPredict()).toBe(false);
    expect(buffer.takeWindow()).toBeNull();
  });

  it('becomes ready at exactly 768 samples', () => {
    fill(buffer, AI_WINDOW_SAMPLES);

    expect(buffer.getSampleCount()).toBe(768);
    expect(buffer.isWindowReady()).toBe(true);
    expect(buffer.canPredict()).toBe(true);
    expect(buffer.getProgress()).toMatchObject({ ready: true, remaining: 0, ratio: 1 });
  });

  it('returns exactly 768 rows with emg, pot and timestamp', () => {
    fill(buffer, 900);
    const window = buffer.takeWindow();

    expect(window).toHaveLength(768);
    window.forEach((row) => {
      expect(typeof row.emg).toBe('number');
      expect(typeof row.pot).toBe('number');
      expect(typeof row.timestamp).toBe('number');
      expect(Number.isFinite(row.emg)).toBe(true);
      expect(Number.isFinite(row.pot)).toBe(true);
    });
  });

  it('takes the oldest complete window, not a trailing slice', () => {
    for (let i = 0; i < 800; i += 1) {
      buffer.addSample([i, 39]);
    }
    const window = buffer.takeWindow();

    expect(window[0].emg).toBe(0);
    expect(window[767].emg).toBe(767);
  });

  it('triggers exactly once for one window', () => {
    fill(buffer, AI_WINDOW_SAMPLES);

    expect(buffer.takeWindow()).not.toBeNull();
    // Every later attempt must be refused.
    expect(buffer.takeWindow()).toBeNull();
    expect(buffer.takeWindow()).toBeNull();
    expect(buffer.canPredict()).toBe(false);
  });

  it('prevents a concurrent request while one is in flight', () => {
    fill(buffer, AI_WINDOW_SAMPLES);
    buffer.takeWindow();

    expect(buffer.isPredictionInFlight()).toBe(true);
    expect(buffer.canPredict()).toBe(false);

    // More samples arriving mid-flight must not open a second request.
    fill(buffer, 200);
    expect(buffer.canPredict()).toBe(false);
    expect(buffer.takeWindow()).toBeNull();
  });

  it('stays closed to repeats after a successful prediction', () => {
    fill(buffer, AI_WINDOW_SAMPLES);
    buffer.takeWindow();
    buffer.releaseWindow();

    expect(buffer.isPredictionInFlight()).toBe(false);
    expect(buffer.canPredict()).toBe(false);
    expect(buffer.takeWindow()).toBeNull();
  });

  it('allows a retry after a failed prediction', () => {
    fill(buffer, AI_WINDOW_SAMPLES);
    const first = buffer.takeWindow();
    buffer.releaseWindow({ allowRetry: true });

    expect(buffer.canPredict()).toBe(true);
    const second = buffer.takeWindow();
    expect(second).toHaveLength(768);
    expect(second[0].emg).toBe(first[0].emg);
  });

  it('clears everything on reset', () => {
    fill(buffer, AI_WINDOW_SAMPLES);
    buffer.takeWindow();
    buffer.reset();

    expect(buffer.getSampleCount()).toBe(0);
    expect(buffer.getRejectedCount()).toBe(0);
    expect(buffer.isPredictionInFlight()).toBe(false);
    expect(buffer.canPredict()).toBe(false);
    expect(buffer.takeWindow()).toBeNull();
  });

  it('does not reuse samples from a previous word after reset', () => {
    for (let i = 0; i < AI_WINDOW_SAMPLES; i += 1) {
      buffer.addSample([500, 39]);
    }
    buffer.reset();
    for (let i = 0; i < AI_WINDOW_SAMPLES; i += 1) {
      buffer.addSample([1500, 6]);
    }

    const window = buffer.takeWindow();
    expect(window).toHaveLength(768);
    // Not one sample from the first word survived.
    expect(window.every((row) => row.emg === 1500 && row.pot === 6)).toBe(true);
  });

  it('stops accepting samples once closed, as after a BLE disconnect', () => {
    fill(buffer, 400);
    buffer.close();

    const result = buffer.addSample([900, 39]);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe(SAMPLE_REJECTED.BUFFER_CLOSED);
    expect(buffer.getSampleCount()).toBe(400);
  });

  it('cannot reach a predictable window while closed', () => {
    fill(buffer, 700);
    buffer.close();
    fill(buffer, 200);

    expect(buffer.getSampleCount()).toBe(700);
    expect(buffer.canPredict()).toBe(false);
  });

  it('stops prediction if BLE disconnect closes a completed window', () => {
    fill(buffer, AI_WINDOW_SAMPLES);
    expect(buffer.canPredict()).toBe(true);

    buffer.close();

    expect(buffer.canPredict()).toBe(false);
    expect(buffer.takeWindow()).toBeNull();
    expect(buffer.isPredictionInFlight()).toBe(false);
  });

  it('can be reopened for the next recording', () => {
    buffer.close();
    expect(buffer.addSample([900, 39]).accepted).toBe(false);

    buffer.open();
    expect(buffer.addSample([900, 39]).accepted).toBe(true);
  });

  it('never exceeds the predictor stale-buffer limit', () => {
    fill(buffer, 2500);

    expect(buffer.getSampleCount()).toBe(1800);
    expect(buffer.getSampleCount()).toBeLessThanOrEqual(buffer.maxSamples);
  });

  it('never invents a sample', () => {
    // 300 valid, 300 invalid. Only the valid ones may exist.
    for (let i = 0; i < 300; i += 1) {
      buffer.addSample([900, 39]);
      buffer.addSample([NaN, NaN]);
    }
    expect(buffer.getSampleCount()).toBe(300);
    expect(buffer.canPredict()).toBe(false);
  });
});

describe('runOnceForWindow', () => {
  const windowA = [
    { emg: 900, pot: 39, timestamp: 1000 },
    { emg: 901, pot: 39, timestamp: 1020 },
  ];
  const windowB = [
    { emg: 1500, pot: 6, timestamp: 5000 },
    { emg: 1501, pot: 6, timestamp: 5020 },
  ];

  beforeEach(() => {
    resetWindowSubmissions();
  });

  it('runs the callback exactly once for the same window', async () => {
    const fn = jest.fn(async () => ({ label: 'help' }));

    const first = runOnceForWindow(windowA, fn);
    const second = runOnceForWindow(windowA, fn);
    const [a, b] = await Promise.all([first, second]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ label: 'help' });
    expect(b).toEqual({ label: 'help' });
  });

  it('rejects a second call after the first window completed', async () => {
    const fn = jest.fn(async () => ({ label: 'help' }));
    await runOnceForWindow(windowA, fn);
    const again = await runOnceForWindow(windowA, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ skipped: true, reason: 'already-completed' });
  });

  it('allows a different window to predict', async () => {
    const fn = jest.fn(async () => ({ label: 'help' }));
    await runOnceForWindow(windowA, fn);
    await runOnceForWindow(windowB, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('allows a retry after a failed prediction', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ label: 'stop' });

    await expect(runOnceForWindow(windowA, fn)).rejects.toThrow('network');
    const retry = await runOnceForWindow(windowA, fn);
    expect(retry).toEqual({ label: 'stop' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('resetAiBuffer clears submission locks for a new recording', async () => {
    const fn = jest.fn(async () => ({ label: 'help' }));
    await runOnceForWindow(windowA, fn);
    resetAiBuffer();
    await runOnceForWindow(windowA, fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('keeps timestamps on buffer rows', () => {
    resetAiBuffer();
    addAiSample({ emg: 1234, pot: 39, timestamp: 42 });
    expect(windowIdentity([{ emg: 1234, pot: 39, timestamp: 42 }])).toContain('42');
  });
});
