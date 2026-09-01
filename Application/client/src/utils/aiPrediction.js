/**
 * Shaping the backend's word-prediction response for the UI.
 *
 * Two rules drive everything here:
 *
 *  1. `confidence` from the calibrated predictor is a weighted heuristic score
 *     capped at 0.98 — 48% of it comes from the potentiometer. It is NOT a
 *     probability and not a cosine similarity. Nothing in this file may present
 *     it as one.
 *  2. When `accepted` is false the closest label must not be promoted into a
 *     confirmed recognition, and no replacement word may be invented.
 */

import { enrichResultWithPhrases } from './phraseResult';
import { buildPhraseBundleForWord } from '../services/phraseService';
import { normalizeSessionResult } from './sessionResult';

export const CONFIDENCE_BASIS_FALLBACK =
  'Heuristic score from the calibrated model, not a probability.';

export function capitalizeWord(text) {
  const value = String(text ?? '').trim();
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** True when the predictor rejected the signal on quality grounds. */
export function isQualityRejection(bestLabel) {
  return String(bestLabel ?? '').startsWith('low-quality-signal:');
}

export function describeQualityRejection(bestLabel) {
  const reason = String(bestLabel ?? '').replace('low-quality-signal:', '');
  if (reason.startsWith('flat-emg')) {
    return 'No muscle activity detected. Check electrode contact and try again.';
  }
  if (reason.startsWith('unstable-pot')) {
    return 'The potentiometer moved during recording. Hold it steady on one word.';
  }
  if (reason.startsWith('too-short')) {
    return 'The signal window was too short.';
  }
  if (reason.startsWith('stale-buffer-suspected')) {
    return 'The signal window was too long. Record a single word.';
  }
  return `Signal quality too low (${reason}).`;
}

/**
 * Build the user-facing recognition text.
 *
 * Never returns a confirmed word unless the predictor accepted it.
 */
export function buildRecognizedText(prediction = {}) {
  const { label, bestLabel, accepted } = prediction;

  if (isQualityRejection(bestLabel)) {
    return describeQualityRejection(bestLabel);
  }

  if (accepted && label && label !== 'unknown') {
    return capitalizeWord(label);
  }

  return 'Uncertain prediction';
}

/**
 * The closest label, exposed only as a hint and only when it is a real word.
 * Returns null when there is nothing legitimate to show.
 */
export function buildBestGuessHint(prediction = {}) {
  const { bestLabel, accepted } = prediction;

  if (accepted) return null;
  if (!bestLabel || bestLabel === 'unknown') return null;
  if (isQualityRejection(bestLabel)) return null;
  if (String(bestLabel).includes('disabled')) return null;

  return capitalizeWord(bestLabel);
}

/**
 * Normalise POST /api/inference/word into the shape ResultScreen consumes.
 *
 * Mirrors the field names produced by normalizeSessionResult so the screen can
 * render either source, while adding the AI-specific metadata.
 */
export function normalizeWordPrediction(response = {}) {
  const prediction = response.prediction ?? {};
  const meta = response.meta ?? {};

  const accepted = prediction.accepted === true;
  const confidence = Number(prediction.confidence ?? 0);
  const recognizedText = buildRecognizedText(prediction);

  return {
    source: 'ai-window',

    // Shared with the recording-based result shape.
    recognizedText,
    // Translation is out of scope for this phase, so the AI path does not
    // translate. The field is present for shape compatibility only.
    translatedText: recognizedText,
    targetLanguage: 'English',
    confidenceScore: Number((confidence * 100).toFixed(2)),
    accepted,
    prediction: {
      label: prediction.label ?? 'unknown',
      bestLabel: prediction.bestLabel ?? null,
      confidence,
      accepted,
      distance: prediction.distance ?? null,
      margin: prediction.margin ?? null,
    },
    processingTimeMs: meta.processingTimeMs ?? null,

    // AI-specific, surfaced so the UI can be honest about what it is showing.
    bestGuessHint: buildBestGuessHint(prediction),
    confidenceIsHeuristic: true,
    confidenceBasis: meta.confidenceBasis ?? CONFIDENCE_BASIS_FALLBACK,
    marginUnit: meta.marginUnit ?? null,
    samplesUsed: meta.samplesUsed ?? null,
    sessionAdaptation: meta.sessionAdaptation ?? 'none',
    quality: meta.quality ?? null,
    modelVersion: meta.modelVersion ?? null,
    persisted: meta.persisted === true,

    // Not saved to history: the backend cannot persist a stateless window.
    textId: null,
    processedId: null,
    recordingId: null,
  };
}

export function mergePersistedWordResult(result = {}, persistResponse = {}) {
  if (!persistResponse?.persisted) {
    return result;
  }

  const persistedResult = normalizeSessionResult({
    ...persistResponse.result,
    prediction: persistResponse.prediction ?? result.prediction,
  });

  return {
    ...result,
    ...persistedResult,
    source: result.source ?? 'ai-window',
    persisted: true,
    textId: persistResponse.textId ?? persistedResult.textId,
    recordingId: persistResponse.recordingId ?? persistedResult.recordingId,
    processedId: persistResponse.processedId ?? persistedResult.processedId,
    sessionId: persistResponse.sessionId ?? persistedResult.sessionId,
    prediction: persistResponse.prediction ?? result.prediction ?? null,
    englishPhrase: result.englishPhrase ?? persistedResult.englishPhrase ?? null,
    translatedPhrase: persistedResult.translatedText ?? result.translatedPhrase ?? null,
    phraseTranslations: result.phraseTranslations ?? persistedResult.phraseTranslations ?? null,
    phraseAvailable: result.phraseAvailable ?? true,
    samplesUsed: result.samplesUsed ?? null,
    quality: result.quality ?? null,
    sessionAdaptation: result.sessionAdaptation ?? 'none',
    processingTimeMs:
      persistedResult.processingTimeMs ?? result.processingTimeMs ?? null,
    confidenceIsHeuristic: result.confidenceIsHeuristic === true,
    confidenceBasis: result.confidenceBasis ?? CONFIDENCE_BASIS_FALLBACK,
  };
}

/**
 * `{ ready: false, requiredSamples, receivedSamples }` is expected, not an error.
 */
export function isBufferingResponse(response = {}) {
  return response.ready === false;
}

function formatLabel(label) {
  if (!label || label === 'unknown') return 'Unknown';
  if (String(label).startsWith('low-quality-signal:')) {
    return String(label).replace('low-quality-signal:', 'Quality issue: ');
  }
  return capitalizeWord(label);
}

/**
 * View-model for ResultScreen so rejected predictions never look confirmed
 * and heuristic confidence is never presented as a probability.
 */
export function buildResultViewModel(result = {}, translationLanguage = null) {
  const prediction = result.prediction ?? {};
  const accepted = result.accepted === true || prediction.accepted === true;
  const heuristic = result.confidenceIsHeuristic === true;
  const rawConfidence = Number(prediction.confidence);
  const recognizedText = result.recognizedText || 'Could not recognize speech';

  const phraseBundle = buildPhraseBundleForWord(
    recognizedText,
    translationLanguage ?? result.translationLanguage ?? result.targetLanguage ?? 'English'
  );

  const enriched = enrichResultWithPhrases(
    {
      ...result,
      recognizedText,
      translatedText: result.translatedText ?? phraseBundle.translatedPhrase,
    },
    translationLanguage ?? result.translationLanguage ?? result.targetLanguage
  );

  return {
    recognizedText: enriched.recognizedText,
    translatedText: enriched.translatedText,
    englishPhrase: enriched.englishPhrase,
    translatedPhrase: enriched.translatedPhrase,
    phraseTranslations: enriched.phraseTranslations ?? phraseBundle.phraseTranslations ?? null,
    phraseAvailable: enriched.phraseAvailable,
    targetLanguage: result.targetLanguage ?? 'English',
    translationLanguage: enriched.translationLanguage ?? result.targetLanguage ?? 'English',
    speechLanguage: result.speechLanguage ?? null,
    predictedLabel: accepted ? formatLabel(prediction.label) : recognizedText || 'Uncertain prediction',
    accepted,
    statusText: accepted ? 'Accepted' : 'Low confidence / Not accepted',
    confidenceLabel: heuristic
      ? Number.isFinite(rawConfidence)
        ? rawConfidence.toFixed(2)
        : '—'
      : `${Number(result.confidenceScore ?? 0).toFixed(2)}%`,
    confidenceCaption: heuristic
      ? result.confidenceBasis || CONFIDENCE_BASIS_FALLBACK
      : null,
    bestGuessHint: accepted ? null : result.bestGuessHint ?? null,
    isAiWindowResult: result.source === 'ai-window',
    samplesUsed: result.samplesUsed ?? null,
    quality: result.quality ?? null,
    sessionAdaptation: result.sessionAdaptation ?? 'none',
    processingTimeMs: result.processingTimeMs ?? null,
    persisted: result.persisted === true,
    confidenceScore: Number(result.confidenceScore ?? 0),
  };
}

/**
 * Map Node/Python failures into a short, non-technical message.
 * Buffering is not handled here — callers must check isBufferingResponse first.
 */
export function describeInferenceError(error) {
  const status = error?.status;
  const code = error?.code;
  const message = String(error?.message ?? '');

  if (status === 0 || /cannot connect/i.test(message)) {
    return 'Backend unavailable. Check that the Node.js server is running.';
  }
  if (code === 'AI_SERVICE_UNAVAILABLE' || status === 503) {
    return 'AI service unavailable. The prediction service is not reachable.';
  }
  if (code === 'AI_TIMEOUT' || status === 504) {
    return 'The AI service timed out. Record the word again.';
  }
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return message || 'The prediction request was rejected.';
  }
  if (typeof status === 'number' && status >= 500) {
    return message || 'The server could not complete the prediction.';
  }
  return message || 'Prediction failed. Please try again.';
}
