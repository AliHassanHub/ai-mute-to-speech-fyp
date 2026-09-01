/**
 * Word prediction persistence tests.
 *
 * Exercises POST /api/inference/word/persist with mocked database writes so the
 * full HTTP + service path is covered without a seeded MySQL instance.
 */

const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, it } = require("node:test");

const stubAiService = require("./helpers/stubAiService");
const testApp = require("./helpers/testApp");

let stub;
let app;
let aiServiceConfig;
let sessionModel;
let profileModel;
let calibrationModel;
let historyModel;
let pool;
let inferenceModel;
let originals = {};
let mockState = {
    nextIds: { recordingId: 910, processedId: 920, textId: 930 },
    lastSavedTextId: null,
    persistedTextResultCount: 0,
    sessionWordCount: 0,
    sessionAverageConfidence: null,
};

function resetMockState() {
    mockState.nextIds = { recordingId: 910, processedId: 920, textId: 930 };
    mockState.lastSavedTextId = null;
    mockState.persistedTextResultCount = 0;
    mockState.sessionWordCount = 0;
    mockState.sessionAverageConfidence = null;
}

const MIN_WINDOW = 768;
const ACTIVE_SESSION = {
    session_id: 501,
    user_id: testApp.TEST_USER.user_id,
    status: "active",
    device_name: "ESP32_EMG_SENSOR",
};

function installPersistenceMocks() {
    sessionModel = require("../src/models/sessionModel");
    profileModel = require("../src/models/profileModel");
    calibrationModel = require("../src/models/calibrationModel");
    historyModel = require("../src/models/historyModel");
    pool = require("../src/config/db");
    inferenceModel = require("../src/models/inferenceModel");

    originals = {
        getActiveSessionByUserId: sessionModel.getActiveSessionByUserId,
        createSession: sessionModel.createSession,
        getSessionById: sessionModel.getSessionById,
        getProfileByUserId: profileModel.getProfileByUserId,
        getActiveCalibrationByUserId: calibrationModel.getActiveCalibrationByUserId,
        getHistoryDetails: historyModel.getHistoryDetails,
        getHistoryList: historyModel.getHistoryList,
        getConnection: pool.getConnection,
        insertEmgRecording: inferenceModel.insertEmgRecording,
        insertProcessedRecording: inferenceModel.insertProcessedRecording,
        insertTextResult: inferenceModel.insertTextResult,
    };

    sessionModel.getActiveSessionByUserId = async (userId) => {
        if (Number(userId) === testApp.TEST_USER.user_id) {
            return { ...ACTIVE_SESSION };
        }
        return null;
    };

    sessionModel.createSession = async (userId, deviceName) => {
        assert.equal(userId, testApp.TEST_USER.user_id);
        return ACTIVE_SESSION.session_id;
    };

    sessionModel.getSessionById = async (sessionId) => {
        if (Number(sessionId) === ACTIVE_SESSION.session_id) {
            return {
                ...ACTIVE_SESSION,
                word_count: mockState.sessionWordCount,
                average_confidence: mockState.sessionAverageConfidence,
            };
        }
        return null;
    };

    profileModel.getProfileByUserId = async () => ({
        language: "English",
    });

    calibrationModel.getActiveCalibrationByUserId = async () => ({
        calibration_id: 12,
        baseline_value: 1.0,
        threshold_level: 0.15,
    });

    historyModel.getHistoryDetails = async (userId, textId) => {
        if (
            Number(userId) === testApp.TEST_USER.user_id &&
            mockState.lastSavedTextId &&
            Number(textId) === Number(mockState.lastSavedTextId)
        ) {
            return {
                text_id: mockState.lastSavedTextId,
                session_id: ACTIVE_SESSION.session_id,
                recording_id: mockState.nextIds.recordingId,
                processed_id: mockState.nextIds.processedId,
                recognized_text: "Pain",
                translated_text: "Pain",
                source_language: "English",
                target_language: "English",
                confidence_score: 84,
                processing_time_ms: 23,
            };
        }
        return null;
    };

    historyModel.getHistoryList = async (userId) => {
        if (Number(userId) !== testApp.TEST_USER.user_id || !mockState.lastSavedTextId) {
            return [];
        }

        return [
            {
                text_id: mockState.lastSavedTextId,
                recognized_text: "Pain",
                translated_text: "Pain",
                source_language: "English",
                target_language: "English",
                confidence_score: 84,
                created_at: new Date("2026-08-28T08:00:00.000Z"),
            },
        ];
    };

    pool.getConnection = async () => ({
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async query(sql, params) {
            if (/COUNT\(tr\.text_id\)/i.test(sql)) {
                return [
                    [
                        {
                            word_count: mockState.persistedTextResultCount,
                            average_confidence:
                                mockState.persistedTextResultCount > 0 ? 84 : null,
                        },
                    ],
                ];
            }
            if (/UPDATE sessions/i.test(sql) && /word_count/i.test(sql)) {
                mockState.sessionWordCount = Number(params[0]);
                mockState.sessionAverageConfidence = params[1];
                return [{ affectedRows: 1 }];
            }
            if (/INSERT INTO emg_recordings/i.test(sql)) {
                mockState.nextIds.recordingId += 1;
                return [{ insertId: mockState.nextIds.recordingId }];
            }
            if (/INSERT INTO processed_recordings/i.test(sql)) {
                mockState.nextIds.processedId += 1;
                return [{ insertId: mockState.nextIds.processedId }];
            }
            if (/INSERT INTO text_results/i.test(sql)) {
                mockState.nextIds.textId += 1;
                mockState.lastSavedTextId = mockState.nextIds.textId;
                mockState.persistedTextResultCount += 1;
                return [{ insertId: mockState.nextIds.textId }];
            }
            return [{ insertId: 1 }];
        },
    });
}

function restorePersistenceMocks() {
    for (const [key, value] of Object.entries(originals)) {
        if (key.startsWith("insert") || key === "getConnection") {
            const model = key === "getConnection" ? pool : inferenceModel;
            model[key] = value;
            continue;
        }
        if (key === "getHistoryDetails" || key === "getHistoryList") {
            historyModel[key] = value;
            continue;
        }
        if (key === "getProfileByUserId") {
            profileModel[key] = value;
            continue;
        }
        if (key === "getActiveCalibrationByUserId") {
            calibrationModel[key] = value;
            continue;
        }
        sessionModel[key] = value;
    }
}

before(async () => {
    stub = await stubAiService.start();
    process.env.AI_SERVICE_URL = stub.baseUrl;
    installPersistenceMocks();
    app = await testApp.start();
    aiServiceConfig = require("../src/config/aiService");
    aiServiceConfig.baseUrl = stub.baseUrl;
});

after(async () => {
    restorePersistenceMocks();
    await app.stop();
    await stub.stop();
});

beforeEach(() => {
    stub.reset();
    aiServiceConfig.baseUrl = stub.baseUrl;
    require("../src/services/mlService").resetModelVersionCache();
    require("../src/services/aiSessionStore").clearAll();
    resetMockState();
});

describe("POST /api/inference/word/persist", () => {
    it("requires authentication", async () => {
        const res = await app.request("POST", "/api/inference/word/persist", {
            token: null,
            body: {
                signal: {
                    format: "samples",
                    rows: testApp.makeRows(MIN_WINDOW, { pot: 72 }),
                },
            },
        });

        assert.equal(res.status, 401);
    });

    it("persists a complete window and returns persisted=true", async () => {
        stub.setMode("pain");
        const rows = testApp.makeRows(MIN_WINDOW, { pot: 72 });

        const res = await app.request("POST", "/api/inference/word/persist", {
            body: {
                signal: { format: "samples", rows },
                durationMs: 15360,
            },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.persisted, true);
        assert.ok(res.body.textId);
        assert.ok(res.body.recordingId);
        assert.ok(res.body.processedId);
        assert.equal(res.body.sessionId, ACTIVE_SESSION.session_id);
        assert.equal(res.body.prediction.label, "pain");
        assert.equal(res.body.result.recognizedText, "Pain");
        assert.equal(res.body.result.translatedText, "I am feeling pain.");
        assert.equal(res.body.result.confidenceScore, 84);
        assert.equal(mockState.sessionWordCount, 1);
        assert.equal(mockState.sessionAverageConfidence, 84);
    });

    it("persists Urdu translation when profile target language is Urdu", async () => {
        const originalProfile = profileModel.getProfileByUserId;
        profileModel.getProfileByUserId = async () => ({
            language: "Urdu",
        });

        stub.setMode("pain");
        const rows = testApp.makeRows(MIN_WINDOW, { pot: 72 });

        const res = await app.request("POST", "/api/inference/word/persist", {
            body: {
                signal: { format: "samples", rows },
                durationMs: 15360,
            },
        });

        profileModel.getProfileByUserId = originalProfile;

        assert.equal(res.status, 200);
        assert.equal(res.body.result.recognizedText, "Pain");
        assert.equal(res.body.result.translatedText, "مجھے درد ہو رہا ہے۔");
        assert.equal(res.body.result.targetLanguage, "Urdu");
    });

    it("persists Punjabi translation when profile translation language is Punjabi", async () => {
        const originalProfile = profileModel.getProfileByUserId;
        profileModel.getProfileByUserId = async () => ({
            language: "pa:pa",
        });

        stub.setMode("pain");
        const rows = testApp.makeRows(MIN_WINDOW, { pot: 72 });

        const res = await app.request("POST", "/api/inference/word/persist", {
            body: {
                signal: { format: "samples", rows },
                durationMs: 15360,
            },
        });

        profileModel.getProfileByUserId = originalProfile;

        assert.equal(res.status, 200);
        assert.equal(res.body.result.recognizedText, "Pain");
        assert.equal(res.body.result.translatedText, "مینوں دکھ ہو رہی اے۔");
        assert.equal(res.body.result.targetLanguage, "Punjabi");
        assert.notEqual(res.body.result.translatedText, "مجھے درد ہو رہا ہے۔");
    });

    it("returns the existing record when textId is resent", async () => {
        stub.setMode("pain");
        const rows = testApp.makeRows(MIN_WINDOW, { pot: 72 });

        const first = await app.request("POST", "/api/inference/word/persist", {
            body: { signal: { format: "samples", rows } },
        });
        const second = await app.request("POST", "/api/inference/word/persist", {
            body: {
                signal: { format: "samples", rows },
                textId: first.body.textId,
            },
        });

        assert.equal(second.status, 200);
        assert.equal(second.body.persisted, true);
        assert.equal(second.body.textId, first.body.textId);
        assert.match(second.body.message, /already saved/i);
        assert.equal(mockState.sessionWordCount, 1);
    });

    it("increments word_count for each new successful save", async () => {
        stub.setMode("pain");
        const rows = testApp.makeRows(MIN_WINDOW, { pot: 72 });

        await app.request("POST", "/api/inference/word/persist", {
            body: { signal: { format: "samples", rows } },
        });
        await app.request("POST", "/api/inference/word/persist", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(mockState.sessionWordCount, 2);
        assert.equal(mockState.persistedTextResultCount, 2);
    });

    it("rejects windows that are too short", async () => {
        const res = await app.request("POST", "/api/inference/word/persist", {
            body: {
                signal: {
                    format: "samples",
                    rows: testApp.makeRows(100),
                },
            },
        });

        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
    });
});

describe("GET /api/history after persist", () => {
    it("returns the saved prediction for the authenticated user", async () => {
        stub.setMode("pain");
        const rows = testApp.makeRows(MIN_WINDOW, { pot: 72 });

        const saved = await app.request("POST", "/api/inference/word/persist", {
            body: { signal: { format: "samples", rows } },
        });

        const history = await app.request("GET", "/api/history?page=1&limit=10");

        assert.equal(history.status, 200);
        assert.ok(history.body.history.length >= 1);
        const match = history.body.history.find(
            (item) => Number(item.textId) === Number(saved.body.textId)
        );
        assert.ok(match, "history should include the saved text result");
        assert.equal(match.recognizedText, "Pain");
        assert.equal(match.confidenceScore, 84);
    });

    it("does not expose another user's history", async () => {
        const history = await app.request("GET", "/api/history?page=1&limit=10", {
            token: app.tokenFor(testApp.OTHER_USER),
        });

        assert.equal(history.status, 200);
        assert.equal(history.body.history.length, 0);
    });
});

describe("persistWordPrediction transaction safety", () => {
    it("does not report success when the transaction rolls back", async () => {
        const originalGetConnection = pool.getConnection;
        pool.getConnection = async () => ({
            async beginTransaction() {},
            async commit() {},
            async rollback() {},
            release() {},
            async query() {
                throw new Error("simulated database failure");
            },
        });

        stub.setMode("pain");
        const rows = testApp.makeRows(MIN_WINDOW, { pot: 72 });

        const res = await app.request("POST", "/api/inference/word/persist", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(res.status, 500);
        assert.equal(res.body.success, false);
        assert.notEqual(res.body.persisted, true);
        assert.equal(mockState.sessionWordCount, 0);

        pool.getConnection = originalGetConnection;
    });
});
