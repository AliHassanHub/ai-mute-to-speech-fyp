import {
  DEFAULT_POT_BY_WORD,
  EMG_BASELINE_ADC,
  EMG_ADC_MAX,
  POT_MAX,
} from '../constants/emgConfig';

const EMG_LINE_RE =
  /\bEMG\s*:\s*(-?\d+(?:\.\d+)?)\b.*\bPOT\s*:\s*(-?\d+(?:\.\d+)?)\b/i;

export function parseEmgLine(line) {
  if (!line || typeof line !== 'string') return null;

  const trimmed = line.trim();
  if (!trimmed) return null;

  const espMatch = trimmed.match(EMG_LINE_RE);
  if (espMatch) {
    return [clampEmg(Number(espMatch[1])), clampPot(Number(espMatch[2]))];
  }

  if (trimmed.includes(';')) {
    const [emgRaw, potRaw] = trimmed.split(';');
    const emg = Number(emgRaw);
    const pot = Number(potRaw);
    if (Number.isFinite(emg) && Number.isFinite(pot)) {
      return [clampEmg(emg), clampPot(pot)];
    }
  }

  return null;
}

export function clampEmg(value) {
  if (!Number.isFinite(value)) return EMG_BASELINE_ADC;
  return Math.max(0, Math.min(EMG_ADC_MAX, Math.round(value)));
}

export function clampPot(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(POT_MAX, Math.round(value)));
}

export function computeSignalStats(samples) {
  if (!samples?.length) {
    return { emgMean: 0, emgStd: 0, potMean: 0, potStd: 0, count: 0 };
  }

  const emgValues = samples.map((row) => row[0]);
  const potValues = samples.map((row) => row[1]);
  const emgMean = emgValues.reduce((sum, v) => sum + v, 0) / emgValues.length;
  const potMean = potValues.reduce((sum, v) => sum + v, 0) / potValues.length;
  const emgVariance =
    emgValues.reduce((sum, v) => sum + (v - emgMean) ** 2, 0) / emgValues.length;
  const potVariance =
    potValues.reduce((sum, v) => sum + (v - potMean) ** 2, 0) / potValues.length;

  return {
    emgMean,
    emgStd: Math.sqrt(emgVariance),
    potMean,
    potStd: Math.sqrt(potVariance),
    count: samples.length,
  };
}

export function nearestWordForPot(potValue, wordProfiles = {}) {
  let bestWord = null;
  let bestDistance = Infinity;

  Object.entries(wordProfiles).forEach(([word, profile]) => {
    const potMean = profile?.potMean ?? DEFAULT_POT_BY_WORD[word];
    const distance = Math.abs(potValue - potMean);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestWord = word;
    }
  });

  return bestWord;
}

const WORD_PEAKS = {
  help: 1350,
  no: 1180,
  pain: 2100,
  stop: 980,
};

export function generateBurstEmg(frameIndex, totalFrames, baseline, peak) {
  const burstCenters = [0.18, 0.48, 0.78].map((ratio) =>
    Math.floor(totalFrames * ratio)
  );
  let value = baseline + (Math.random() - 0.5) * 6;

  burstCenters.forEach((center, burstIndex) => {
    const width = Math.max(18, Math.floor(totalFrames * 0.08));
    const distance = Math.abs(frameIndex - center);
    if (distance <= width) {
      const shape = 1 - distance / width;
      const burstPeak = peak * (0.85 + burstIndex * 0.05);
      value = Math.max(value, baseline + shape * (burstPeak - baseline));
    }
  });

  return clampEmg(value);
}

export function generateSimulatedSample({
  frameIndex,
  totalFrames,
  potValue,
  baseline = EMG_BASELINE_ADC,
  word = null,
}) {
  const peak = WORD_PEAKS[word] ?? 1200;
  const emg = generateBurstEmg(frameIndex, totalFrames, baseline, peak);
  const pot = clampPot(potValue + (Math.random() - 0.5) * 0.4);
  return [emg, pot];
}

export function buildCalibrationPayload({
  neutralSamples,
  wordProfiles,
  samplingRate,
}) {
  const neutralStats = computeSignalStats(neutralSamples);
  const baselineValue = Number(neutralStats.emgMean.toFixed(5));
  const thresholdLevel = Number(
    Math.max(neutralStats.emgStd * 3, 12).toFixed(5)
  );

  return {
    baselineValue,
    thresholdLevel,
    calibrationData: JSON.stringify({
      version: 1,
      samplingRate,
      words: Object.keys(wordProfiles),
      neutral: {
        ...neutralStats,
        sampleCount: neutralSamples.length,
      },
      wordProfiles,
      createdAt: new Date().toISOString(),
    }),
  };
}
