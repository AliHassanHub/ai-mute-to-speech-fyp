/**
 * Resolves per-user calibration context for inference.
 *
 * All profile data is loaded server-side from the authenticated user_id.
 * Client-supplied calibration_id or user_id is never trusted.
 */

const calibrationProfileModel = require("../models/calibrationProfileModel");
const aiService = require("./aiService");

const CACHE_TTL_MS = 30000;
const cache = new Map();

function cacheKey(userId, calibrationId, profileVersion, modelSha256) {
    return `${userId}:${calibrationId}:${profileVersion}:${modelSha256 || "none"}`;
}

function clearCache() {
    cache.clear();
}

function invalidateUser(userId) {
    const prefix = `${userId}:`;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
            cache.delete(key);
        }
    }
}

function parseEmgReference(raw) {
    if (raw == null) {
        return null;
    }
    if (Array.isArray(raw)) {
        return raw.length > 0 ? raw : null;
    }
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
}

function buildWordsPayload(wordEntries) {
    const words = {};

    for (const entry of wordEntries) {
        const label = String(entry.word_label);
        words[label] = {
            state: entry.state,
            potCenter:
                entry.pot_center != null ? Number(entry.pot_center) : null,
            potRadius:
                entry.pot_radius != null ? Number(entry.pot_radius) : null,
            emgReference: parseEmgReference(entry.emg_reference),
            qualityScore:
                entry.quality_score != null
                    ? Number(entry.quality_score)
                    : null,
            captureCount: Number(entry.capture_count || 0),
        };
    }

    return words;
}

function buildNeutralPayload(neutral) {
    if (!neutral || neutral.baseline_adc == null) {
        return null;
    }

    return {
        baselineAdc: Number(neutral.baseline_adc),
        noiseFloor:
            neutral.noise_floor != null ? Number(neutral.noise_floor) : null,
        emgStd: neutral.emg_std != null ? Number(neutral.emg_std) : null,
        potMean: neutral.pot_mean != null ? Number(neutral.pot_mean) : null,
        sampleCount:
            neutral.sample_count != null ? Number(neutral.sample_count) : null,
    };
}

function buildPersonalizationMeta(profile, wordEntries, profileCompatible) {
    const calibratedWords = wordEntries
        .filter((entry) => entry.state === "calibrated")
        .map((entry) => String(entry.word_label))
        .sort();

    const potPersonalizedWords = wordEntries
        .filter(
            (entry) =>
                entry.state === "calibrated" && entry.pot_center != null
        )
        .map((entry) => String(entry.word_label))
        .sort();

    const emgReferenceWords = wordEntries
        .filter((entry) => parseEmgReference(entry.emg_reference) != null)
        .map((entry) => String(entry.word_label))
        .sort();

    const applied =
        profileCompatible &&
        (calibratedWords.length > 0 ||
            potPersonalizedWords.length > 0 ||
            emgReferenceWords.length > 0);

    return {
        applied,
        profileVersion: Number(profile.profile_version || 1),
        profileCompatible,
        profileFallbackRequired: !profileCompatible,
        calibratedWords,
        potPersonalizedWords,
        emgReferenceWords,
    };
}

function buildWirePayload(profile, wordEntries, neutral, profileCompatible) {
    return {
        profileVersion: Number(profile.profile_version || 1),
        modelSha256: profile.model_sha256 || null,
        profileCompatible,
        neutral: buildNeutralPayload(neutral),
        words: buildWordsPayload(wordEntries),
    };
}

async function resolveActiveModelSha256() {
    try {
        const health = await aiService.checkHealth();
        return health.model_sha256 || null;
    } catch {
        return null;
    }
}

function enrichMetaWithPrediction(meta, predictedLabel) {
    if (!predictedLabel || predictedLabel === "unknown") {
        return { ...meta, wordPersonalized: false };
    }

    const label = String(predictedLabel).toLowerCase();
    const wordPersonalized =
        meta.potPersonalizedWords.some(
            (word) => String(word).toLowerCase() === label
        ) ||
        meta.emgReferenceWords.some(
            (word) => String(word).toLowerCase() === label
        );

    return { ...meta, wordPersonalized };
}

/**
 * Resolve personalization context for an authenticated user.
 *
 * @returns {{ context: object|null, meta: object }}
 */
async function resolveForUser(userId) {
    const numericUserId = Number(userId);
    if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
        return {
            context: null,
            meta: {
                applied: false,
                profileCompatible: false,
                profileFallbackRequired: false,
                reason: "invalid-user",
                calibratedWords: [],
                potPersonalizedWords: [],
                emgReferenceWords: [],
            },
        };
    }

    const profile =
        await calibrationProfileModel.getActiveProfileByUserId(numericUserId);
    if (!profile) {
        return {
            context: null,
            meta: {
                applied: false,
                profileCompatible: true,
                profileFallbackRequired: false,
                reason: "no-profile",
                calibratedWords: [],
                potPersonalizedWords: [],
                emgReferenceWords: [],
            },
        };
    }

    const activeModelSha256 = await resolveActiveModelSha256();
    const profileCompatible =
        !profile.model_sha256 ||
        !activeModelSha256 ||
        String(profile.model_sha256) === String(activeModelSha256);

    const key = cacheKey(
        numericUserId,
        profile.calibration_id,
        profile.profile_version,
        activeModelSha256
    );
    const cached = cache.get(key);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return cached.value;
    }

    const [wordEntries, neutral] = await Promise.all([
        calibrationProfileModel.getWordEntriesForUserProfile(
            numericUserId,
            profile.calibration_id
        ),
        calibrationProfileModel.getNeutralBaselineForUserProfile(
            numericUserId,
            profile.calibration_id
        ),
    ]);

    const meta = buildPersonalizationMeta(
        profile,
        wordEntries,
        profileCompatible
    );
    const context = profileCompatible
        ? buildWirePayload(profile, wordEntries, neutral, profileCompatible)
        : null;

    const value = { context, meta };
    cache.set(key, { cachedAt: Date.now(), value });
    return value;
}

module.exports = {
    resolveForUser,
    enrichMetaWithPrediction,
    clearCache,
    invalidateUser,
    buildWirePayload,
    buildPersonalizationMeta,
    parseEmgReference,
};
