/**
 * Configuration for the Python calibrated-word inference service.
 *
 * Nothing here is hardcoded to localhost in service code: AI_SERVICE_URL is the
 * single source of the base URL, and every value below is env-overridable.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:8077";

/**
 * Minimum inference window, verified against the Python predictor.
 *
 * The predictor's own hard gate is 50 samples, but measured agreement with
 * ground truth is only 41.5% there and 87.8% at 384. 768 is the smallest window
 * that fully reproduces the verified result, so the backend refuses to call
 * Python below it.
 */
const DEFAULT_MIN_WINDOW_SAMPLES = 768;

/** The predictor rejects anything above this as a stale buffer. */
const DEFAULT_MAX_WINDOW_SAMPLES = 1800;

function readInt(name, fallback) {
    const raw = process.env[name];
    if (raw == null || raw === "") {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value) {
    const raw = String(value || DEFAULT_BASE_URL).trim();
    return raw.replace(/\/+$/, "");
}

const aiServiceConfig = {
    baseUrl: normalizeBaseUrl(process.env.AI_SERVICE_URL),

    // Prediction payloads are large (768-1800 rows), so the predict timeout is
    // deliberately more generous than the health timeout.
    healthTimeoutMs: readInt("AI_SERVICE_HEALTH_TIMEOUT_MS", 3000),
    predictTimeoutMs: readInt("AI_SERVICE_PREDICT_TIMEOUT_MS", 15000),
    sessionTimeoutMs: readInt("AI_SERVICE_SESSION_TIMEOUT_MS", 10000),

    minWindowSamples: readInt("AI_MIN_WINDOW_SAMPLES", DEFAULT_MIN_WINDOW_SAMPLES),
    maxWindowSamples: readInt("AI_MAX_WINDOW_SAMPLES", DEFAULT_MAX_WINDOW_SAMPLES),

    // Neutral baseline requirement for session adaptation, matching the Python
    // service (which mirrors runtime/live_predict.py).
    minSessionBaselineSamples: readInt("AI_MIN_SESSION_BASELINE_SAMPLES", 80),

    paths: {
        health: "/health",
        predict: "/predict",
        session: "/session",
        wordReference: "/calibration/word-reference",
    },

    minCalibrationCaptures: readInt("AI_MIN_CALIBRATION_CAPTURES", 8),
    maxCalibrationCaptures: readInt("AI_MAX_CALIBRATION_CAPTURES", 16),
    minCalibrationSamples: readInt("AI_MIN_CALIBRATION_SAMPLES", 100),
    calibrationTimeoutMs: readInt("AI_SERVICE_CALIBRATION_TIMEOUT_MS", 30000),
};

module.exports = aiServiceConfig;
