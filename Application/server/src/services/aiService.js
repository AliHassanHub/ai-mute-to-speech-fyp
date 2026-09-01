/**
 * HTTP client for the Python calibrated-word inference service.
 *
 * This is the only module that talks to the AI service. It owns transport,
 * timeouts and the mapping from Python status codes to application errors.
 *
 * It contains no model logic: features, scoring, thresholds and acceptance all
 * live in the Python runtime (runtime/robust_word_model.py).
 */

const aiServiceConfig = require("../config/aiService");
const { AppError } = require("../utils/AppError");
const { toPythonSamples } = require("./pythonSignal");

const AI_ERROR_CODES = {
    UNAVAILABLE: "AI_SERVICE_UNAVAILABLE",
    TIMEOUT: "AI_SERVICE_TIMEOUT",
    MODEL_UNAVAILABLE: "AI_MODEL_UNAVAILABLE",
    VALIDATION_REJECTED: "AI_VALIDATION_REJECTED",
    SENTENCE_UNSUPPORTED: "AI_SENTENCE_UNSUPPORTED",
    INFERENCE_FAILED: "AI_INFERENCE_FAILED",
    CALIBRATION_REFERENCE_NOT_FOUND: "AI_CALIBRATION_REFERENCE_NOT_FOUND",
    BAD_RESPONSE: "AI_BAD_RESPONSE",
};

const isDevelopment = () => process.env.NODE_ENV !== "production";

function aiLog(...args) {
    if (isDevelopment()) {
        console.log("[AI]", ...args);
    }
}

function buildUrl(path) {
    return `${aiServiceConfig.baseUrl}${path}`;
}

/**
 * Perform a JSON request against the AI service with an explicit timeout.
 *
 * Returns { status, body } for any HTTP response, including 4xx/5xx. Only
 * transport-level problems throw, so callers can map status codes themselves.
 */
async function requestJson(path, { method = "GET", body = null, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
        const response = await fetch(buildUrl(path), {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });

        const text = await response.text();
        let parsed = null;

        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                throw new AppError(
                    "AI service returned a malformed response.",
                    502,
                    AI_ERROR_CODES.BAD_RESPONSE
                );
            }
        }

        return {
            status: response.status,
            body: parsed,
            roundTripMs: Date.now() - startedAt,
        };
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }

        if (error.name === "AbortError") {
            throw new AppError(
                "AI service timed out.",
                504,
                AI_ERROR_CODES.TIMEOUT
            );
        }

        // ECONNREFUSED, ENOTFOUND, socket hang up, etc.
        throw new AppError(
            "AI service unavailable",
            503,
            AI_ERROR_CODES.UNAVAILABLE
        );
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Translate an AI-service response status into an application error.
 * Each Python failure mode maps to a distinct code so the caller can react.
 */
function mapErrorResponse(status, body) {
    const detail = body && (body.detail || body.message);

    if (status === 422) {
        return new AppError(
            "The signal was rejected by the AI service.",
            422,
            AI_ERROR_CODES.VALIDATION_REJECTED
        );
    }

    if (status === 501) {
        return new AppError(
            "Sentence prediction is not supported.",
            501,
            AI_ERROR_CODES.SENTENCE_UNSUPPORTED
        );
    }

    if (status === 503) {
        return new AppError(
            "AI model is not available.",
            503,
            AI_ERROR_CODES.MODEL_UNAVAILABLE
        );
    }

    if (status === 404) {
        return new AppError(
            "AI calibration reference endpoint is not available. Restart the Python AI service.",
            503,
            AI_ERROR_CODES.CALIBRATION_REFERENCE_NOT_FOUND
        );
    }

    if (status >= 500) {
        return new AppError(
            "AI inference failed.",
            502,
            AI_ERROR_CODES.INFERENCE_FAILED
        );
    }

    return new AppError(
        "AI service request was rejected.",
        502,
        AI_ERROR_CODES.INFERENCE_FAILED
    );
}

/* ------------------------------------------------------------------ *
 * Health
 * ------------------------------------------------------------------ */

/**
 * Raw health probe. Returns the full Python payload for internal use.
 * Do not hand this straight to a mobile client — see getPublicHealth.
 */
const checkHealth = async () => {
    const { status, body, roundTripMs } = await requestJson(
        aiServiceConfig.paths.health,
        { timeoutMs: aiServiceConfig.healthTimeoutMs }
    );

    if (status !== 200) {
        throw mapErrorResponse(status, body);
    }

    if (!body || body.status !== "ok" || body.word_model_loaded !== true) {
        throw new AppError(
            "AI model is not available.",
            503,
            AI_ERROR_CODES.MODEL_UNAVAILABLE
        );
    }

    return { ...body, roundTripMs };
};

/**
 * Mobile-facing health summary.
 *
 * Deliberately omits internal Python details (artefact path, SHA-256, file size,
 * thresholds) that a client has no use for.
 */
const getPublicHealth = async () => {
    const health = await checkHealth();

    const nodeMinimum = aiServiceConfig.minWindowSamples;
    const pythonMinimum = Number(health.min_predict_samples);
    const windowAgreement =
        Number.isFinite(pythonMinimum) && pythonMinimum === nodeMinimum;

    if (!windowAgreement) {
        // A genuine compatibility problem: the two layers disagree on how many
        // samples a valid prediction needs.
        console.warn(
            "[AI] window mismatch: backend requires",
            nodeMinimum,
            "but AI service reports",
            pythonMinimum
        );
    }

    return {
        available: true,
        modelLoaded: true,
        labels: Array.isArray(health.labels) ? health.labels : [],
        requiredSamples: nodeMinimum,
        maxSamples: aiServiceConfig.maxWindowSamples,
        sentenceSupported: Boolean(health.sentence_model_supported),
        windowAgreement,
        roundTripMs: health.roundTripMs,
    };
};

/* ------------------------------------------------------------------ *
 * Prediction
 * ------------------------------------------------------------------ */

/**
 * Send a prepared inference window to the AI service.
 *
 * @param {Array<{emg:number,pot:number}>} rows Validated sample rows.
 * @param {object} options
 * @param {number} [options.minConfidence] Override the model's own threshold.
 * @param {string} [options.sessionId] Python session id for session adaptation.
 */
const predictWord = async (
    rows,
    { minConfidence = null, sessionId = null, userCalibration = null } = {}
) => {
    const payload = {
        kind: "word",
        signal: {
            format: "samples",
            rows: toPythonSamples(rows),
        },
    };

    if (minConfidence != null) {
        payload.minConfidence = minConfidence;
    }

    if (sessionId) {
        payload.sessionId = sessionId;
    }

    if (userCalibration) {
        payload.userCalibration = userCalibration;
    }

    aiLog(
        "calling Python service",
        `samples=${rows.length}`,
        `session=${sessionId ? "yes" : "no"}`,
        `personalization=${userCalibration ? "yes" : "no"}`
    );

    const { status, body, roundTripMs } = await requestJson(
        aiServiceConfig.paths.predict,
        {
            method: "POST",
            body: payload,
            timeoutMs: aiServiceConfig.predictTimeoutMs,
        }
    );

    if (status !== 200) {
        aiLog("Python rejected the request", `status=${status}`, body && body.error);
        throw mapErrorResponse(status, body);
    }

    if (!body || typeof body.label !== "string") {
        throw new AppError(
            "AI service returned an unexpected prediction payload.",
            502,
            AI_ERROR_CODES.BAD_RESPONSE
        );
    }

    aiLog("Python response received", `${roundTripMs}ms`);

    return { ...body, roundTripMs };
};

/* ------------------------------------------------------------------ *
 * Session adaptation
 * ------------------------------------------------------------------ */

/**
 * Create a session profile from a neutral relaxed EMG baseline.
 *
 * This wraps the Python service's POST /session, which itself wraps the existing
 * runtime SessionAdapter. No new calibration behaviour is introduced here.
 */
const createSession = async (rows) => {
    aiLog("creating AI session", `baselineSamples=${rows.length}`);

    const { status, body, roundTripMs } = await requestJson(
        aiServiceConfig.paths.session,
        {
            method: "POST",
            body: { signal: { format: "samples", rows: toPythonSamples(rows) } },
            timeoutMs: aiServiceConfig.sessionTimeoutMs,
        }
    );

    if (status !== 200) {
        throw mapErrorResponse(status, body);
    }

    if (!body || typeof body.sessionId !== "string") {
        throw new AppError(
            "AI service returned an unexpected session payload.",
            502,
            AI_ERROR_CODES.BAD_RESPONSE
        );
    }

    return { ...body, roundTripMs };
};

const buildWordReference = async (word, captures) => {
    const payload = {
        word: String(word).trim().toLowerCase(),
        captures: captures.map((rows) => ({
            signal: {
                format: "samples",
                rows: toPythonSamples(rows),
            },
        })),
    };

    aiLog(
        "building word reference",
        `word=${payload.word}`,
        `captures=${captures.length}`
    );

    const { status, body, roundTripMs } = await requestJson(
        aiServiceConfig.paths.wordReference,
        {
            method: "POST",
            body: payload,
            timeoutMs: aiServiceConfig.calibrationTimeoutMs,
        }
    );

    if (status !== 200) {
        aiLog("Python rejected calibration reference", `status=${status}`, body && body.error);
        throw mapErrorResponse(status, body);
    }

    if (!body || !Array.isArray(body.emgReference)) {
        throw new AppError(
            "AI service returned an unexpected calibration reference payload.",
            502,
            AI_ERROR_CODES.BAD_RESPONSE
        );
    }

    return { ...body, roundTripMs };
};

module.exports = {
    AI_ERROR_CODES,
    checkHealth,
    getPublicHealth,
    predictWord,
    createSession,
    buildWordReference,
    aiLog,
    toPythonSamples,
};
