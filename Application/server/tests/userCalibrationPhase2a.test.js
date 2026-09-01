/**
 * Phase 2A personalized calibration data-flow tests.
 */

const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, it } = require("node:test");

const stubAiService = require("./helpers/stubAiService");
const testApp = require("./helpers/testApp");
const calibrationProfileModel = require("../src/models/calibrationProfileModel");
const userCalibrationService = require("../src/services/userCalibrationService");

const HEALTH_SHA =
    "28655d4f5084e2ffbfc2d8e1e46ea0eb703f474aca0fb651b1d83e52bdf7f7a8";

const MIN_WINDOW = 768;

function predictBody(rows, extra = {}) {
    return {
        signal: { format: "samples", rows },
        ...extra,
    };
}

let stub;
let app;
let aiServiceConfig;
let originalGetActiveProfile;
let originalGetWordEntries;
let originalGetNeutral;

before(async () => {
    stub = await stubAiService.start();
    process.env.AI_SERVICE_URL = stub.baseUrl;
    app = await testApp.start();
    aiServiceConfig = require("../src/config/aiService");
    aiServiceConfig.baseUrl = stub.baseUrl;

    originalGetActiveProfile =
        calibrationProfileModel.getActiveProfileByUserId;
    originalGetWordEntries =
        calibrationProfileModel.getWordEntriesForUserProfile;
    originalGetNeutral =
        calibrationProfileModel.getNeutralBaselineForUserProfile;
});

after(async () => {
    calibrationProfileModel.getActiveProfileByUserId = originalGetActiveProfile;
    calibrationProfileModel.getWordEntriesForUserProfile =
        originalGetWordEntries;
    calibrationProfileModel.getNeutralBaselineForUserProfile =
        originalGetNeutral;
    await app.stop();
    await stub.stop();
});

beforeEach(() => {
    stub.reset();
    userCalibrationService.clearCache();
    require("../src/services/mlService").resetModelVersionCache();
    require("../src/services/aiSessionStore").clearAll();
    aiServiceConfig.baseUrl = stub.baseUrl;
});

function stubProfileForUser(userId, { painPot = 10, helpPot = null } = {}) {
    calibrationProfileModel.getActiveProfileByUserId = async (id) => {
        if (Number(id) !== Number(userId)) {
            return null;
        }
        return {
            calibration_id: Number(userId) * 10,
            user_id: Number(userId),
            profile_version: 2,
            model_sha256: HEALTH_SHA,
            status: "active",
            is_active: true,
        };
    };

    calibrationProfileModel.getWordEntriesForUserProfile = async (
        id,
        calibrationId
    ) => {
        if (
            Number(id) !== Number(userId) ||
            Number(calibrationId) !== Number(userId) * 10
        ) {
            return [];
        }

        const entries = [
            {
                word_label: "pain",
                state: "calibrated",
                pot_center: painPot,
                pot_radius: 2.0,
                emg_reference: null,
                quality_score: null,
                capture_count: 200,
                capture_metadata: null,
                calibrated_at: new Date(),
            },
            {
                word_label: "medical",
                state: "pending",
                pot_center: null,
                pot_radius: null,
                emg_reference: null,
                quality_score: null,
                capture_count: 0,
                capture_metadata: null,
                calibrated_at: null,
            },
        ];

        if (helpPot != null) {
            entries.push({
                word_label: "help",
                state: "calibrated",
                pot_center: helpPot,
                pot_radius: 2.0,
                emg_reference: null,
                quality_score: null,
                capture_count: 180,
                capture_metadata: null,
                calibrated_at: new Date(),
            });
        }

        return entries;
    };

    calibrationProfileModel.getNeutralBaselineForUserProfile = async (
        id,
        calibrationId
    ) => {
        if (
            Number(id) !== Number(userId) ||
            Number(calibrationId) !== Number(userId) * 10
        ) {
            return null;
        }
        return {
            baseline_adc: 60.0,
            noise_floor: 12.0,
            emg_std: 4.0,
            pot_mean: 35.0,
            sample_count: 300,
        };
    };
}

describe("Phase 2A user calibration service", () => {
    it("returns no profile context for users without calibration", async () => {
        calibrationProfileModel.getActiveProfileByUserId = async () => null;

        const resolved = await userCalibrationService.resolveForUser(4242);
        assert.equal(resolved.context, null);
        assert.equal(resolved.meta.applied, false);
        assert.equal(resolved.meta.reason, "no-profile");
    });

    it("builds wire payload with partial calibrated words only", async () => {
        stubProfileForUser(4242, { painPot: 10 });

        const resolved = await userCalibrationService.resolveForUser(4242);
        assert.ok(resolved.context);
        assert.equal(resolved.context.words.pain.potCenter, 10);
        assert.equal(resolved.context.words.medical.state, "pending");
        assert.deepEqual(resolved.meta.calibratedWords, ["pain"]);
        assert.deepEqual(resolved.meta.potPersonalizedWords, ["pain"]);
        assert.deepEqual(resolved.meta.emgReferenceWords, []);
    });

    it("requires profile SHA to match active model SHA", async () => {
        stubProfileForUser(4242, { painPot: 10 });
        calibrationProfileModel.getActiveProfileByUserId = async () => ({
            calibration_id: 60,
            user_id: 4242,
            profile_version: 2,
            model_sha256: "deadbeef".repeat(8),
            status: "active",
            is_active: true,
        });

        const resolved = await userCalibrationService.resolveForUser(4242);
        assert.equal(resolved.context, null);
        assert.equal(resolved.meta.profileFallbackRequired, true);
        assert.equal(resolved.meta.applied, false);
    });
});

describe("Phase 2A inference personalization wiring", () => {
    it("sends userCalibration to Python when profile exists", async () => {
        stubProfileForUser(testApp.TEST_USER.user_id, { painPot: 10 });

        const res = await app.request("POST", "/api/inference/word", {
            body: predictBody(testApp.makeRows(MIN_WINDOW)),
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        const payload = stub.lastRequestTo("/predict");
        assert.ok(payload);
        assert.ok(payload.userCalibration);
        assert.equal(payload.userCalibration.words.pain.potCenter, 10);
        assert.ok(res.body.meta.personalization);
        assert.equal(res.body.meta.personalization.applied, true);
    });

    it("omits userCalibration when no profile exists", async () => {
        calibrationProfileModel.getActiveProfileByUserId = async () => null;

        const res = await app.request("POST", "/api/inference/word", {
            body: predictBody(testApp.makeRows(MIN_WINDOW)),
        });

        assert.equal(res.status, 200);
        assert.equal(stub.lastRequestTo("/predict").userCalibration, null);
        assert.equal(res.body.meta.personalization.applied, false);
    });

    it("isolates User A and User B POT personalization", async () => {
        stubProfileForUser(testApp.TEST_USER.user_id, { painPot: 10 });
        const resA = await app.request("POST", "/api/inference/word", {
            body: predictBody(testApp.makeRows(MIN_WINDOW)),
        });
        const potA = stub.lastRequestTo("/predict").userCalibration.words.pain
            .potCenter;

        stub.reset();
        userCalibrationService.clearCache();
        stubProfileForUser(testApp.OTHER_USER.user_id, { painPot: 12 });
        const resB = await app.request("POST", "/api/inference/word", {
            body: predictBody(testApp.makeRows(MIN_WINDOW)),
            token: app.tokenFor(testApp.OTHER_USER),
        });
        const potB = stub.lastRequestTo("/predict").userCalibration.words.pain
            .potCenter;

        assert.equal(potA, 10);
        assert.equal(potB, 12);
        assert.equal(resA.status, 200);
        assert.equal(resB.status, 200);
    });

    it("never trusts client-supplied calibration identifiers", async () => {
        stubProfileForUser(testApp.TEST_USER.user_id, { painPot: 10 });

        const res = await app.request("POST", "/api/inference/word", {
            body: predictBody(testApp.makeRows(MIN_WINDOW), {
                userId: testApp.OTHER_USER.user_id,
                calibrationId: 99999,
            }),
        });

        assert.equal(res.status, 200);
        assert.equal(
            stub.lastRequestTo("/predict").userCalibration.words.pain.potCenter,
            10
        );
    });
});
