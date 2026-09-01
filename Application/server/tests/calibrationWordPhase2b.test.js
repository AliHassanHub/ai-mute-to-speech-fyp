/**
 * Phase 2B per-word calibration tests.
 */

const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, it } = require("node:test");

require("dotenv").config();

const stubAiService = require("./helpers/stubAiService");
const testApp = require("./helpers/testApp");
const pool = require("../src/config/db");
const calibrationProfileModel = require("../src/models/calibrationProfileModel");
const calibrationWordService = require("../src/services/calibrationWordService");
const userCalibrationService = require("../src/services/userCalibrationService");

const MIN_CAPTURES = 8;
const MIN_SAMPLES = 100;
const HEALTH_SHA =
    "28655d4f5084e2ffbfc2d8e1e46ea0eb703f474aca0fb651b1d83e52bdf7f7a8";

function makeCapture(pot = 10, emgBase = 1200) {
    const rows = [];
    for (let i = 0; i < MIN_SAMPLES; i += 1) {
        rows.push({
            emg: emgBase + Math.round(120 * Math.sin(i / 7)),
            pot: pot + (i % 3 === 0 ? 0.2 : 0),
        });
    }
    return { signal: { format: "samples", rows } };
}

function makeCaptureBatch(count, pot) {
    return Array.from({ length: count }, () => makeCapture(pot));
}

let stub;
let app;
let aiServiceConfig;
let schemaReady = false;

async function cleanupUserCalibration(userId) {
    await pool.query(
        `DELETE cwe FROM calibration_word_entries cwe
         INNER JOIN calibration_profiles cp ON cp.calibration_id = cwe.calibration_id
         WHERE cp.user_id = ?`,
        [userId]
    );
    await pool.query(
        `DELETE cnb FROM calibration_neutral_baseline cnb
         INNER JOIN calibration_profiles cp ON cp.calibration_id = cnb.calibration_id
         WHERE cp.user_id = ?`,
        [userId]
    );
    await pool.query(`DELETE FROM calibration_profiles WHERE user_id = ?`, [userId]);
}

async function ensureTestUsers() {
    await pool.query(
        `INSERT INTO users (user_id, name, email, password_hash, is_active, email_verified)
         VALUES
           (?, 'QA Test User', 'qa.ai.phase2@example.test', 'test-hash', 1, 1),
           (?, 'Other QA User', 'other.user@example.test', 'test-hash', 1, 1)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           email = VALUES(email),
           is_active = 1`,
        [testApp.TEST_USER.user_id, testApp.OTHER_USER.user_id]
    );
}

before(async () => {
    stub = await stubAiService.start();
    process.env.AI_SERVICE_URL = stub.baseUrl;
    app = await testApp.start();
    aiServiceConfig = require("../src/config/aiService");
    aiServiceConfig.baseUrl = stub.baseUrl;

    const [rows] = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'calibration_word_entries'
           AND COLUMN_NAME = 'emg_reference'`
    );
    schemaReady = Number(rows[0].c) === 1;
    if (schemaReady) {
        await ensureTestUsers();
    }
});

after(async () => {
    if (schemaReady) {
        await cleanupUserCalibration(testApp.TEST_USER.user_id);
        await cleanupUserCalibration(testApp.OTHER_USER.user_id);
    }
    await app.stop();
    await stub.stop();
});

beforeEach(async () => {
    stub.reset();
    calibrationWordService.clearIdempotencyCache();
    userCalibrationService.clearCache();
    aiServiceConfig.baseUrl = stub.baseUrl;
    if (schemaReady) {
        await cleanupUserCalibration(testApp.TEST_USER.user_id);
        await cleanupUserCalibration(testApp.OTHER_USER.user_id);
    }
});

describe("Phase 2B calibration word service (unit)", () => {
    it("rejects unknown vocabulary words", async () => {
        await assert.rejects(
            () =>
                calibrationWordService.calibrateWord(testApp.TEST_USER.user_id, {
                    word: "not-a-real-word",
                    captures: makeCaptureBatch(MIN_CAPTURES),
                }),
            (error) => error.code === "CALIBRATION_UNKNOWN_WORD"
        );
    });

    it("rejects too few captures", async () => {
        await assert.rejects(
            () =>
                calibrationWordService.calibrateWord(testApp.TEST_USER.user_id, {
                    word: "pain",
                    captures: makeCaptureBatch(2),
                }),
            (error) => error.code === "CALIBRATION_INSUFFICIENT_CAPTURES"
        );
    });
});

describe("Phase 2B calibration API wiring", () => {
    it("requires authentication", async () => {
        const res = await app.request("POST", "/api/calibration/word", {
            body: {
                word: "pain",
                captures: makeCaptureBatch(MIN_CAPTURES),
            },
            token: null,
        });
        assert.equal(res.status, 401);
    });

    it("validates capture payload shape", async () => {
        const res = await app.request("POST", "/api/calibration/word", {
            body: { word: "pain", captures: [] },
        });
        assert.equal(res.status, 400);
    });
});

describe("Phase 2B database integration", () => {
    before(async () => {
        if (!schemaReady) {
            throw new Error(
                "Phase 1 migration not applied. Run: node scripts/run-phase1-migration.js"
            );
        }
    });

    it("saves a real EMG reference for one word", async () => {
        const res = await app.request("POST", "/api/calibration/word", {
            body: {
                word: "pain",
                captures: makeCaptureBatch(MIN_CAPTURES, 10),
                idempotencyKey: "phase2b-pain-initial",
            },
        });

        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal(res.body.success, true);
        assert.equal(res.body.word, "pain");
        assert.equal(res.body.state, "calibrated");
        assert.equal(res.body.featureDimension, 203);
        assert.equal(res.body.personalizationReady, true);

        const profile = await calibrationProfileModel.getActiveProfileByUserId(
            testApp.TEST_USER.user_id
        );
        assert.ok(profile);
        assert.equal(profile.model_sha256, HEALTH_SHA);

        const entry = await calibrationProfileModel.getWordEntry(
            testApp.TEST_USER.user_id,
            profile.calibration_id,
            "pain"
        );
        assert.equal(entry.state, "calibrated");
        assert.ok(entry.emg_reference);
        const reference =
            typeof entry.emg_reference === "string"
                ? JSON.parse(entry.emg_reference)
                : entry.emg_reference;
        assert.equal(reference.length, 203);
        assert.ok(Math.abs(Number(entry.pot_center) - 10) < 0.5);
    });

    it("incrementally calibrates help without changing pain", async () => {
        await app.request("POST", "/api/calibration/word", {
            body: {
                word: "pain",
                captures: makeCaptureBatch(MIN_CAPTURES, 10),
                idempotencyKey: "phase2b-pain-base",
            },
        });

        const before = await calibrationProfileModel.getActiveProfileByUserId(
            testApp.TEST_USER.user_id
        );
        const painBefore = await calibrationProfileModel.getWordEntry(
            testApp.TEST_USER.user_id,
            before.calibration_id,
            "pain"
        );

        const res = await app.request("POST", "/api/calibration/word", {
            body: {
                word: "help",
                captures: makeCaptureBatch(MIN_CAPTURES, 39),
                idempotencyKey: "phase2b-help-initial",
            },
        });
        assert.equal(res.status, 200);

        const after = await calibrationProfileModel.getActiveProfileByUserId(
            testApp.TEST_USER.user_id
        );
        assert.equal(after.calibration_id, before.calibration_id);

        const painAfter = await calibrationProfileModel.getWordEntry(
            testApp.TEST_USER.user_id,
            after.calibration_id,
            "pain"
        );
        const helpAfter = await calibrationProfileModel.getWordEntry(
            testApp.TEST_USER.user_id,
            after.calibration_id,
            "help"
        );

        assert.deepEqual(painAfter.emg_reference, painBefore.emg_reference);
        assert.equal(helpAfter.state, "calibrated");
        assert.ok(helpAfter.emg_reference);
    });

    it("isolates User A and User B references", async () => {
        await app.request("POST", "/api/calibration/word", {
            body: {
                word: "pain",
                captures: makeCaptureBatch(MIN_CAPTURES, 10),
                idempotencyKey: "phase2b-user-a-pain",
            },
        });

        await app.request("POST", "/api/calibration/word", {
            body: {
                word: "pain",
                captures: makeCaptureBatch(MIN_CAPTURES, 12),
                idempotencyKey: "phase2b-user-b-pain",
            },
            token: app.tokenFor(testApp.OTHER_USER),
        });

        const profileA = await calibrationProfileModel.getActiveProfileByUserId(
            testApp.TEST_USER.user_id
        );
        const profileB = await calibrationProfileModel.getActiveProfileByUserId(
            testApp.OTHER_USER.user_id
        );
        const painA = await calibrationProfileModel.getWordEntry(
            testApp.TEST_USER.user_id,
            profileA.calibration_id,
            "pain"
        );
        const painB = await calibrationProfileModel.getWordEntry(
            testApp.OTHER_USER.user_id,
            profileB.calibration_id,
            "pain"
        );

        assert.notDeepEqual(painA.emg_reference, painB.emg_reference);
        assert.ok(Math.abs(Number(painA.pot_center) - 10) < 0.5);
        assert.ok(Math.abs(Number(painB.pot_center) - 12) < 0.5);
    });

    it("replays idempotent calibration requests safely", async () => {
        const body = {
            word: "no",
            captures: makeCaptureBatch(MIN_CAPTURES, 27),
            idempotencyKey: "phase2b-no-idempotent",
        };
        const first = await app.request("POST", "/api/calibration/word", { body });
        const second = await app.request("POST", "/api/calibration/word", { body });
        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.equal(second.body.idempotentReplay, true);
    });

    it("exposes profile word states via GET /api/calibration/profile", async () => {
        await app.request("POST", "/api/calibration/word", {
            body: {
                word: "pain",
                captures: makeCaptureBatch(MIN_CAPTURES, 10),
                idempotencyKey: "phase2b-profile-pain",
            },
        });

        const res = await app.request("GET", "/api/calibration/profile");
        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.ok(res.body.words.some((item) => item.word === "pain"));
        assert.ok(
            res.body.words.find((item) => item.word === "pain").hasEmgReference
        );
    });

    it("enforces unique (calibration_id, word_label)", async () => {
        await app.request("POST", "/api/calibration/word", {
            body: {
                word: "stop",
                captures: makeCaptureBatch(MIN_CAPTURES, 15),
                idempotencyKey: "phase2b-stop-unique",
            },
        });

        const profile = await calibrationProfileModel.getActiveProfileByUserId(
            testApp.TEST_USER.user_id
        );
        const [rows] = await pool.query(
            `SELECT word_label, COUNT(*) AS c
             FROM calibration_word_entries
             WHERE calibration_id = ?
             GROUP BY word_label
             HAVING c > 1`,
            [profile.calibration_id]
        );
        assert.equal(rows.length, 0);
    });
});
