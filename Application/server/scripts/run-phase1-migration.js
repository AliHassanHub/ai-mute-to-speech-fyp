/**
 * Phase 1 personalized calibration database migration.
 *
 * - Backs up calibration_profiles before changes
 * - Applies schema migration (001)
 * - Migrates existing calibration_data JSON into normalized tables
 * - Idempotent: skips if profile_version column already exists
 *
 * Usage: node scripts/run-phase1-migration.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const ROOT = path.join(__dirname, "..", "..");
const MIGRATION_SQL = path.join(
    ROOT,
    "Database",
    "migrations",
    "001_personalized_calibration_phase1.sql"
);
const BACKUP_DIR = path.join(ROOT, "Database", "backups");

function sha256File(filePath) {
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
}

function resolveModelSha256() {
    const candidates = [
        process.env.EMG_AI_MODEL_PATH,
        path.join(
            ROOT,
            "..",
            "EMG_Silent_Speech",
            "training",
            "results",
            "calibrated_word_model_v6.npz"
        ),
        path.join(
            ROOT,
            "..",
            "EMG_Silent_Speech",
            "training",
            "results",
            "calibrated_word_model.npz"
        ),
    ].filter(Boolean);

    for (const candidate of candidates) {
        const resolved = path.resolve(candidate);
        const digest = sha256File(resolved);
        if (digest) {
            return { sha256: digest, path: resolved };
        }
    }

    return { sha256: null, path: null };
}

function parseCalibrationJson(raw) {
    if (!raw || typeof raw !== "string") {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function buildCaptureMetadata(wordProfile, calibrationId) {
    const metadata = {
        migratedFrom: "calibration_data_v1",
        emgMean: wordProfile.emgMean ?? null,
        emgStd: wordProfile.emgStd ?? null,
        potStd: wordProfile.potStd ?? null,
        sampleCount: wordProfile.sampleCount ?? null,
        previewSampleCount: Array.isArray(wordProfile.preview)
            ? wordProfile.preview.length
            : null,
        emgReferenceNote:
            "Existing profile does not contain a compatible 96-dimensional reference.",
    };

    if (metadata.sampleCount != null) {
        const rate = 50;
        metadata.capture_duration_sec = Number(
            (metadata.sampleCount / rate).toFixed(2)
        );
    }

    return metadata;
}

function potRadiusFromStd(potStd) {
    const value = Number(potStd);
    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }
    return Number(value.toFixed(5));
}

async function columnExists(connection, table, column) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS c
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [table, column]
    );
    return Number(rows[0].c) > 0;
}

async function tableExists(connection, table) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS c
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?`,
        [table]
    );
    return Number(rows[0].c) > 0;
}

async function backupCalibrationProfiles(connection) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(
        BACKUP_DIR,
        `calibration_profiles_pre_phase1_${stamp}.json`
    );

    const [rows] = await connection.query(
        `SELECT calibration_id, user_id, baseline_value, threshold_level,
                calibration_data, calibration_date, is_active, created_at
         FROM calibration_profiles
         ORDER BY calibration_id`
    );

    fs.writeFileSync(
        backupPath,
        JSON.stringify(
            {
                exportedAt: new Date().toISOString(),
                database: process.env.DB_NAME,
                rowCount: rows.length,
                rows,
            },
            null,
            2
        ),
        "utf8"
    );

    const [createRows] = await connection.query(
        "SHOW CREATE TABLE calibration_profiles"
    );
    const schemaPath = path.join(
        BACKUP_DIR,
        `calibration_profiles_schema_pre_phase1_${stamp}.sql`
    );
    fs.writeFileSync(schemaPath, `${createRows[0]["Create Table"]};\n`, "utf8");

    return { backupPath, schemaPath, rowCount: rows.length };
}

async function indexExists(connection, table, indexName) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS c
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND INDEX_NAME = ?`,
        [table, indexName]
    );
    return Number(rows[0].c) > 0;
}

function stripSqlComments(sqlText) {
    return sqlText
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
}

async function applySchemaStatements(connection, sqlText) {
    const cleaned = stripSqlComments(sqlText);
    const statements = cleaned
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    for (const statement of statements) {
        const indexMatch = statement.match(
            /^CREATE INDEX\s+(\w+)\s+ON\s+(\w+)/i
        );
        if (indexMatch) {
            const [, indexName, tableName] = indexMatch;
            if (await indexExists(connection, tableName, indexName)) {
                continue;
            }
        }
        await connection.query(statement);
    }
}

async function assignProfileVersions(connection) {
    const [profiles] = await connection.query(
        `SELECT calibration_id, user_id, is_active
         FROM calibration_profiles
         ORDER BY user_id, calibration_id`
    );

    const perUserCounter = new Map();

    for (const profile of profiles) {
        const userId = profile.user_id;
        const nextVersion = (perUserCounter.get(userId) || 0) + 1;
        perUserCounter.set(userId, nextVersion);

        const status = profile.is_active ? "active" : "archived";

        await connection.query(
            `UPDATE calibration_profiles
             SET profile_version = ?, status = ?
             WHERE calibration_id = ?`,
            [nextVersion, status, profile.calibration_id]
        );
    }
}

async function migrateNormalizedRows(connection, modelSha256) {
    const [profiles] = await connection.query(
        `SELECT calibration_id, user_id, baseline_value, threshold_level,
                calibration_data, calibration_date, is_active
         FROM calibration_profiles
         ORDER BY calibration_id`
    );

    const summary = [];

    for (const profile of profiles) {
        const parsed = parseCalibrationJson(profile.calibration_data);
        let neutralInserted = 0;
        let wordsInserted = 0;

        if (modelSha256) {
            await connection.query(
                `UPDATE calibration_profiles
                 SET model_sha256 = COALESCE(model_sha256, ?)
                 WHERE calibration_id = ?`,
                [modelSha256, profile.calibration_id]
            );
        }

        if (parsed?.neutral) {
            const neutral = parsed.neutral;
            await connection.query(
                `INSERT INTO calibration_neutral_baseline (
                    calibration_id, baseline_adc, noise_floor, emg_std, pot_mean, sample_count
                 ) VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    baseline_adc = VALUES(baseline_adc),
                    noise_floor = VALUES(noise_floor),
                    emg_std = VALUES(emg_std),
                    pot_mean = VALUES(pot_mean),
                    sample_count = VALUES(sample_count)`,
                [
                    profile.calibration_id,
                    Number(neutral.emgMean ?? profile.baseline_value ?? 0),
                    Number(profile.threshold_level ?? null),
                    neutral.emgStd != null ? Number(neutral.emgStd) : null,
                    neutral.potMean != null ? Number(neutral.potMean) : null,
                    neutral.sampleCount != null
                        ? Number(neutral.sampleCount)
                        : null,
                ]
            );
            neutralInserted = 1;
        } else if (
            profile.baseline_value != null ||
            profile.threshold_level != null
        ) {
            await connection.query(
                `INSERT INTO calibration_neutral_baseline (
                    calibration_id, baseline_adc, noise_floor, emg_std, pot_mean, sample_count
                 ) VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    baseline_adc = VALUES(baseline_adc),
                    noise_floor = VALUES(noise_floor)`,
                [
                    profile.calibration_id,
                    Number(profile.baseline_value ?? 0),
                    Number(profile.threshold_level ?? null),
                    null,
                    null,
                    null,
                ]
            );
            neutralInserted = 1;
        }

        const wordProfiles = parsed?.wordProfiles ?? {};
        const wordLabels = Object.keys(wordProfiles);

        for (const wordLabel of wordLabels) {
            const wp = wordProfiles[wordLabel] ?? {};
            const captureMetadata = buildCaptureMetadata(
                wp,
                profile.calibration_id
            );

            await connection.query(
                `INSERT INTO calibration_word_entries (
                    calibration_id, word_label, state, pot_center, pot_radius,
                    emg_reference, quality_score, capture_count, capture_metadata, calibrated_at
                 ) VALUES (?, ?, 'calibrated', ?, ?, NULL, NULL, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    state = VALUES(state),
                    pot_center = VALUES(pot_center),
                    pot_radius = VALUES(pot_radius),
                    capture_count = VALUES(capture_count),
                    capture_metadata = VALUES(capture_metadata),
                    calibrated_at = VALUES(calibrated_at)`,
                [
                    profile.calibration_id,
                    wordLabel,
                    wp.potMean != null ? Number(wp.potMean) : null,
                    potRadiusFromStd(wp.potStd),
                    wp.sampleCount != null ? Number(wp.sampleCount) : 1,
                    JSON.stringify(captureMetadata),
                    profile.calibration_date ?? null,
                ]
            );
            wordsInserted += 1;
        }

        summary.push({
            calibrationId: profile.calibration_id,
            userId: profile.user_id,
            neutralInserted,
            wordsInserted,
            hadJsonWords: wordLabels.length,
        });
    }

    return summary;
}

async function main() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
    });

    try {
        const alreadyApplied = await columnExists(
            connection,
            "calibration_profiles",
            "profile_version"
        );

        if (alreadyApplied) {
            console.log(
                "Phase 1 schema already applied (profile_version exists). Skipping DDL."
            );
        } else {
            console.log("Creating backup...");
            const backup = await backupCalibrationProfiles(connection);
            console.log(`Backup saved: ${backup.backupPath}`);
            console.log(`Schema saved: ${backup.schemaPath}`);
            console.log(`Backed up ${backup.rowCount} calibration_profiles rows.`);

            console.log("Applying schema migration...");
            const sql = fs.readFileSync(MIGRATION_SQL, "utf8");
            await applySchemaStatements(connection, sql);
            console.log("Schema migration applied.");
        }

        const model = resolveModelSha256();
        if (model.sha256) {
            console.log(`Model SHA-256 resolved from: ${model.path}`);
        } else {
            console.log(
                "Model artefact not found locally; model_sha256 left NULL for manual binding."
            );
        }

        console.log("Migrating normalized calibration rows...");
        await connection.beginTransaction();
        try {
            await assignProfileVersions(connection);
            const summary = await migrateNormalizedRows(
                connection,
                model.sha256
            );
            await connection.commit();
            console.log("Data migration committed.");
            console.log(JSON.stringify(summary, null, 2));
        } catch (error) {
            await connection.rollback();
            console.error("Data migration rolled back.");
            throw error;
        }

        console.log("Phase 1 migration completed successfully.");
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error("Phase 1 migration failed:", error.message);
    process.exit(1);
});
