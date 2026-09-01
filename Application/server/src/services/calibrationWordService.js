/**
 * Per-word incremental calibration orchestration.
 *
 * Node owns auth, profile resolution, DB writes, and user isolation.
 * Python only extracts production feature references from real captures.
 */

const aiService = require("./aiService");
const calibrationProfileModel = require("../models/calibrationProfileModel");
const userCalibrationService = require("./userCalibrationService");
const { AppError } = require("../utils/AppError");
const aiServiceConfig = require("../config/aiService");

const idempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeWord(word) {
    return String(word || "")
        .trim()
        .toLowerCase();
}

function clearIdempotencyCache() {
    idempotencyCache.clear();
}

function getCachedIdempotentResult(key) {
    const entry = idempotencyCache.get(key);
    if (!entry) {
        return null;
    }
    if (Date.now() - entry.cachedAt > IDEMPOTENCY_TTL_MS) {
        idempotencyCache.delete(key);
        return null;
    }
    return entry.value;
}

function cacheIdempotentResult(key, value) {
    idempotencyCache.set(key, { cachedAt: Date.now(), value });
}

async function resolveModelLabels() {
    const health = await aiService.checkHealth();
    const labels = Array.isArray(health.labels) ? health.labels : [];
    if (labels.length === 0) {
        throw new AppError(
            "AI model labels are unavailable.",
            503,
            "AI_MODEL_UNAVAILABLE"
        );
    }
    return {
        labels: labels.map((label) => String(label).toLowerCase()),
        modelSha256: health.model_sha256,
    };
}

function assertWordInModel(word, labels) {
    if (!labels.includes(word)) {
        throw new AppError(
            `Word "${word}" is not in the active model vocabulary.`,
            400,
            "CALIBRATION_UNKNOWN_WORD"
        );
    }
}

function validateSingleCapture(captures) {
    if (!Array.isArray(captures) || captures.length !== 1) {
        throw new AppError(
            "Neutral baseline requires exactly one capture.",
            400,
            "CALIBRATION_INVALID_CAPTURE"
        );
    }

    const capture = captures[0];
    const rows = capture?.signal?.rows ?? capture?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new AppError(
            "captures[0] must include signal.rows.",
            400,
            "CALIBRATION_INVALID_CAPTURE"
        );
    }
    if (rows.length < aiServiceConfig.minCalibrationSamples) {
        throw new AppError(
            `Neutral baseline needs at least ${aiServiceConfig.minCalibrationSamples} samples.`,
            400,
            "CALIBRATION_CAPTURE_TOO_SHORT"
        );
    }
    if (rows.length > aiServiceConfig.maxWindowSamples) {
        throw new AppError(
            `Neutral baseline exceeds ${aiServiceConfig.maxWindowSamples} samples.`,
            400,
            "CALIBRATION_CAPTURE_TOO_LONG"
        );
    }
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        if (
            row == null ||
            typeof row.emg !== "number" ||
            typeof row.pot !== "number" ||
            !Number.isFinite(row.emg) ||
            !Number.isFinite(row.pot)
        ) {
            throw new AppError(
                `captures[0].signal.rows[${rowIndex}] must contain finite emg and pot values.`,
                400,
                "CALIBRATION_INVALID_CAPTURE"
            );
        }
    }
}

function validateCaptureBatch(captures) {
    if (!Array.isArray(captures) || captures.length === 0) {
        throw new AppError(
            "At least one capture is required.",
            400,
            "CALIBRATION_NO_CAPTURES"
        );
    }

    if (captures.length < aiServiceConfig.minCalibrationCaptures) {
        throw new AppError(
            `At least ${aiServiceConfig.minCalibrationCaptures} captures are required.`,
            400,
            "CALIBRATION_INSUFFICIENT_CAPTURES"
        );
    }

    if (captures.length > aiServiceConfig.maxCalibrationCaptures) {
        throw new AppError(
            `At most ${aiServiceConfig.maxCalibrationCaptures} captures are allowed per request.`,
            400,
            "CALIBRATION_TOO_MANY_CAPTURES"
        );
    }

    for (let index = 0; index < captures.length; index += 1) {
        const capture = captures[index];
        const rows = capture?.signal?.rows ?? capture?.rows;
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new AppError(
                `captures[${index}] must include signal.rows.`,
                400,
                "CALIBRATION_INVALID_CAPTURE"
            );
        }
        if (rows.length < aiServiceConfig.minCalibrationSamples) {
            throw new AppError(
                `captures[${index}] needs at least ${aiServiceConfig.minCalibrationSamples} samples.`,
                400,
                "CALIBRATION_CAPTURE_TOO_SHORT"
            );
        }
        if (rows.length > aiServiceConfig.maxWindowSamples) {
            throw new AppError(
                `captures[${index}] exceeds ${aiServiceConfig.maxWindowSamples} samples.`,
                400,
                "CALIBRATION_CAPTURE_TOO_LONG"
            );
        }
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const row = rows[rowIndex];
            if (
                row == null ||
                typeof row.emg !== "number" ||
                typeof row.pot !== "number" ||
                !Number.isFinite(row.emg) ||
                !Number.isFinite(row.pot)
            ) {
                throw new AppError(
                    `captures[${index}].signal.rows[${rowIndex}] must contain finite emg and pot values.`,
                    400,
                    "CALIBRATION_INVALID_CAPTURE"
                );
            }
        }
    }
}

function toAiCaptureRows(captures) {
    return captures.map((capture) => {
        const rows = capture?.signal?.rows ?? capture.rows;
        return rows.map((row) => ({
            emg: Number(row.emg),
            pot: Number(row.pot),
        }));
    });
}

async function getPersonalizedProfile(userId) {
    const { labels, modelSha256 } = await resolveModelLabels();
    const profile = await calibrationProfileModel.getActiveProfileByUserId(userId);
    if (!profile) {
        return {
            success: true,
            hasProfile: false,
            profile: null,
            words: [],
            vocabulary: labels,
            activeModelSha256: modelSha256,
        };
    }

    if (profile.model_sha256 && profile.model_sha256 !== modelSha256) {
        const calibratedLabels = (
            await calibrationProfileModel.getWordEntriesForUserProfile(
                userId,
                profile.calibration_id
            )
        )
            .filter((entry) => entry.state === "calibrated")
            .map((entry) => String(entry.word_label).toLowerCase());

        const labelsAreCompatible = calibratedLabels.every((label) =>
            labels.includes(label)
        );

        if (labelsAreCompatible) {
            await calibrationProfileModel.updateProfileModelSha(
                userId,
                profile.calibration_id,
                modelSha256
            );
            profile.model_sha256 = modelSha256;
            userCalibrationService.invalidateUser(userId);
        }
    } else if (!profile.model_sha256) {
        await calibrationProfileModel.updateProfileModelSha(
            userId,
            profile.calibration_id,
            modelSha256
        );
        profile.model_sha256 = modelSha256;
    }

    const [wordEntries, neutral] = await Promise.all([
        calibrationProfileModel.getWordEntriesForUserProfile(
            userId,
            profile.calibration_id
        ),
        calibrationProfileModel.getNeutralBaselineForUserProfile(
            userId,
            profile.calibration_id
        ),
    ]);

    return {
        success: true,
        hasProfile: true,
        profile: {
            calibrationId: profile.calibration_id,
            profileVersion: Number(profile.profile_version || 1),
            modelSha256: profile.model_sha256 || null,
            status: profile.status,
            overallQuality: profile.overall_quality,
        },
        neutral: neutral
            ? {
                  baselineAdc: Number(neutral.baseline_adc),
                  noiseFloor:
                      neutral.noise_floor != null
                          ? Number(neutral.noise_floor)
                          : null,
                  emgStd:
                      neutral.emg_std != null ? Number(neutral.emg_std) : null,
                  potMean:
                      neutral.pot_mean != null ? Number(neutral.pot_mean) : null,
                  sampleCount:
                      neutral.sample_count != null
                          ? Number(neutral.sample_count)
                          : null,
              }
            : null,
        words: wordEntries.map((entry) => ({
            word: entry.word_label,
            state: entry.state,
            potCenter:
                entry.pot_center != null ? Number(entry.pot_center) : null,
            potRadius:
                entry.pot_radius != null ? Number(entry.pot_radius) : null,
            hasEmgReference: entry.emg_reference != null,
            qualityScore:
                entry.quality_score != null
                    ? Number(entry.quality_score)
                    : null,
            captureCount: Number(entry.capture_count || 0),
            calibratedAt: entry.calibrated_at,
        })),
        vocabulary: labels,
        activeModelSha256: modelSha256,
    };
}

async function calibrateWord(userId, { word, captures, idempotencyKey = null }) {
    const normalizedWord = normalizeWord(word);
    const { labels, modelSha256 } = await resolveModelLabels();
    assertWordInModel(normalizedWord, labels);
    validateCaptureBatch(captures);

    if (idempotencyKey) {
        const cacheKey = `${userId}:${normalizedWord}:${idempotencyKey}`;
        const cached = getCachedIdempotentResult(cacheKey);
        if (cached) {
            return { ...cached, idempotentReplay: true };
        }
    }

    let profile = await calibrationProfileModel.getActiveProfileByUserId(userId);
    const existingEntry =
        profile &&
        (await calibrationProfileModel.getWordEntry(
            userId,
            profile.calibration_id,
            normalizedWord
        ));

    const isRecalibration =
        existingEntry &&
        existingEntry.state === "calibrated" &&
        existingEntry.emg_reference != null;

    if (isRecalibration) {
        profile = await calibrationProfileModel.cloneProfileForRecalibration(
            userId,
            profile
        );
    } else if (!profile) {
        profile = await calibrationProfileModel.ensureActiveProfile(
            userId,
            modelSha256
        );
    } else if (!profile.model_sha256) {
        await calibrationProfileModel.updateProfileModelSha(
            userId,
            profile.calibration_id,
            modelSha256
        );
        profile.model_sha256 = modelSha256;
    }

    const aiCaptures = toAiCaptureRows(captures);
    const reference = await aiService.buildWordReference(
        normalizedWord,
        aiCaptures
    );

    if (reference.modelSha256 && reference.modelSha256 !== modelSha256) {
        throw new AppError(
            "Calibration reference model identity does not match the active AI model.",
            503,
            "CALIBRATION_MODEL_MISMATCH"
        );
    }

    const captureMetadata = {
        ...(reference.captureMetadata || {}),
        idempotencyKey: idempotencyKey || null,
        modelSha256,
        createdAt: new Date().toISOString(),
    };

    const savedEntry = await calibrationProfileModel.upsertWordEntry(
        userId,
        profile.calibration_id,
        {
            wordLabel: normalizedWord,
            potCenter: reference.potCenter,
            potRadius: reference.potRadius,
            emgReference: reference.emgReference,
            qualityScore: reference.qualityScore,
            captureCount: reference.captureCount,
            captureMetadata,
        }
    );

    userCalibrationService.invalidateUser(userId);

    const response = {
        success: true,
        word: normalizedWord,
        state: "calibrated",
        potCenter: Number(reference.potCenter),
        potRadius: Number(reference.potRadius),
        featureDimension: Number(reference.featureDimension),
        qualityScore:
            reference.qualityScore != null
                ? Number(reference.qualityScore)
                : null,
        captureCount: Number(reference.captureCount),
        submittedCaptureCount: Number(reference.submittedCaptureCount),
        rejectedCaptureCount: Array.isArray(reference.rejectedCaptures)
            ? reference.rejectedCaptures.length
            : 0,
        profileVersion: Number(profile.profile_version || 1),
        calibrationId: profile.calibration_id,
        modelSha256,
        personalizationReady: true,
        idempotentReplay: false,
        calibratedAt: savedEntry?.calibrated_at || new Date().toISOString(),
    };

    if (idempotencyKey) {
        cacheIdempotentResult(
            `${userId}:${normalizedWord}:${idempotencyKey}`,
            response
        );
    }

    return response;
}

async function saveNeutralBaseline(userId, { captures }) {
    validateSingleCapture(captures);
    const rowSets = toAiCaptureRows(captures);
    const rows = rowSets[0] ?? [];
    const emgValues = rows.map((row) => row.emg);
    const potValues = rows.map((row) => row.pot);
    const emgMean = emgValues.reduce((sum, v) => sum + v, 0) / emgValues.length;
    const potMean = potValues.reduce((sum, v) => sum + v, 0) / potValues.length;
    const emgVariance =
        emgValues.reduce((sum, v) => sum + (v - emgMean) ** 2, 0) / emgValues.length;
    const emgStd = Math.sqrt(emgVariance);
    const noiseFloor = Math.max(emgStd, 1);

    const { modelSha256 } = await resolveModelLabels();
    let profile = await calibrationProfileModel.getActiveProfileByUserId(userId);
    if (!profile) {
        profile = await calibrationProfileModel.ensureActiveProfile(userId, modelSha256);
    } else if (!profile.model_sha256) {
        await calibrationProfileModel.updateProfileModelSha(
            userId,
            profile.calibration_id,
            modelSha256
        );
    }

    const neutral = await calibrationProfileModel.upsertNeutralBaseline(
        userId,
        profile.calibration_id,
        {
            baselineAdc: Number(emgMean.toFixed(5)),
            noiseFloor: Number(noiseFloor.toFixed(5)),
            emgStd: Number(emgStd.toFixed(5)),
            potMean: Number(potMean.toFixed(5)),
            sampleCount: rows.length,
        }
    );

    userCalibrationService.invalidateUser(userId);

    return {
        success: true,
        baselineAdc: Number(neutral.baseline_adc),
        noiseFloor: neutral.noise_floor != null ? Number(neutral.noise_floor) : null,
        emgStd: neutral.emg_std != null ? Number(neutral.emg_std) : null,
        potMean: neutral.pot_mean != null ? Number(neutral.pot_mean) : null,
        sampleCount: neutral.sample_count != null ? Number(neutral.sample_count) : rows.length,
        profileVersion: Number(profile.profile_version || 1),
    };
}

module.exports = {
    getPersonalizedProfile,
    calibrateWord,
    saveNeutralBaseline,
    clearIdempotencyCache,
    normalizeWord,
    resolveModelLabels,
};
