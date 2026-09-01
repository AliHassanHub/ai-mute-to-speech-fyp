/**
 * POST /api/inference/word client contract.
 * Mocks fetch — does not require Bluetooth or a live server.
 */

jest.mock('../services/apiConfig', () => ({
  getApiBaseUrl: jest.fn(async () => 'http://127.0.0.1:5000/api'),
  getApiBaseUrlSync: jest.fn(() => 'http://127.0.0.1:5000/api'),
  getBuiltInServerUrl: jest.fn(() => 'http://127.0.0.1:5000/api'),
  setApiBaseUrl: jest.fn(),
  initApiConfig: jest.fn(),
}));

import { ApiError, inferenceApi } from '../services/api';
import { isBufferingResponse } from '../utils/aiPrediction';
import { ALLOW_EMG_SIMULATION } from '../constants/emgConfig';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const rows = Array.from({ length: 768 }, (_, i) => ({
  emg: 900 + i,
  pot: 39,
  timestamp: 1_700_000_000_000 + i,
}));

describe('simulation protection', () => {
  it('keeps ALLOW_EMG_SIMULATION off in the test runtime', () => {
    expect(ALLOW_EMG_SIMULATION).toBe(false);
  });
});

describe('inferenceApi.predictWord', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('posts the authenticated sample-window body without a userId', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        prediction: { label: 'help', confidence: 0.9, accepted: true },
        meta: { samplesUsed: 768 },
      })
    );

    await inferenceApi.predictWord(rows, {}, 'test-token');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:5000/api/inference/word');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');

    const body = JSON.parse(options.body);
    expect(body.userId).toBeUndefined();
    expect(body.signal.format).toBe('samples');
    expect(body.signal.rows).toHaveLength(768);
    expect(body.signal.rows[0]).toEqual({
      emg: 900,
      pot: 39,
      timestamp: 1_700_000_000_000,
    });
  });

  it('returns a successful prediction payload', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        prediction: { label: 'stop', confidence: 0.8, accepted: true, bestLabel: 'stop' },
        meta: { processingTimeMs: 42, samplesUsed: 768, persisted: false },
      })
    );

    const data = await inferenceApi.predictWord(rows, {}, 'token');
    expect(data.success).toBe(true);
    expect(data.prediction.label).toBe('stop');
    expect(data.prediction.accepted).toBe(true);
    expect(isBufferingResponse(data)).toBe(false);
  });

  it('returns a rejected prediction without throwing', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        prediction: { label: 'unknown', bestLabel: 'no', confidence: 0.3, accepted: false },
        meta: { samplesUsed: 768 },
      })
    );

    const data = await inferenceApi.predictWord(rows, {}, 'token');
    expect(data.prediction.accepted).toBe(false);
    expect(data.prediction.label).toBe('unknown');
  });

  it('returns a buffering payload without throwing', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        ready: false,
        requiredSamples: 768,
        receivedSamples: 100,
      })
    );

    const data = await inferenceApi.predictWord(rows.slice(0, 100), {}, 'token');
    expect(isBufferingResponse(data)).toBe(true);
    expect(data.requiredSamples).toBe(768);
    expect(data.receivedSamples).toBe(100);
  });

  it('throws ApiError on HTTP 503 AI unavailable', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse(
        { success: false, message: 'AI service unavailable', code: 'AI_SERVICE_UNAVAILABLE' },
        503
      )
    );

    await expect(inferenceApi.predictWord(rows, {}, 'token')).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'AI_SERVICE_UNAVAILABLE',
    });
  });

  it('throws ApiError on HTTP 400', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({ success: false, message: 'Invalid signal', code: 'AI_WINDOW_TOO_SMALL' }, 400)
    );

    await expect(inferenceApi.predictWord(rows.slice(0, 10), {}, 'token')).rejects.toBeInstanceOf(
      ApiError
    );
  });

  it('throws ApiError when the backend is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(inferenceApi.predictWord(rows, {}, 'token')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
    });
  });
});

describe('inferenceApi.persistWord', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('posts the authenticated persist body without a userId', async () => {
    global.fetch.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        persisted: true,
        textId: 12,
        recordingId: 11,
        processedId: 10,
        sessionId: 9,
        message: 'Result saved successfully.',
        result: { recognizedText: 'Pain', confidenceScore: 84 },
      })
    );

    await inferenceApi.persistWord(rows, { durationMs: 15360 }, 'test-token');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:5000/api/inference/word/persist');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');

    const body = JSON.parse(options.body);
    expect(body.userId).toBeUndefined();
    expect(body.signal.rows).toHaveLength(768);
    expect(body.durationMs).toBe(15360);
  });
});
