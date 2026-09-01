/**
 * Phase 1 personalized calibration schema tests.
 *
 * Requires Phase 1 migration to be applied against the configured MySQL database.
 */

const assert = require("node:assert/strict");
const { before, describe, it } = require("node:test");

require("dotenv").config();

const pool = require("../src/config/db");

describe("Phase 1 personalized calibration database", () => {
    before(async () => {
        const [rows] = await pool.query(
            `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'calibration_profiles'
               AND COLUMN_NAME = 'profile_version'`
        );
        if (Number(rows[0].c) !== 1) {
            throw new Error(
                "Phase 1 migration not applied. Run: node scripts/run-phase1-migration.js"
            );
        }
    });

    it("preserves all calibration_profiles rows and JSON", async () => {
        const [profiles] = await pool.query(
            `SELECT calibration_id, calibration_data
             FROM calibration_profiles
             ORDER BY calibration_id`
        );
        assert.ok(profiles.length >= 6);

        const withJson = profiles.filter((row) => row.calibration_data);
        assert.ok(withJson.length >= 3);

        const parsed = JSON.parse(withJson[withJson.length - 1].calibration_data);
        assert.ok(Array.isArray(parsed.words));
        assert.ok(parsed.wordProfiles);
    });

    it("stores normalized word entries without fabricated emg_reference", async () => {
        const [rows] = await pool.query(
            `SELECT word_label, pot_center, pot_radius, emg_reference, state, capture_metadata
             FROM calibration_word_entries
             WHERE calibration_id = 6
             ORDER BY word_label`
        );

        assert.equal(rows.length, 4);
        assert.ok(rows.every((row) => row.state === "calibrated"));
        assert.ok(rows.every((row) => row.emg_reference == null));

        const help = rows.find((row) => row.word_label === "help");
        assert.ok(help.pot_center != null);

        const metadata =
            typeof help.capture_metadata === "string"
                ? JSON.parse(help.capture_metadata)
                : help.capture_metadata;
        assert.equal(
            metadata.emgReferenceNote,
            "Existing profile does not contain a compatible 96-dimensional reference."
        );
    });

    it("enforces user ownership through calibration_profiles FK chain", async () => {
        const [rows] = await pool.query(
            `SELECT cp.user_id, cwe.word_label
             FROM calibration_word_entries cwe
             INNER JOIN calibration_profiles cp ON cwe.calibration_id = cp.calibration_id
             WHERE cp.calibration_id = 6`
        );

        assert.ok(rows.length >= 4);
        assert.ok(rows.every((row) => Number(row.user_id) === 7));
    });

    it("supports archived and active profile versions per user", async () => {
        const [rows] = await pool.query(
            `SELECT profile_version, status, is_active
             FROM calibration_profiles
             WHERE user_id = 7
             ORDER BY profile_version`
        );

        assert.equal(rows.length, 3);
        assert.equal(rows[0].status, "archived");
        assert.equal(rows[2].status, "active");
        assert.equal(Number(rows[2].profile_version), 3);
    });

    it("stores neutral baseline separately from JSON blob", async () => {
        const [rows] = await pool.query(
            `SELECT baseline_adc, noise_floor, emg_std, pot_mean, sample_count
             FROM calibration_neutral_baseline
             WHERE calibration_id = 6`
        );

        assert.equal(rows.length, 1);
        assert.ok(rows[0].sample_count != null);
        assert.ok(rows[0].emg_std != null);
    });

    it("isolates word entries by profile owner (User A cannot see User B words via join)", async () => {
        const [user7] = await pool.query(
            `SELECT cwe.word_label
             FROM calibration_word_entries cwe
             INNER JOIN calibration_profiles cp ON cwe.calibration_id = cp.calibration_id
             WHERE cp.user_id = 7 AND cp.is_active = 1`
        );
        const [user3] = await pool.query(
            `SELECT cwe.word_label
             FROM calibration_word_entries cwe
             INNER JOIN calibration_profiles cp ON cwe.calibration_id = cp.calibration_id
             WHERE cp.user_id = 3 AND cp.is_active = 1`
        );

        assert.ok(user7.length >= 4);
        assert.equal(user3.length, 0);

        const [crossLeak] = await pool.query(
            `SELECT COUNT(*) AS c
             FROM calibration_word_entries cwe
             INNER JOIN calibration_profiles cp ON cwe.calibration_id = cp.calibration_id
             WHERE cp.user_id = 3
               AND cwe.word_label IN ('help', 'no', 'pain', 'stop')`
        );
        assert.equal(Number(crossLeak[0].c), 0);
    });
});
