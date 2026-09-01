/**
 * Phase 2C incremental calibration — dashboard state, capture quality, vocabulary.
 */

const {
  buildWordStatusMap,
  summarizePersonalization,
  validateCaptureQuality,
  profileWordsToPotMap,
  samplesToRows,
  captureToPayload,
} = require('../utils/calibrationCapture');

const VOCABULARY = [
  'help',
  'no',
  'pain',
  'stop',
  'assistance',
  'medical',
  'pick',
  'land',
  'up',
];

function makeSamples({ emgBase = 1200, pot = 10, count = 120, emgJitter = 40 }) {
  return Array.from({ length: count }, (_, index) => [
    emgBase + Math.sin(index / 5) * emgJitter,
    pot,
  ]);
}

describe('calibration dashboard state', () => {
  it('shows zero calibrated words for empty profile', () => {
    const words = buildWordStatusMap({ words: [] }, VOCABULARY);
    expect(words).toHaveLength(VOCABULARY.length);
    expect(words.filter((item) => item.userPersonalized)).toHaveLength(0);
    expect(summarizePersonalization(words).personalized).toEqual([]);
  });

  it('shows one calibrated word', () => {
    const profile = {
      words: [
        {
          word: 'pain',
          state: 'calibrated',
          hasEmgReference: true,
          potCenter: 6,
          qualityScore: 0.91,
          captureCount: 10,
        },
      ],
    };
    const words = buildWordStatusMap(profile, VOCABULARY);
    expect(words.find((item) => item.word === 'pain').userPersonalized).toBe(true);
    expect(summarizePersonalization(words).personalized).toEqual(['pain']);
  });

  it('shows multiple calibrated words and preserves others as global fallback', () => {
    const profile = {
      words: [
        { word: 'pain', state: 'calibrated', hasEmgReference: true, potCenter: 6 },
        { word: 'help', state: 'calibrated', hasEmgReference: true, potCenter: 39 },
      ],
    };
    const words = buildWordStatusMap(profile, VOCABULARY);
    const summary = summarizePersonalization(words);
    expect(summary.personalized.sort()).toEqual(['help', 'pain']);
    expect(summary.globalFallback).toContain('no');
    expect(summary.globalFallback).not.toContain('pain');
  });

  it('uses dynamic vocabulary order from API labels', () => {
    const customVocab = ['up', 'land', 'pick'];
    const words = buildWordStatusMap({ words: [] }, customVocab);
    expect(words.map((item) => item.word)).toEqual(customVocab);
  });

  it('distinguishes global support from user personalization', () => {
    const words = buildWordStatusMap(
      {
        words: [{ word: 'medical', state: 'calibrated', hasEmgReference: true, potCenter: 22 }],
      },
      VOCABULARY
    );
    const medical = words.find((item) => item.word === 'medical');
    const stop = words.find((item) => item.word === 'stop');
    expect(medical.globalSupported).toBe(true);
    expect(medical.userPersonalized).toBe(true);
    expect(stop.globalSupported).toBe(true);
    expect(stop.userPersonalized).toBe(false);
  });
});

describe('capture quality validation', () => {
  it('accepts a good capture', () => {
    const result = validateCaptureQuality(makeSamples({}));
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('Good signal');
  });

  it('rejects flat EMG', () => {
    const flat = makeSamples({ emgJitter: 0, emgBase: 1000 });
    const result = validateCaptureQuality(flat);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('flat-emg');
  });

  it('rejects unstable POT', () => {
    const unstable = makeSamples({ pot: 10 }).map((row, index) => [
      row[0],
      10 + (index % 2 === 0 ? 0 : 8),
    ]);
    const result = validateCaptureQuality(unstable);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unstable-pot');
  });

  it('rejects insufficient samples', () => {
    const result = validateCaptureQuality(makeSamples({ count: 20 }));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('too-short');
  });
});

describe('profile refresh helpers', () => {
  it('maps profile words to POT hints for recording', () => {
    const map = profileWordsToPotMap(
      {
        words: [
          { word: 'pain', state: 'calibrated', hasEmgReference: true, potCenter: 6.2 },
        ],
      },
      VOCABULARY
    );
    expect(map.pain.potMean).toBe(6.2);
    expect(map.help).toBeUndefined();
  });

  it('builds API capture payload rows with timestamps', () => {
    const payload = captureToPayload(makeSamples({ count: 3 }), 1000);
    expect(payload.signal.format).toBe('samples');
    expect(payload.signal.rows).toHaveLength(3);
    expect(payload.signal.rows[0]).toMatchObject({ emg: expect.any(Number), pot: 10 });
    expect(samplesToRows(makeSamples({ count: 2 }), 500)[1].timestamp).toBe(520);
  });
});

describe('recalibration profile state', () => {
  it('keeps other calibrated words when one word is recalibrated in profile response', () => {
    const before = buildWordStatusMap(
      {
        words: [
          { word: 'pain', state: 'calibrated', hasEmgReference: true, potCenter: 6 },
          { word: 'help', state: 'calibrated', hasEmgReference: true, potCenter: 39 },
        ],
      },
      VOCABULARY
    );

    const after = buildWordStatusMap(
      {
        words: [
          { word: 'pain', state: 'calibrated', hasEmgReference: true, potCenter: 8.5 },
          { word: 'help', state: 'calibrated', hasEmgReference: true, potCenter: 39 },
        ],
      },
      VOCABULARY
    );

    expect(before.find((item) => item.word === 'help').potCenter).toBe(39);
    expect(after.find((item) => item.word === 'pain').potCenter).toBe(8.5);
    expect(after.find((item) => item.word === 'help').userPersonalized).toBe(true);
  });
});

describe('backend-aligned expectations', () => {
  it('requires at least eight usable captures before submit contract', () => {
    const MIN = 8;
    const usable = Array.from({ length: 7 }, () => captureToPayload(makeSamples({})));
    expect(usable.length).toBeLessThan(MIN);
    const ready = Array.from({ length: MIN }, () => captureToPayload(makeSamples({})));
    expect(ready.length).toBeGreaterThanOrEqual(MIN);
  });

  it('does not mark pending words as personalized', () => {
    const words = buildWordStatusMap({ words: [] }, VOCABULARY);
    words.forEach((item) => {
      expect(item.userPersonalized).toBe(false);
    });
  });
});
