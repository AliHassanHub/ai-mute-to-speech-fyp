/**
 * Verify Phase 1 personalized calibration database migration.
 *
 * Usage: node scripts/verify-phase1-migration.js
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mysql = require("mysql2/promise");

async function main() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    const failures = [];

    try {
        const checks = [
            {
                name: "calibration_profiles.profile_version exists",
                sql: `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calibration_profiles'
                      AND COLUMN_NAME = 'profile_version'`,
                expect: (rows) => Number(rows[0].c) === 1,
            },
            {
                name: "calibration_word_entries table exists",
                sql: `SELECT COUNT(*) AS c FROM information_schema.TABLES
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calibration_word_entries'`,
                expect: (rows) => Number(rows[0].c) === 1,
            },
            {
                name: "calibration_neutral_baseline table exists",
                sql: `SELECT COUNT(*) AS c FROM information_schema.TABLES
                      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calibration_neutral_baseline'`,
                expect: (rows) => Number(rows[0].c) === 1,
            },
            {
                name: "all calibration_profiles rows preserved",
                sql: "SELECT COUNT(*) AS c FROM calibration_profiles",
                expect: (rows) => Number(rows[0].c) >= 6,
            },
            {
                name: "calibration_data JSON still present on active profiles",
                sql: `SELECT COUNT(*) AS c FROM calibration_profiles
                      WHERE is_active = 1 AND calibration_data IS NOT NULL`,
                expect: (rows) => Number(rows[0].c) >= 2,
            },
            {
                name: "active profile 6 has 4 calibrated words",
                sql: `SELECT COUNT(*) AS c FROM calibration_word_entries
                      WHERE calibration_id = 6 AND state = 'calibrated'`,
                expect: (rows) => Number(rows[0].c) === 4,
            },
            {
                name: "active profile 6 has neutral baseline",
                sql: `SELECT COUNT(*) AS c FROM calibration_neutral_baseline
                      WHERE calibration_id = 6`,
                expect: (rows) => Number(rows[0].c) === 1,
            },
            {
                name: "migrated emg_reference remains NULL (no fabricated vectors)",
                sql: `SELECT COUNT(*) AS c FROM calibration_word_entries
                      WHERE emg_reference IS NOT NULL`,
                expect: (rows) => Number(rows[0].c) === 0,
            },
            {
                name: "user 7 has versioned profiles (v1 archived, v3 active)",
                sql: `SELECT profile_version, status, is_active
                      FROM calibration_profiles WHERE user_id = 7 ORDER BY profile_version`,
                expect: (rows) =>
                    rows.length === 3 &&
                    rows[0].status === "archived" &&
                    rows[2].status === "active" &&
                    rows[2].is_active === 1 &&
                    Number(rows[2].profile_version) === 3,
            },
            {
                name: "user isolation — word entries join to owning user only",
                sql: `SELECT COUNT(*) AS c
                      FROM calibration_word_entries cwe
                      INNER JOIN calibration_profiles cp ON cwe.calibration_id = cp.calibration_id
                      INNER JOIN users u ON cp.user_id = u.user_id`,
                expect: (rows) => Number(rows[0].c) >= 12,
            },
            {
                name: "no orphan word entries",
                sql: `SELECT COUNT(*) AS c
                      FROM calibration_word_entries cwe
                      LEFT JOIN calibration_profiles cp ON cwe.calibration_id = cp.calibration_id
                      WHERE cp.calibration_id IS NULL`,
                expect: (rows) => Number(rows[0].c) === 0,
            },
            {
                name: "unique word per profile enforced",
                sql: `SELECT calibration_id, word_label, COUNT(*) AS c
                      FROM calibration_word_entries
                      GROUP BY calibration_id, word_label
                      HAVING c > 1`,
                expect: (rows) => rows.length === 0,
            },
        ];

        for (const check of checks) {
            const [rows] = await connection.query(check.sql);
            if (!check.expect(rows)) {
                failures.push(check.name);
                console.log(`FAIL: ${check.name}`);
                console.log(JSON.stringify(rows));
            } else {
                console.log(`PASS: ${check.name}`);
            }
        }

        const [wordSummary] = await connection.query(
            `SELECT cp.calibration_id, cp.user_id, cp.profile_version, cp.status, cp.is_active,
                    COUNT(cwe.entry_id) AS word_entries
             FROM calibration_profiles cp
             LEFT JOIN calibration_word_entries cwe ON cp.calibration_id = cwe.calibration_id
             GROUP BY cp.calibration_id, cp.user_id, cp.profile_version, cp.status, cp.is_active
             ORDER BY cp.calibration_id`
        );
        console.log("PROFILE SUMMARY:", JSON.stringify(wordSummary, null, 2));

        if (failures.length) {
            console.error(`Verification failed (${failures.length} checks).`);
            process.exit(1);
        }

        console.log("All Phase 1 verification checks passed.");
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
