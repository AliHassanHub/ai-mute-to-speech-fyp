const inferenceService = require("../services/inferenceService");

/**
 * Send an error to the client without leaking internals.
 *
 * Stack traces and Python-side detail strings never reach the response body.
 * The `code` is included so the mobile client can distinguish causes.
 */
function sendError(res, error) {
    const status = error.status || 500;

    if (process.env.NODE_ENV !== "production") {
        console.error("[AI] error", {
            status,
            code: error.code || null,
            message: error.message,
        });
    }

    const payload = {
        success: false,
        message:
            status >= 500 && process.env.NODE_ENV === "production"
                ? "Internal Server Error"
                : error.message || "Internal Server Error",
    };

    if (error.code) {
        payload.code = error.code;
    }

    return res.status(status).json(payload);
}

const inferRecording = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const recordingId = Number(req.params.recordingId);
        const { targetLanguage, minConfidence } = req.body;

        const result = await inferenceService.inferRecording(
            userId,
            recordingId,
            {
                targetLanguage,
                minConfidence,
            }
        );

        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error);
    }
};

const getModelStatus = async (req, res) => {
    try {
        const result = await inferenceService.getModelStatus();
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error);
    }
};

const getAiHealth = async (req, res) => {
    try {
        const result = await inferenceService.getAiHealth();
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error);
    }
};

/**
 * Predict a word from a sample window supplied by the client.
 *
 * The user identity always comes from the auth middleware; any userId in the
 * request body is ignored.
 */
const predictWord = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const { signal, minConfidence, sessionId } = req.body;

        const result = await inferenceService.predictWord(userId, {
            rows: signal.rows,
            minConfidence,
            sessionId,
        });

        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error);
    }
};

const createPredictionSession = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const { signal } = req.body;

        const result = await inferenceService.createPredictionSession(userId, {
            rows: signal.rows,
        });

        return res.status(201).json(result);
    } catch (error) {
        return sendError(res, error);
    }
};

const getPredictionSession = async (req, res) => {
    try {
        const result = await inferenceService.getPredictionSession(
            req.user.user_id
        );
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error);
    }
};

const clearPredictionSession = async (req, res) => {
    try {
        const result = await inferenceService.clearPredictionSession(
            req.user.user_id
        );
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error);
    }
};

const persistWordPrediction = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const {
            signal,
            minConfidence,
            targetLanguage,
            durationMs,
            signalLabel,
            textId,
            deviceName,
        } = req.body;

        const result = await inferenceService.persistWordPrediction(userId, {
            rows: signal.rows,
            minConfidence,
            targetLanguage,
            durationMs,
            signalLabel,
            textId,
            deviceName,
        });

        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error);
    }
};

module.exports = {
    inferRecording,
    getModelStatus,
    getAiHealth,
    predictWord,
    persistWordPrediction,
    createPredictionSession,
    getPredictionSession,
    clearPredictionSession,
};
