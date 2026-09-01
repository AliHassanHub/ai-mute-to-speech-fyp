/**
 * Word-prediction response shaping. No Bluetooth, no network.
 */

import {
  buildBestGuessHint,
  buildRecognizedText,
  buildResultViewModel,
  describeInferenceError,
  isBufferingResponse,
  normalizeWordPrediction,
  mergePersistedWordResult,
} from '../utils/aiPrediction';

const acceptedResponse = {
  success: true,
  prediction: {
    label: 'help',
    bestLabel: 'help',
    confidence: 0.87,
    accepted: true,
    distance: 12.4,
    margin: 9.0,
  },
  meta: {
    processingTimeMs: 37,
    samplesUsed: 768,
    quality: 'ok',
    sessionAdaptation: 'none',
    confidenceBasis: 'Heuristic score from the calibrated model, not a probability.',
    modelVersion: 'calibrated_word_model.npz',
    persisted: false,
  },
};

const rejectedResponse = {
  success: true,
  prediction: {
    label: 'unknown',
    bestLabel: 'no',
    confidence: 0.41,
    accepted: false,
    distance: 40,
    margin: 12,
  },
  meta: {
    processingTimeMs: 40,
    samplesUsed: 768,
    sessionAdaptation: 'none',
    persisted: false,
  },
};

describe('isBufferingResponse', () => {
  it('treats ready:false as buffering, not an error', () => {
    expect(
      isBufferingResponse({
        success: true,
        ready: false,
        requiredSamples: 768,
        receivedSamples: 100,
      })
    ).toBe(true);
  });

  it('does not treat a completed prediction as buffering', () => {
    expect(isBufferingResponse(acceptedResponse)).toBe(false);
  });
});

describe('normalizeWordPrediction', () => {
  it('maps a successful accepted prediction for ResultScreen', () => {
    const result = normalizeWordPrediction(acceptedResponse);

    expect(result.source).toBe('ai-window');
    expect(result.recognizedText).toBe('Help');
    expect(result.accepted).toBe(true);
    expect(result.prediction.label).toBe('help');
    expect(result.prediction.confidence).toBe(0.87);
    expect(result.confidenceIsHeuristic).toBe(true);
    expect(result.bestGuessHint).toBeNull();
    expect(result.samplesUsed).toBe(768);
    expect(result.sessionAdaptation).toBe('none');
    expect(result.persisted).toBe(false);
  });

  it('does not promote a rejected label into confirmed recognition', () => {
    const result = normalizeWordPrediction(rejectedResponse);

    expect(result.accepted).toBe(false);
    expect(result.recognizedText).toBe('Uncertain prediction');
    expect(result.prediction.label).toBe('unknown');
    expect(result.bestGuessHint).toBe('No');
  });

  it('does not invent a replacement word', () => {
    const result = normalizeWordPrediction({
      prediction: { label: 'unknown', bestLabel: 'unknown', accepted: false, confidence: 0.1 },
    });
    expect(result.recognizedText).toBe('Uncertain prediction');
    expect(result.bestGuessHint).toBeNull();
  });
});

describe('buildRecognizedText / buildBestGuessHint', () => {
  it('returns the accepted label', () => {
    expect(buildRecognizedText({ label: 'stop', accepted: true })).toBe('Stop');
  });

  it('returns Uncertain prediction when not accepted', () => {
    expect(buildRecognizedText({ label: 'help', accepted: false, bestLabel: 'help' })).toBe(
      'Uncertain prediction'
    );
  });

  it('exposes the closest label only as a hint when rejected', () => {
    expect(buildBestGuessHint({ accepted: false, bestLabel: 'pain' })).toBe('Pain');
    expect(buildBestGuessHint({ accepted: true, bestLabel: 'pain' })).toBeNull();
  });
});

describe('mergePersistedWordResult', () => {
  it('marks an AI window result as persisted with history identifiers', () => {
    const base = normalizeWordPrediction(acceptedResponse);
    const merged = mergePersistedWordResult(base, {
      persisted: true,
      textId: 55,
      recordingId: 44,
      processedId: 33,
      sessionId: 22,
      prediction: { label: 'pain', accepted: true, confidence: 0.84, bestLabel: 'pain' },
      result: {
        recognizedText: 'Pain',
        translatedText: 'Pain',
        confidenceScore: 84,
        processingTimeMs: 23,
      },
    });

    expect(merged.persisted).toBe(true);
    expect(merged.textId).toBe(55);
    expect(merged.recordingId).toBe(44);
    expect(merged.processedId).toBe(33);
    expect(merged.sessionId).toBe(22);
    expect(merged.recognizedText).toBe('Pain');
    expect(merged.confidenceScore).toBe(84);
  });
});

describe('buildResultViewModel', () => {
  it('navigates ResultScreen state for an accepted AI prediction', () => {
    const view = buildResultViewModel(normalizeWordPrediction(acceptedResponse));

    expect(view.predictedLabel).toBe('Help');
    expect(view.recognizedText).toBe('Help');
    expect(view.statusText).toBe('Accepted');
    expect(view.confidenceLabel).toBe('0.87');
    expect(view.confidenceCaption).toMatch(/not a probability/i);
    expect(view.confidenceLabel).not.toMatch(/%/);
    expect(view.isAiWindowResult).toBe(true);
    expect(view.accepted).toBe(true);
  });

  it('shows Uncertain prediction when accepted is false', () => {
    const view = buildResultViewModel(normalizeWordPrediction(rejectedResponse));

    expect(view.accepted).toBe(false);
    expect(view.predictedLabel).toBe('Uncertain prediction');
    expect(view.statusText).toBe('Low confidence / Not accepted');
    expect(view.bestGuessHint).toBe('No');
    expect(view.confidenceLabel).toBe('0.41');
  });

  it('does not treat buffering-shaped leftovers as a confirmed result', () => {
    const view = buildResultViewModel({});
    expect(view.accepted).toBe(false);
    expect(view.predictedLabel).toBe('Could not recognize speech');
  });
});

describe('describeInferenceError', () => {
  it('maps a backend connection failure', () => {
    expect(
      describeInferenceError({ status: 0, message: 'Cannot connect to http://x' })
    ).toMatch(/Backend unavailable/);
  });

  it('maps AI service unavailable', () => {
    expect(
      describeInferenceError({
        status: 503,
        code: 'AI_SERVICE_UNAVAILABLE',
        message: 'down',
      })
    ).toMatch(/AI service unavailable/);
  });

  it('maps HTTP 4xx without calling it a success', () => {
    expect(describeInferenceError({ status: 400, message: 'Window too small' })).toBe(
      'Window too small'
    );
  });

  it('maps HTTP 5xx', () => {
    expect(describeInferenceError({ status: 500, message: 'Internal error' })).toBe(
      'Internal error'
    );
  });
});
