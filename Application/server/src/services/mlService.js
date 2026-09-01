/**
 * Model access layer.
 *
 * This is the integration point the project already reserved for the AI model
 * ("Plug the new model into mlService.predictSignal()"). It now delegates to the
 * Python calibrated-word service through aiService.
 *
 * No model logic lives here. Feature extraction, POT gating, distance scoring,
 * confidence and acceptance are all computed by the Python runtime.
 */

const aiService = require("./aiService");
const aiServiceConfig = require("../config/aiService");
const { AppError } = require("../utils/AppError");

function scaleEmg(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    if (numeric >= 0 && numeric <= 1.5) {
        return numeric * 4095;
    }
    return numeric;
}

function scalePot(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    if (numeric >= 0 && numeric <= 1.5) {
        return numeric * 100;
    }
    return numeric;
}

function normalizeSignalForModel(rawSignalData) {
    if (!Array.isArray(rawSignalData) || rawSignalData.length === 0) {
        throw {
            status: 400,
            message: "Recording has no signal data to predict.",
        };
    }

    if (Array.isArray(rawSignalData[0])) {
        return rawSignalData.map((row) => [
            scaleEmg(row[0]),
            scalePot(row[1] ?? 0),
        ]);
    }

    if (rawSignalData[0] && typeof rawSignalData[0] === "object") {
        return rawSignalData.map((row) => [
            scaleEmg(row.emg),
            scalePot(row.pot ?? 0),
        ]);
    }

    // Single-column legacy data: EMG only, no POT. The calibrated predictor
    // needs POT to select a label, so this cannot produce a valid prediction.
    throw {
        status: 400,
        message:
            "Recording signal has no POT channel. The calibrated model requires both EMG and POT.",
    };
}

/**
 * Convert normalized [emg, pot] pairs into the AI service's row format.
 */
function toAiRows(normalizedSignal) {
    return normalizedSignal.map(([emg, pot]) => ({
        emg: Number(emg),
        pot: Number(pot),
    }));
}

/**
 * Guard the verified inference window before spending a network call.
 */
function assertWindowSize(sampleCount) {
    if (sampleCount < aiServiceConfig.minWindowSamples) {
        throw new AppError(
            `A calibrated prediction needs at least ${aiServiceConfig.minWindowSamples} samples; received ${sampleCount}.`,
            400,
            "AI_WINDOW_TOO_SMALL"
        );
    }

    if (sampleCount > aiServiceConfig.maxWindowSamples) {
        throw new AppError(
            `The AI model rejects windows above ${aiServiceConfig.maxWindowSamples} samples; received ${sampleCount}.`,
            400,
            "AI_WINDOW_TOO_LARGE"
        );
    }
}

/**
 * Model version cache.
 *
 * The version is the artefact's own identity (name + SHA-256 prefix) reported by
 * the AI service, so it is never invented here. Cached briefly to keep a health
 * round trip off the prediction path.
 */
const MODEL_VERSION_TTL_MS = 60000;
let cachedModelVersion = null;
let cachedModelVersionAt = 0;

async function resolveModelVersion() {
    const now = Date.now();
    if (cachedModelVersion && now - cachedModelVersionAt < MODEL_VERSION_TTL_MS) {
        return cachedModelVersion;
    }

    try {
        const health = await aiService.checkHealth();
        cachedModelVersion = health.model_sha256
            ? `${health.model}@${String(health.model_sha256).slice(0, 12)}`
            : health.model || null;
        cachedModelVersionAt = now;
    } catch {
        // A missing version must never fail a prediction that already succeeded.
        cachedModelVersion = null;
    }

    return cachedModelVersion;
}

function resetModelVersionCache() {
    cachedModelVersion = null;
    cachedModelVersionAt = 0;
}

/**
 * Live model status, read from the AI service rather than hardcoded.
 * Never throws: an unreachable AI service is reported as not ready.
 */
const getModelStatus = async () => {
    try {
        const health = await aiService.checkHealth();
        return {
            ready: true,
            modelExists: true,
            modelVersion: health.model_sha256
                ? `${health.model}@${String(health.model_sha256).slice(0, 12)}`
                : health.model || null,
            labels: Array.isArray(health.labels) ? health.labels : [],
            requiredSamples: aiServiceConfig.minWindowSamples,
            message: "Calibrated word model is loaded.",
        };
    } catch (error) {
        return {
            ready: false,
            modelExists: false,
            modelVersion: null,
            labels: [],
            requiredSamples: aiServiceConfig.minWindowSamples,
            message: error.message || "AI service unavailable",
        };
    }
};

/**
 * Predict a word from raw stored signal data.
 *
 * Returns the shape inferenceService already expects:
 *   { prediction, normalizedSignal, modelStatus }
 *
 * `prediction.best_label` keeps snake_case because buildRecognizedText() in
 * inferenceService reads that field.
 */
const predictSignal = async (rawSignalData, minConfidence, options = {}) => {
    const normalizedSignal = normalizeSignalForModel(rawSignalData);
    assertWindowSize(normalizedSignal.length);

    const result = await aiService.predictWord(toAiRows(normalizedSignal), {
        minConfidence: Number.isFinite(Number(minConfidence))
            ? Number(minConfidence)
            : null,
        sessionId: options.sessionId || null,
        userCalibration: options.userCalibration || null,
    });

    const prediction = {
        label: result.label,
        best_label: result.bestLabel,
        confidence: result.confidence,
        accepted: result.accepted,
        distance: result.distance,
        margin: result.margin,
        kind: result.kind || "word",
        // Carried through verbatim so nothing downstream re-interprets them.
        confidenceBasis: result.confidenceBasis,
        marginUnit: result.marginUnit,
        sessionAdaptation: result.sessionAdaptation,
        quality: result.quality,
        requiredConfidence: result.requiredConfidence,
        aiProcessingTimeMs: result.processingTimeMs,
        aiRoundTripMs: result.roundTripMs,
    };

    return {
        prediction,
        normalizedSignal,
        modelStatus: {
            modelVersion: options.modelVersion || (await resolveModelVersion()),
            message: "Calibrated word model (Python AI service).",
        },
    };
};

module.exports = {
    getModelStatus,
    predictSignal,
    normalizeSignalForModel,
    toAiRows,
    assertWindowSize,
    resolveModelVersion,
    resetModelVersionCache,
};
