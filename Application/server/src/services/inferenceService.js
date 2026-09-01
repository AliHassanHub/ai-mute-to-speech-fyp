const calibrationModel = require("../models/calibrationModel");
const historyModel = require("../models/historyModel");
const processedRecordingModel = require("../models/processedRecordingModel");
const recordingModel = require("../models/recordingModel");
const profileModel = require("../models/profileModel");
const pool = require("../config/db");
const inferenceModel = require("../models/inferenceModel");
const sessionModel = require("../models/sessionModel");
const mlService = require("./mlService");
const aiService = require("./aiService");
const aiSessionStore = require("./aiSessionStore");
const aiServiceConfig = require("../config/aiService");
const userCalibrationService = require("./userCalibrationService");
const translationService = require("./translationService");
const { AppError } = require("../utils/AppError");
const {
    SOURCE_LANGUAGE,
    normalizeTargetLanguage,
    parseStoredLanguagePreference,
    languageCodeToName,
} = require("../constants/languages");

function capitalizeWord(text) {
    if (!text) {
        return "";
    }
    const value = String(text).trim();
    if (!value) {
        return "";
    }
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildRecognizedText(prediction) {
    if (
        prediction.best_label &&
        String(prediction.best_label).startsWith("low-quality-signal:")
    ) {
        const reason = String(prediction.best_label).replace("low-quality-signal:", "");
        return `Signal quality too low (${reason}). Record at least 8 seconds with stable pot position.`;
    }

    if (prediction.accepted && prediction.label && prediction.label !== "unknown") {
        return capitalizeWord(prediction.label);
    }

    if (prediction.best_label && prediction.best_label !== "unknown") {
        return `Unknown (best guess: ${capitalizeWord(prediction.best_label)})`;
    }

    return "Could not recognize speech";
}

function buildFeatureVector(normalizedSignal, prediction) {
    const emgValues = normalizedSignal.map((row) => row[0]);
    const potValues = normalizedSignal.map((row) => row[1]);
    const emgMean =
        emgValues.reduce((sum, value) => sum + value, 0) / emgValues.length;
    const potMean =
        potValues.reduce((sum, value) => sum + value, 0) / potValues.length;
    const emgVariance =
        emgValues.reduce((sum, value) => sum + (value - emgMean) ** 2, 0) /
        emgValues.length;
    const emgStd = Math.sqrt(emgVariance);

    return {
        emgMean,
        emgStd,
        potMean,
        potStd:
            Math.sqrt(
                potValues.reduce((sum, value) => sum + (value - potMean) ** 2, 0) /
                    potValues.length
            ) || 0,
        sampleCount: normalizedSignal.length,
        confidence: prediction.confidence,
        distance: prediction.distance,
        margin: prediction.margin,
        accepted: prediction.accepted,
        bestLabel: prediction.best_label,
        predictedLabel: prediction.label,
        kind: prediction.kind || "word",
    };
}

function computeProcessingMetrics(normalizedSignal, calibration) {
    const emgValues = normalizedSignal.map((row) => row[0]);
    const maxEmg = Math.max(...emgValues, 1);
    const emgMean =
        emgValues.reduce((sum, value) => sum + value, 0) / emgValues.length;
    const emgVariance =
        emgValues.reduce((sum, value) => sum + (value - emgMean) ** 2, 0) /
        emgValues.length;
    const emgStd = Math.sqrt(emgVariance);

    const normalizationFactor = Number(
        (4095 / maxEmg).toFixed(5)
    );
    const noiseReductionLevel = Number(
        (emgStd || Number(calibration.threshold_level) || 0.15).toFixed(5)
    );

    return {
        normalizationFactor:
            Number.isFinite(normalizationFactor) && normalizationFactor > 0
                ? normalizationFactor
                : Number(calibration.baseline_value) || 1.0,
        noiseReductionLevel,
    };
}

function normalizeAiPrediction(prediction = {}) {
    return {
        label: prediction.label,
        best_label: prediction.bestLabel ?? prediction.best_label ?? null,
        accepted: prediction.accepted,
        confidence: prediction.confidence,
        distance: prediction.distance,
        margin: prediction.margin,
        kind: prediction.kind || "word",
    };
}

function rowsToDualChannel(rows) {
    return rows.map((row) => [row.emg, row.pot]);
}

async function resolveActiveSessionId(userId, deviceName = "ESP32_EMG_SENSOR") {
    const activeSession = await sessionModel.getActiveSessionByUserId(userId);
    if (activeSession) {
        return activeSession.session_id;
    }

    return sessionModel.createSession(userId, deviceName);
}

async function persistWordPredictionInTransaction({
    sessionId,
    dualChannelRows,
    signalLabel,
    durationMs,
    processedData,
    featureVector,
    normalizationFactor,
    noiseReductionLevel,
    recognizedText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    confidenceScore,
    processingTimeMs,
}) {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const recordingId = await inferenceModel.insertEmgRecording(connection, {
            sessionId,
            rawSignalData: JSON.stringify(dualChannelRows),
            channelCount: 2,
            samplingRate: 50,
            durationMs,
            signalLabel: signalLabel || null,
        });

        const processedId = await inferenceModel.insertProcessedRecording(connection, {
            recordingId,
            processedData,
            featureVector,
            normalizationFactor,
            noiseReductionLevel,
        });

        const textId = await inferenceModel.insertTextResult(connection, {
            processedId,
            recognizedText,
            translatedText,
            sourceLanguage,
            targetLanguage,
            confidenceScore,
            processingTimeMs,
        });

        await sessionModel.refreshSessionAggregates(sessionId, connection);

        await connection.commit();

        return {
            recordingId,
            processedId,
            textId,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

const inferRecording = async (
    userId,
    recordingId,
    {
        targetLanguage,
        minConfidence = 0.68,
    } = {}
) => {
    const startedAt = Date.now();

    const userProfile = await profileModel.getProfileByUserId(userId);
    const languagePreference = parseStoredLanguagePreference(userProfile?.language);
    const resolvedTargetLanguage = normalizeTargetLanguage(
        targetLanguage || languageCodeToName(languagePreference.translationLanguage)
    );
    const sourceLanguage = SOURCE_LANGUAGE;

    const recording = await recordingModel.getRecordingDetails(recordingId);
    if (!recording) {
        throw {
            status: 404,
            message: "Recording not found.",
        };
    }

    if (recording.user_id !== userId) {
        throw {
            status: 403,
            message: "You are not authorized to process this recording.",
        };
    }

    const existingProcessed =
        await processedRecordingModel.getProcessedRecordingByRecordingId(
            recordingId
        );
    if (existingProcessed) {
        throw {
            status: 409,
            message: "This recording has already been processed.",
        };
    }

    const calibration =
        await calibrationModel.getActiveCalibrationByUserId(userId);
    if (!calibration) {
        throw {
            status: 400,
            message: "Calibration is required before prediction. Complete calibration first.",
        };
    }

    let rawSignalData = [];
    try {
        rawSignalData = JSON.parse(recording.raw_signal_data);
    } catch {
        throw {
            status: 400,
            message: "Recording signal data is invalid.",
        };
    }

    const { prediction, normalizedSignal, modelStatus } =
        await mlService.predictSignal(rawSignalData, minConfidence, {
            userCalibration: (
                await userCalibrationService.resolveForUser(userId)
            ).context,
        });

    const { normalizationFactor, noiseReductionLevel } = computeProcessingMetrics(
        normalizedSignal,
        calibration
    );
    const featureVector = buildFeatureVector(normalizedSignal, prediction);
    const processedData = {
        signal: normalizedSignal,
        prediction,
        calibration: {
            calibrationId: calibration.calibration_id,
            baselineValue: Number(calibration.baseline_value),
            thresholdLevel: Number(calibration.threshold_level),
        },
        modelVersion: modelStatus.modelVersion,
        modelStatus: modelStatus.message,
    };

    const recognizedText = buildRecognizedText(prediction);
    const translatedText = translationService.translatePhraseForWord(
        recognizedText,
        resolvedTargetLanguage
    );
    const confidenceScore = Number(
        ((prediction.confidence || 0) * 100).toFixed(2)
    );
    const processingTimeMs = Date.now() - startedAt;

    const { processedId, textId } = await saveInferenceResults({
        recordingId,
        processedData,
        featureVector,
        normalizationFactor,
        noiseReductionLevel,
        recognizedText,
        translatedText,
        sourceLanguage,
        targetLanguage: resolvedTargetLanguage,
        confidenceScore,
        processingTimeMs,
    });

    return {
        success: true,
        message: prediction.accepted
            ? "Prediction completed successfully."
            : "Prediction completed with low confidence.",
        recordingId,
        processedId,
        textId,
        prediction: {
            label: prediction.label,
            bestLabel: prediction.best_label,
            accepted: prediction.accepted,
            confidence: prediction.confidence,
            distance: prediction.distance,
            margin: prediction.margin,
        },
        result: {
            textId,
            processedId,
            recordingId,
            recognizedText,
            translatedText,
            confidenceScore,
            processingTimeMs,
            accepted: prediction.accepted,
            sourceLanguage,
            targetLanguage: resolvedTargetLanguage,
        },
    };
};

async function saveInferenceResults({
    recordingId,
    processedData,
    featureVector,
    normalizationFactor,
    noiseReductionLevel,
    recognizedText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    confidenceScore,
    processingTimeMs,
}) {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const processedId = await inferenceModel.insertProcessedRecording(connection, {
            recordingId,
            processedData,
            featureVector,
            normalizationFactor,
            noiseReductionLevel,
        });

        const textId = await inferenceModel.insertTextResult(connection, {
            processedId,
            recognizedText,
            translatedText,
            sourceLanguage,
            targetLanguage,
            confidenceScore,
            processingTimeMs,
        });

        await connection.commit();

        return {
            processedId,
            textId,
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

const getModelStatus = async () => {
    const status = await mlService.getModelStatus();
    return {
        success: true,
        ready: Boolean(status.ready),
        ...status,
    };
};

/* ------------------------------------------------------------------ *
 * Direct window prediction
 * ------------------------------------------------------------------ */

/**
 * Predict a word from a sample window supplied directly by the client.
 *
 * Unlike inferRecording, this does not read from or write to the database. The
 * current schema ties persistence to an emg_recordings row
 * (processed_recordings.recording_id is NOT NULL UNIQUE), so a stateless window
 * has nowhere to be stored without a schema change.
 */
const predictWord = async (userId, { rows, minConfidence, sessionId } = {}) => {
    const startedAt = Date.now();
    const receivedSamples = Array.isArray(rows) ? rows.length : 0;

    aiService.aiLog("request received", `user=${userId}`);
    aiService.aiLog(`samples received: ${receivedSamples}`);

    // Not-ready is a normal buffering state, not an error and not a prediction.
    if (receivedSamples < aiServiceConfig.minWindowSamples) {
        aiService.aiLog(
            "window not ready",
            `${receivedSamples}/${aiServiceConfig.minWindowSamples}`
        );
        return {
            success: true,
            ready: false,
            requiredSamples: aiServiceConfig.minWindowSamples,
            receivedSamples,
            maxSamples: aiServiceConfig.maxWindowSamples,
            prediction: null,
            message: "Not enough samples for a calibrated prediction yet.",
        };
    }

    if (receivedSamples > aiServiceConfig.maxWindowSamples) {
        throw new AppError(
            `The AI model rejects windows above ${aiServiceConfig.maxWindowSamples} samples; received ${receivedSamples}. Send only the current utterance window.`,
            400,
            "AI_WINDOW_TOO_LARGE"
        );
    }

    const resolvedSessionId =
        sessionId || aiSessionStore.getSessionId(userId) || null;

    const { context: userCalibration, meta: personalizationMeta } =
        await userCalibrationService.resolveForUser(userId);

    const result = await aiService.predictWord(rows, {
        minConfidence: Number.isFinite(Number(minConfidence))
            ? Number(minConfidence)
            : null,
        sessionId: resolvedSessionId,
        userCalibration,
    });

    const processingTimeMs = Date.now() - startedAt;

    aiService.aiLog(`prediction: ${result.label}`);
    aiService.aiLog(`accepted: ${result.accepted}`);
    aiService.aiLog(`processing time: ${processingTimeMs}ms`);

    return {
        success: true,
        ready: true,
        prediction: {
            label: result.label,
            bestLabel: result.bestLabel,
            confidence: result.confidence,
            accepted: result.accepted,
            distance: result.distance,
            margin: result.margin,
        },
        meta: {
            samplesUsed: result.sampleCount ?? receivedSamples,
            processingTimeMs,
            aiProcessingTimeMs: result.processingTimeMs,
            aiRoundTripMs: result.roundTripMs,
            // Semantics carried through verbatim from the predictor.
            confidenceBasis: result.confidenceBasis,
            marginUnit: result.marginUnit,
            distanceUnit: result.distanceUnit,
            sessionAdaptation: result.sessionAdaptation,
            quality: result.quality,
            requiredConfidence: result.requiredConfidence,
            modelVersion: await mlService.resolveModelVersion(),
            persisted: false,
            personalization: userCalibrationService.enrichMetaWithPrediction(
                personalizationMeta,
                result.label
            ),
            persistenceNote:
                "Direct window predictions are not persisted: the current schema requires a recording_id.",
        },
    };
};

/* ------------------------------------------------------------------ *
 * Session adaptation
 * ------------------------------------------------------------------ */

/**
 * Create an AI session profile and bind it to the authenticated user and,
 * when one exists, their active application session.
 */
const createPredictionSession = async (userId, { rows } = {}) => {
    const receivedSamples = Array.isArray(rows) ? rows.length : 0;

    if (receivedSamples < aiServiceConfig.minSessionBaselineSamples) {
        throw new AppError(
            `Session adaptation needs at least ${aiServiceConfig.minSessionBaselineSamples} neutral samples; received ${receivedSamples}.`,
            400,
            "AI_BASELINE_TOO_SMALL"
        );
    }

    const appSession = await sessionModel.getActiveSessionByUserId(userId);
    const result = await aiService.createSession(rows);

    aiSessionStore.setSession(userId, {
        aiSessionId: result.sessionId,
        appSessionId: appSession ? appSession.session_id : null,
        baselineSamples: receivedSamples,
    });

    return {
        success: true,
        message: "Session adaptation profile created.",
        session: {
            aiSessionId: result.sessionId,
            appSessionId: appSession ? appSession.session_id : null,
            baselineSamples: receivedSamples,
            baseline: result.baseline,
            noiseFloor: result.noiseFloor,
            activeScale: result.activeScale,
        },
    };
};

const getPredictionSession = async (userId) => {
    const entry = aiSessionStore.getSession(userId);
    return {
        success: true,
        session: entry
            ? {
                  aiSessionId: entry.aiSessionId,
                  appSessionId: entry.appSessionId,
                  baselineSamples: entry.baselineSamples,
                  createdAt: new Date(entry.createdAt).toISOString(),
              }
            : null,
    };
};

const clearPredictionSession = async (userId) => {
    aiSessionStore.clearSession(userId);
    return {
        success: true,
        message: "Session adaptation profile cleared.",
    };
};

/**
 * Persist a direct AI window prediction into the existing history schema.
 *
 * Creates emg_recordings -> processed_recordings -> text_results in one
 * transaction. Re-runs prediction server-side so the stored label/confidence
 * cannot be forged by the client.
 */
const persistWordPrediction = async (
    userId,
    {
        rows,
        minConfidence,
        targetLanguage,
        durationMs,
        signalLabel,
        textId: existingTextId,
        deviceName = "ESP32_EMG_SENSOR",
    } = {}
) => {
    const startedAt = Date.now();
    const receivedSamples = Array.isArray(rows) ? rows.length : 0;

    if (existingTextId) {
        const existing = await historyModel.getHistoryDetails(
            userId,
            Number(existingTextId)
        );
        if (existing) {
            return {
                success: true,
                persisted: true,
                message: "Result already saved.",
                textId: existing.text_id,
                recordingId: existing.recording_id,
                processedId: existing.processed_id,
                sessionId: existing.session_id,
                result: {
                    textId: existing.text_id,
                    processedId: existing.processed_id,
                    recordingId: existing.recording_id,
                    recognizedText: existing.recognized_text,
                    translatedText: existing.translated_text,
                    confidenceScore: Number(existing.confidence_score),
                    processingTimeMs: existing.processing_time_ms,
                    sourceLanguage: existing.source_language,
                    targetLanguage: existing.target_language,
                },
            };
        }
    }

    if (receivedSamples < aiServiceConfig.minWindowSamples) {
        throw new AppError(
            `Cannot save a prediction without a complete ${aiServiceConfig.minWindowSamples}-sample window; received ${receivedSamples}.`,
            400,
            "AI_WINDOW_TOO_SMALL"
        );
    }

    if (receivedSamples > aiServiceConfig.maxWindowSamples) {
        throw new AppError(
            `Cannot save a prediction window above ${aiServiceConfig.maxWindowSamples} samples; received ${receivedSamples}.`,
            400,
            "AI_WINDOW_TOO_LARGE"
        );
    }

    const userProfile = await profileModel.getProfileByUserId(userId);
    const languagePreference = parseStoredLanguagePreference(userProfile?.language);
    const resolvedTargetLanguage = normalizeTargetLanguage(
        targetLanguage || languageCodeToName(languagePreference.translationLanguage)
    );
    const sourceLanguage = SOURCE_LANGUAGE;

    const resolvedSessionId = await resolveActiveSessionId(userId, deviceName);
    const session = await sessionModel.getSessionById(resolvedSessionId);
    if (!session || session.user_id !== userId) {
        throw new AppError("Active session not found.", 404, "SESSION_NOT_FOUND");
    }
    if (session.status !== "active") {
        throw new AppError(
            "Results can only be saved to an active session.",
            400,
            "SESSION_NOT_ACTIVE"
        );
    }

    const { context: userCalibration, meta: personalizationMeta } =
        await userCalibrationService.resolveForUser(userId);

    const aiSessionEntry = aiSessionStore.getSession(userId);
    const aiResult = await aiService.predictWord(rows, {
        minConfidence: Number.isFinite(Number(minConfidence))
            ? Number(minConfidence)
            : null,
        sessionId: aiSessionEntry?.aiSessionId || null,
        userCalibration,
    });

    const prediction = normalizeAiPrediction(aiResult);
    const dualChannelRows = rowsToDualChannel(rows);
    const calibration =
        (await calibrationModel.getActiveCalibrationByUserId(userId)) || {
            calibration_id: null,
            baseline_value: 1.0,
            threshold_level: 0.15,
        };

    const { normalizationFactor, noiseReductionLevel } = computeProcessingMetrics(
        dualChannelRows,
        calibration
    );
    const featureVector = buildFeatureVector(dualChannelRows, prediction);
    const modelVersion = await mlService.resolveModelVersion();
    const processedData = {
        signal: dualChannelRows,
        prediction,
        calibration: calibration.calibration_id
            ? {
                  calibrationId: calibration.calibration_id,
                  baselineValue: Number(calibration.baseline_value),
                  thresholdLevel: Number(calibration.threshold_level),
              }
            : null,
        modelVersion,
        source: "ai-window",
        aiMeta: {
            quality: aiResult.quality ?? null,
            confidenceBasis: aiResult.confidenceBasis ?? null,
            marginUnit: aiResult.marginUnit ?? null,
            sessionAdaptation: aiSessionEntry ? "applied" : "none",
            personalization: userCalibrationService.enrichMetaWithPrediction(
                personalizationMeta,
                prediction.label
            ),
        },
    };

    const recognizedText = buildRecognizedText(prediction);
    const translatedText = translationService.translatePhraseForWord(
        recognizedText,
        resolvedTargetLanguage
    );
    const confidenceScore = Number(((prediction.confidence || 0) * 100).toFixed(2));
    const processingTimeMs = Date.now() - startedAt;
    const resolvedDurationMs =
        Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
            ? Number(durationMs)
            : Math.round((receivedSamples / 50) * 1000);

    const { recordingId, processedId, textId } =
        await persistWordPredictionInTransaction({
            sessionId: resolvedSessionId,
            dualChannelRows,
            signalLabel,
            durationMs: resolvedDurationMs,
            processedData,
            featureVector,
            normalizationFactor,
            noiseReductionLevel,
            recognizedText,
            translatedText,
            sourceLanguage,
            targetLanguage: resolvedTargetLanguage,
            confidenceScore,
            processingTimeMs,
        });

    return {
        success: true,
        persisted: true,
        message: "Result saved successfully.",
        textId,
        recordingId,
        processedId,
        sessionId: resolvedSessionId,
        prediction: {
            label: prediction.label,
            bestLabel: prediction.best_label,
            accepted: prediction.accepted,
            confidence: prediction.confidence,
            distance: prediction.distance,
            margin: prediction.margin,
        },
        result: {
            textId,
            processedId,
            recordingId,
            recognizedText,
            translatedText,
            confidenceScore,
            processingTimeMs,
            accepted: prediction.accepted,
            sourceLanguage,
            targetLanguage: resolvedTargetLanguage,
        },
    };
};

const getAiHealth = async () => {
    const health = await aiService.getPublicHealth();
    return {
        success: true,
        ...health,
    };
};

module.exports = {
    inferRecording,
    getModelStatus,
    predictWord,
    persistWordPrediction,
    createPredictionSession,
    getPredictionSession,
    clearPredictionSession,
    getAiHealth,
};
