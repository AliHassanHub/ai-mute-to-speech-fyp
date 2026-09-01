/**
 * Live DB verification for session word_count refresh.
 * Run from server/: node scripts/verify-session-word-count.js
 */
require("dotenv").config();

const assert = require("node:assert/strict");
const stubAiService = require("../tests/helpers/stubAiService");
const { makeRows } = require("../tests/helpers/testApp");
const pool = require("../src/config/db");
const sessionModel = require("../src/models/sessionModel");
const inferenceService = require("../src/services/inferenceService");
const aiServiceConfig = require("../src/config/aiService");

const SESSION_ID = 7;
const USER_ID = 10000;
const MIN_WINDOW = 768;

async function readSessionStats() {
    const [[session]] = await pool.query(
        `SELECT session_id, status, word_count, average_confidence
         FROM sessions
         WHERE session_id = ?`,
        [SESSION_ID]
    );

    const [[counts]] = await pool.query(
        `SELECT COUNT(tr.text_id) AS text_result_count,
                ROUND(AVG(tr.confidence_score), 2) AS average_confidence
         FROM emg_recordings er
         INNER JOIN processed_recordings pr
             ON pr.recording_id = er.recording_id
         INNER JOIN text_results tr
             ON tr.processed_id = pr.processed_id
         WHERE er.session_id = ?`,
        [SESSION_ID]
    );

    return { session, counts };
}

async function main() {
    const before = await readSessionStats();
    assert.equal(before.session.status, "active");

    const stub = await stubAiService.start();
    const previousAiUrl = process.env.AI_SERVICE_URL;
    process.env.AI_SERVICE_URL = stub.baseUrl;
    aiServiceConfig.baseUrl = stub.baseUrl;
    stub.setMode("pain");

    try {
        const result = await inferenceService.persistWordPrediction(USER_ID, {
            rows: makeRows(MIN_WINDOW, { pot: 72 }),
            durationMs: 15360,
            deviceName: before.session.device_name || "ESP32_EMG_SENSOR",
        });

        assert.equal(result.persisted, true);
        assert.ok(result.textId);

        const after = await readSessionStats();

        console.log(
            JSON.stringify(
                {
                    before: {
                        word_count: before.session.word_count,
                        text_result_count: Number(before.counts.text_result_count),
                        average_confidence: before.session.average_confidence,
                    },
                    after: {
                        word_count: after.session.word_count,
                        text_result_count: Number(after.counts.text_result_count),
                        average_confidence: after.session.average_confidence,
                    },
                    savedTextId: result.textId,
                },
                null,
                2
            )
        );

        assert.equal(
            after.session.word_count,
            Number(before.counts.text_result_count) + 1,
            "word_count should increase by one after a new save"
        );
        assert.equal(
            after.session.word_count,
            Number(after.counts.text_result_count),
            "word_count should match persisted text_results count"
        );
        assert.ok(
            after.session.average_confidence != null,
            "average_confidence should be populated after save"
        );
    } finally {
        await stub.stop();
        process.env.AI_SERVICE_URL = previousAiUrl;
        aiServiceConfig.baseUrl = previousAiUrl;
        await pool.end();
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
