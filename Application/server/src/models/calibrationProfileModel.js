const pool = require("../config/db");

/**
 * Load the authenticated user's active calibration profile.
 * Never accepts a client-supplied calibration_id — only user_id from JWT.
 */
const getActiveProfileByUserId = async (userId) => {
    const [rows] = await pool.query(
        `
        SELECT
            calibration_id,
            user_id,
            profile_version,
            model_sha256,
            status,
            overall_quality,
            baseline_value,
            threshold_level,
            calibration_data,
            calibration_date,
            is_active
        FROM calibration_profiles
        WHERE user_id = ?
          AND is_active = TRUE
          AND status = 'active'
        ORDER BY calibration_date DESC, calibration_id DESC
        LIMIT 1
        `,
        [userId]
    );

    return rows[0] || null;
};

/**
 * Word entries for a profile, scoped to the owning user via join.
 */
const getWordEntriesForUserProfile = async (userId, calibrationId) => {
    const [rows] = await pool.query(
        `
        SELECT
            cwe.word_label,
            cwe.state,
            cwe.pot_center,
            cwe.pot_radius,
            cwe.emg_reference,
            cwe.quality_score,
            cwe.capture_count,
            cwe.capture_metadata,
            cwe.calibrated_at
        FROM calibration_word_entries cwe
        INNER JOIN calibration_profiles cp
            ON cp.calibration_id = cwe.calibration_id
        WHERE cp.user_id = ?
          AND cp.calibration_id = ?
        ORDER BY cwe.word_label
        `,
        [userId, calibrationId]
    );

    return rows;
};

/**
 * Neutral baseline for a profile, scoped to the owning user via join.
 */
const getNeutralBaselineForUserProfile = async (userId, calibrationId) => {
    const [rows] = await pool.query(
        `
        SELECT
            cnb.baseline_adc,
            cnb.noise_floor,
            cnb.emg_std,
            cnb.pot_mean,
            cnb.sample_count
        FROM calibration_neutral_baseline cnb
        INNER JOIN calibration_profiles cp
            ON cp.calibration_id = cnb.calibration_id
        WHERE cp.user_id = ?
          AND cp.calibration_id = ?
        LIMIT 1
        `,
        [userId, calibrationId]
    );

    return rows[0] || null;
};

const getLatestProfileVersion = async (userId) => {
    const [rows] = await pool.query(
        `
        SELECT COALESCE(MAX(profile_version), 0) AS version
        FROM calibration_profiles
        WHERE user_id = ?
        `,
        [userId]
    );
    return Number(rows[0].version || 0);
};

const archiveActiveProfiles = async (connection, userId) => {
    await connection.query(
        `
        UPDATE calibration_profiles
        SET is_active = FALSE, status = 'archived'
        WHERE user_id = ?
          AND is_active = TRUE
        `,
        [userId]
    );
};

const createActiveProfile = async (
    connection,
    userId,
    { profileVersion, modelSha256, baselineValue = 0, thresholdLevel = 0.15 }
) => {
    const [result] = await connection.query(
        `
        INSERT INTO calibration_profiles (
            user_id,
            profile_version,
            model_sha256,
            status,
            baseline_value,
            threshold_level,
            calibration_data,
            is_active
        )
        VALUES (?, ?, ?, 'active', ?, ?, NULL, TRUE)
        `,
        [userId, profileVersion, modelSha256, baselineValue, thresholdLevel]
    );
    return result.insertId;
};

const copyNeutralBaseline = async (connection, fromCalibrationId, toCalibrationId) => {
    await connection.query(
        `
        INSERT INTO calibration_neutral_baseline (
            calibration_id,
            baseline_adc,
            noise_floor,
            emg_std,
            pot_mean,
            sample_count
        )
        SELECT
            ?,
            baseline_adc,
            noise_floor,
            emg_std,
            pot_mean,
            sample_count
        FROM calibration_neutral_baseline
        WHERE calibration_id = ?
        `,
        [toCalibrationId, fromCalibrationId]
    );
};

const copyWordEntries = async (connection, fromCalibrationId, toCalibrationId) => {
    await connection.query(
        `
        INSERT INTO calibration_word_entries (
            calibration_id,
            word_label,
            state,
            pot_center,
            pot_radius,
            emg_reference,
            quality_score,
            capture_count,
            capture_metadata,
            calibrated_at
        )
        SELECT
            ?,
            word_label,
            state,
            pot_center,
            pot_radius,
            emg_reference,
            quality_score,
            capture_count,
            capture_metadata,
            calibrated_at
        FROM calibration_word_entries
        WHERE calibration_id = ?
        `,
        [toCalibrationId, fromCalibrationId]
    );
};

const cloneProfileForRecalibration = async (userId, activeProfile) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await archiveActiveProfiles(connection, userId);

        const nextVersion = Number(activeProfile.profile_version || 1) + 1;
        const newCalibrationId = await createActiveProfile(connection, userId, {
            profileVersion: nextVersion,
            modelSha256: activeProfile.model_sha256,
            baselineValue: activeProfile.baseline_value,
            thresholdLevel: activeProfile.threshold_level,
        });

        await copyNeutralBaseline(
            connection,
            activeProfile.calibration_id,
            newCalibrationId
        );
        await copyWordEntries(
            connection,
            activeProfile.calibration_id,
            newCalibrationId
        );

        await connection.commit();
        return getActiveProfileByUserId(userId);
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const ensureActiveProfile = async (userId, modelSha256) => {
    const existing = await getActiveProfileByUserId(userId);
    if (existing) {
        return existing;
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await archiveActiveProfiles(connection, userId);
        const nextVersion = (await getLatestProfileVersion(userId)) + 1;
        const calibrationId = await createActiveProfile(connection, userId, {
            profileVersion: nextVersion,
            modelSha256,
        });
        await connection.commit();
        const [rows] = await pool.query(
            `SELECT * FROM calibration_profiles WHERE calibration_id = ? LIMIT 1`,
            [calibrationId]
        );
        return rows[0];
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const getWordEntry = async (userId, calibrationId, wordLabel) => {
    const [rows] = await pool.query(
        `
        SELECT
            cwe.entry_id,
            cwe.word_label,
            cwe.state,
            cwe.pot_center,
            cwe.pot_radius,
            cwe.emg_reference,
            cwe.quality_score,
            cwe.capture_count,
            cwe.capture_metadata,
            cwe.calibrated_at
        FROM calibration_word_entries cwe
        INNER JOIN calibration_profiles cp
            ON cp.calibration_id = cwe.calibration_id
        WHERE cp.user_id = ?
          AND cp.calibration_id = ?
          AND cwe.word_label = ?
        LIMIT 1
        `,
        [userId, calibrationId, wordLabel]
    );
    return rows[0] || null;
};

const upsertWordEntry = async (
    userId,
    calibrationId,
    {
        wordLabel,
        potCenter,
        potRadius,
        emgReference,
        qualityScore,
        captureCount,
        captureMetadata,
    }
) => {
    const metadataJson = JSON.stringify(captureMetadata || {});
    const emgJson = JSON.stringify(emgReference);

    await pool.query(
        `
        INSERT INTO calibration_word_entries (
            calibration_id,
            word_label,
            state,
            pot_center,
            pot_radius,
            emg_reference,
            quality_score,
            capture_count,
            capture_metadata,
            calibrated_at
        )
        SELECT
            cp.calibration_id,
            ?,
            'calibrated',
            ?,
            ?,
            CAST(? AS JSON),
            ?,
            ?,
            CAST(? AS JSON),
            CURRENT_TIMESTAMP
        FROM calibration_profiles cp
        WHERE cp.calibration_id = ?
          AND cp.user_id = ?
        ON DUPLICATE KEY UPDATE
            state = 'calibrated',
            pot_center = VALUES(pot_center),
            pot_radius = VALUES(pot_radius),
            emg_reference = VALUES(emg_reference),
            quality_score = VALUES(quality_score),
            capture_count = VALUES(capture_count),
            capture_metadata = VALUES(capture_metadata),
            calibrated_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        `,
        [
            wordLabel,
            potCenter,
            potRadius,
            emgJson,
            qualityScore,
            captureCount,
            metadataJson,
            calibrationId,
            userId,
        ]
    );

    return getWordEntry(userId, calibrationId, wordLabel);
};

const updateProfileModelSha = async (userId, calibrationId, modelSha256) => {
    await pool.query(
        `
        UPDATE calibration_profiles cp
        SET model_sha256 = ?
        WHERE cp.calibration_id = ?
          AND cp.user_id = ?
        `,
        [modelSha256, calibrationId, userId]
    );
};

const upsertNeutralBaseline = async (
    userId,
    calibrationId,
    { baselineAdc, noiseFloor, emgStd, potMean, sampleCount }
) => {
    await pool.query(
        `
        INSERT INTO calibration_neutral_baseline (
            calibration_id,
            baseline_adc,
            noise_floor,
            emg_std,
            pot_mean,
            sample_count
        )
        SELECT
            cp.calibration_id,
            ?,
            ?,
            ?,
            ?,
            ?
        FROM calibration_profiles cp
        WHERE cp.calibration_id = ?
          AND cp.user_id = ?
        ON DUPLICATE KEY UPDATE
            baseline_adc = VALUES(baseline_adc),
            noise_floor = VALUES(noise_floor),
            emg_std = VALUES(emg_std),
            pot_mean = VALUES(pot_mean),
            sample_count = VALUES(sample_count)
        `,
        [
            baselineAdc,
            noiseFloor,
            emgStd,
            potMean,
            sampleCount,
            calibrationId,
            userId,
        ]
    );

    return getNeutralBaselineForUserProfile(userId, calibrationId);
};

module.exports = {
    getActiveProfileByUserId,
    getWordEntriesForUserProfile,
    getNeutralBaselineForUserProfile,
    getLatestProfileVersion,
    ensureActiveProfile,
    cloneProfileForRecalibration,
    getWordEntry,
    upsertWordEntry,
    updateProfileModelSha,
    upsertNeutralBaseline,
};
