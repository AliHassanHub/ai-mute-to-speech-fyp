/**
 * AI Phase 2 backend integration tests.
 *
 * Covers the Node -> Python boundary against a real stub AI server, so transport,
 * timeouts and status mapping are all genuinely exercised. No database writes.
 */

const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, it } = require("node:test");

const stubAiService = require("./helpers/stubAiService");
const testApp = require("./helpers/testApp");

let stub;
let app;
let aiServiceConfig;

const MIN_WINDOW = 768;

before(async () => {
    stub = await stubAiService.start();

    // Point the backend at the stub before anything reads the config.
    process.env.AI_SERVICE_URL = stub.baseUrl;

    app = await testApp.start();
    aiServiceConfig = require("../src/config/aiService");

    // buildUrl() reads baseUrl at call time, so this takes effect immediately.
    aiServiceConfig.baseUrl = stub.baseUrl;
});

after(async () => {
    await app.stop();
    await stub.stop();
});

beforeEach(() => {
    stub.reset();
    aiServiceConfig.baseUrl = stub.baseUrl;
    aiServiceConfig.predictTimeoutMs = 15000;
    aiServiceConfig.healthTimeoutMs = 3000;
    require("../src/services/mlService").resetModelVersionCache();
    require("../src/services/aiSessionStore").clearAll();
});

/* ------------------------------------------------------------------ *
 * 1. AI health success
 * ------------------------------------------------------------------ */
describe("1. AI health", () => {
    it("reports the AI service as available", async () => {
        const res = await app.request("GET", "/api/inference/health");

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.available, true);
        assert.equal(res.body.modelLoaded, true);
        assert.deepEqual(res.body.labels, ["help", "no", "pain", "stop"]);
        assert.equal(res.body.requiredSamples, MIN_WINDOW);
        assert.equal(res.body.sentenceSupported, false);
        assert.equal(res.body.windowAgreement, true);
    });

    it("does not leak internal Python implementation details", async () => {
        const res = await app.request("GET", "/api/inference/health");
        const serialized = JSON.stringify(res.body);

        // Artefact internals have no business reaching a mobile client.
        assert.ok(!("model_sha256" in res.body));
        assert.ok(!("model_path" in res.body));
        assert.ok(!("model_size_bytes" in res.body));
        assert.ok(!serialized.includes("calibrated_word_model.npz"));
        assert.ok(!serialized.includes("28655d4f"));
    });

    it("surfaces a real window disagreement between Node and Python", async () => {
        stub.setMode("health-window-mismatch");
        const res = await app.request("GET", "/api/inference/health");

        assert.equal(res.status, 200);
        assert.equal(res.body.windowAgreement, false);
    });

    it("reports model status from the live service", async () => {
        const res = await app.request("GET", "/api/inference/status");

        assert.equal(res.status, 200);
        assert.equal(res.body.ready, true);
        assert.equal(res.body.modelExists, true);
        // Version is the artefact's own identity, never invented by Node.
        assert.match(res.body.modelVersion, /^calibrated_word_model@[0-9a-f]{12}$/);
    });
});

/* ------------------------------------------------------------------ *
 * 2. AI service unavailable
 * ------------------------------------------------------------------ */
describe("2. AI service unavailable", () => {
    it("returns a clean 503 when nothing is listening", async () => {
        // Port 1 is reserved and never has a listener.
        aiServiceConfig.baseUrl = "http://127.0.0.1:1";

        const res = await app.request("GET", "/api/inference/health");

        assert.equal(res.status, 503);
        assert.equal(res.body.success, false);
        assert.equal(res.body.message, "AI service unavailable");
        assert.equal(res.body.code, "AI_SERVICE_UNAVAILABLE");
    });

    it("never fabricates a prediction when the AI service is down", async () => {
        aiServiceConfig.baseUrl = "http://127.0.0.1:1";

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 503);
        assert.equal(res.body.success, false);
        assert.equal(res.body.code, "AI_SERVICE_UNAVAILABLE");
        assert.ok(!("prediction" in res.body));
    });

    it("reports not-ready model status instead of throwing", async () => {
        aiServiceConfig.baseUrl = "http://127.0.0.1:1";

        const res = await app.request("GET", "/api/inference/status");

        assert.equal(res.status, 200);
        assert.equal(res.body.ready, false);
        assert.equal(res.body.modelExists, false);
        assert.equal(res.body.modelVersion, null);
    });

    it("maps a missing Python model to 503 without exposing the path", async () => {
        stub.setMode("model-missing");

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 503);
        assert.equal(res.body.code, "AI_MODEL_UNAVAILABLE");
        assert.ok(!JSON.stringify(res.body).includes(".npz"));
    });
});

/* ------------------------------------------------------------------ *
 * 3 + 10. Valid 768-sample request / successful prediction
 * ------------------------------------------------------------------ */
describe("3. Valid window and successful prediction", () => {
    it("accepts exactly 768 samples and returns the stable contract", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.ready, true);

        assert.equal(res.body.prediction.label, "help");
        assert.equal(res.body.prediction.bestLabel, "help");
        assert.equal(res.body.prediction.confidence, 0.98);
        assert.equal(res.body.prediction.accepted, true);
        assert.equal(res.body.prediction.distance, 0.016478);
        assert.equal(res.body.prediction.margin, 12.0);

        assert.equal(res.body.meta.samplesUsed, MIN_WINDOW);
        assert.ok(res.body.meta.processingTimeMs >= 0);
        assert.equal(res.body.meta.aiProcessingTimeMs, 3.71);
    });

    it("forwards both EMG and POT to the AI service", async () => {
        const rows = testApp.makeRows(MIN_WINDOW, { pot: 27 });
        await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows } },
        });

        const sent = stub.lastRequestTo("/predict");
        assert.ok(sent, "a /predict call should have been made");
        assert.equal(sent.kind, "word");
        assert.equal(sent.rowCount, MIN_WINDOW);
        assert.equal(typeof sent.firstRow.emg, "number");
        assert.equal(sent.firstRow.pot, 27, "POT must survive the hop to Python");
    });

    it("preserves confidence semantics verbatim", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        // The heuristic must never be relabelled as a probability.
        assert.match(res.body.meta.confidenceBasis, /not a probability/);
        assert.match(res.body.meta.confidenceBasis, /cosine/);
        assert.match(res.body.meta.marginUnit, /potentiometer/);
        assert.ok(!JSON.stringify(res.body).includes("probability\":"));
    });

    it("accepts an optional per-sample timestamp", async () => {
        const rows = testApp.makeRows(MIN_WINDOW, { withTimestamp: true });
        const originalTimestamp = rows[0].timestamp;
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.ready, true);
        // Public payload is unchanged: timestamps stay on the caller's rows.
        assert.equal(rows[0].timestamp, originalTimestamp);
    });

    it("strips timestamp before calling Python and never sends it", async () => {
        const rows = testApp.makeRows(MIN_WINDOW, { withTimestamp: true });
        assert.equal(typeof rows[0].timestamp, "number");

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(res.status, 200);
        const sent = stub.lastRequestTo("/predict");
        assert.ok(sent);
        assert.equal(sent.rowCount, MIN_WINDOW);
        assert.deepEqual(sent.pythonRowKeys, ["emg", "pot"]);
        assert.equal(sent.anyRowHasTimestamp, false);
        assert.equal(Object.prototype.hasOwnProperty.call(sent.firstRow, "timestamp"), false);
        assert.equal(typeof sent.firstRow.emg, "number");
        assert.equal(typeof sent.firstRow.pot, "number");
        // Caller rows still have timestamps after Node handled the request.
        assert.equal(typeof rows[0].timestamp, "number");
    });

    it("sends exactly one Python request for a 768-sample window", async () => {
        await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW, { withTimestamp: true }) } },
        });

        assert.equal(stub.requestsTo("/predict").length, 1);
    });

    it("accepts a window up to the 1800-sample maximum", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(1800) } },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.ready, true);
    });

    it("passes minConfidence through when supplied", async () => {
        await app.request("POST", "/api/inference/word", {
            body: {
                signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) },
                minConfidence: 0.9,
            },
        });

        assert.equal(stub.lastRequestTo("/predict").minConfidence, 0.9);
    });
});

/* ------------------------------------------------------------------ *
 * 4. Fewer than 768 samples
 * ------------------------------------------------------------------ */
describe("4. Insufficient window", () => {
    it("returns a not-ready state without calling Python", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(420) } },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.ready, false);
        assert.equal(res.body.requiredSamples, MIN_WINDOW);
        assert.equal(res.body.receivedSamples, 420);

        // No fabricated label.
        assert.equal(res.body.prediction, null);

        // And crucially, Python was never contacted.
        assert.equal(
            stub.state.requests.filter((r) => r.url === "/predict").length,
            0
        );
    });

    it("refuses a single BLE packet", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(1) } },
        });

        assert.equal(res.body.ready, false);
        assert.equal(res.body.receivedSamples, 1);
        assert.equal(res.body.prediction, null);
        assert.equal(stub.state.requests.length, 0);
    });

    it("refuses 767 samples, one below the boundary", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(767) } },
        });

        assert.equal(res.body.ready, false);
        assert.equal(res.body.receivedSamples, 767);
        assert.equal(stub.state.requests.length, 0);
    });

    it("rejects a window above the stale-buffer limit", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(1801) } },
        });

        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
        assert.equal(stub.state.requests.length, 0);
    });
});

/* ------------------------------------------------------------------ *
 * 5. Malformed rows
 * ------------------------------------------------------------------ */
describe("5. Malformed signal", () => {
    const cases = [
        ["missing signal", {}],
        ["signal not an object", { signal: "samples" }],
        ["missing format", { signal: { rows: [] } }],
        ["wrong format", { signal: { format: "csv", rows: [{ emg: 1, pot: 1 }] } }],
        ["missing rows", { signal: { format: "samples" } }],
        ["rows not an array", { signal: { format: "samples", rows: { emg: 1 } } }],
        ["empty rows", { signal: { format: "samples", rows: [] } }],
        ["row not an object", { signal: { format: "samples", rows: [1, 2, 3] } }],
        ["row is null", { signal: { format: "samples", rows: [null] } }],
    ];

    for (const [name, body] of cases) {
        it(`rejects: ${name}`, async () => {
            const res = await app.request("POST", "/api/inference/word", { body });

            assert.equal(res.status, 400, `${name} -> ${JSON.stringify(res.body)}`);
            assert.equal(res.body.success, false);
            assert.equal(res.body.code, "VALIDATION_ERROR");
            assert.equal(stub.state.requests.length, 0);
        });
    }

    it("rejects NaN and Infinity without repairing them", async () => {
        const bad = [
            { emg: "NaN", pot: 39 },
            { emg: null, pot: 39 },
            { emg: "1234", pot: 39 },
            { emg: true, pot: 39 },
        ];

        for (const row of bad) {
            const rows = testApp.makeRows(MIN_WINDOW);
            rows[100] = row;

            const res = await app.request("POST", "/api/inference/word", {
                body: { signal: { format: "samples", rows } },
            });

            assert.equal(res.status, 400, JSON.stringify(row));
            assert.equal(stub.state.requests.length, 0);
        }
    });

    it("rejects values outside the hardware range", async () => {
        const rows = testApp.makeRows(MIN_WINDOW);
        rows[5] = { emg: 999999, pot: 39 };

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(res.status, 400);
        assert.equal(stub.state.requests.length, 0);
    });

    it("rejects an invalid timestamp", async () => {
        const rows = testApp.makeRows(MIN_WINDOW);
        rows[7] = { emg: 900, pot: 39, timestamp: -1 };

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(res.status, 400);
    });
});

/* ------------------------------------------------------------------ *
 * 6. Missing POT
 * ------------------------------------------------------------------ */
describe("6. Missing POT", () => {
    it("rejects a window with no POT channel", async () => {
        const rows = testApp.makeRows(MIN_WINDOW).map(({ emg }) => ({ emg }));

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(res.status, 400);
        assert.equal(res.body.code, "VALIDATION_ERROR");
        const message = JSON.stringify(res.body.errors);
        assert.match(message, /pot/i);
        assert.equal(stub.state.requests.length, 0);
    });

    it("rejects a single row missing POT inside an otherwise valid window", async () => {
        const rows = testApp.makeRows(MIN_WINDOW);
        delete rows[500].pot;

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(res.status, 400);
        assert.equal(stub.state.requests.length, 0);
    });
});

/* ------------------------------------------------------------------ *
 * 7, 8, 9. Python error mapping
 * ------------------------------------------------------------------ */
describe("7-9. Python error mapping", () => {
    it("maps Python 422 to a distinct application error", async () => {
        stub.setMode("422");

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 422);
        assert.equal(res.body.code, "AI_VALIDATION_REJECTED");
        assert.notEqual(res.body.message, "prediction failed");
    });

    it("maps Python 501 to sentence-unsupported", async () => {
        stub.setMode("501");

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 501);
        assert.equal(res.body.code, "AI_SENTENCE_UNSUPPORTED");
    });

    it("maps Python 500 to an inference failure, not a generic error", async () => {
        stub.setMode("500");

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 502);
        assert.equal(res.body.code, "AI_INFERENCE_FAILED");
        // Python's internal detail must not be forwarded.
        assert.ok(!JSON.stringify(res.body).includes("internal predictor failure"));
    });

    it("maps a timeout to 504 and does not hang", async () => {
        aiServiceConfig.predictTimeoutMs = 120;
        stub.setDelay(1200);

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 504);
        assert.equal(res.body.code, "AI_SERVICE_TIMEOUT");
        assert.ok(res.elapsedMs < 1100, `returned in ${res.elapsedMs}ms, should abort early`);
    });

    it("maps a malformed AI response to a bad-response error", async () => {
        stub.setMode("malformed-json");

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 502);
        assert.equal(res.body.code, "AI_BAD_RESPONSE");
    });

    it("rejects a structurally valid but meaningless AI payload", async () => {
        stub.setMode("bad-payload");

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 502);
        assert.equal(res.body.code, "AI_BAD_RESPONSE");
    });

    it("never leaks a stack trace", async () => {
        for (const mode of ["422", "500", "model-missing", "bad-payload"]) {
            stub.setMode(mode);
            const res = await app.request("POST", "/api/inference/word", {
                body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
            });
            const serialized = JSON.stringify(res.body);
            assert.ok(!serialized.includes("at Object."), mode);
            assert.ok(!serialized.includes("\\n    at "), mode);
            assert.ok(!("stack" in res.body), mode);
        }
    });
});

/* ------------------------------------------------------------------ *
 * 11. Rejected / unknown prediction
 * ------------------------------------------------------------------ */
describe("11. Unknown prediction", () => {
    it("returns unknown without forcing the closest label", async () => {
        stub.setMode("unknown-prediction");

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.ready, true);
        assert.equal(res.body.prediction.label, "unknown");
        assert.equal(res.body.prediction.accepted, false);
        assert.equal(res.body.prediction.confidence, 0);

        // The closest guess is reported but not adopted.
        assert.match(res.body.prediction.bestLabel, /^low-quality-signal:/);

        // Infinity has no JSON representation; null must survive the hop.
        assert.equal(res.body.prediction.distance, null);
        assert.equal(res.body.meta.quality, "flat-emg:std=0.0");
    });
});

/* ------------------------------------------------------------------ *
 * 12. Authenticated user enforcement
 * ------------------------------------------------------------------ */
describe("12. Authentication", () => {
    const endpoints = [
        ["GET", "/api/inference/health", null],
        ["GET", "/api/inference/status", null],
        ["GET", "/api/inference/sessions/current", null],
        ["POST", "/api/inference/word", {
            signal: { format: "samples", rows: [{ emg: 900, pot: 39 }] },
        }],
        ["POST", "/api/inference/sessions", {
            signal: { format: "samples", rows: [{ emg: 900, pot: 39 }] },
        }],
    ];

    for (const [method, path, body] of endpoints) {
        it(`requires a token: ${method} ${path}`, async () => {
            const res = await app.request(method, path, { body, token: null });

            assert.equal(res.status, 401);
            assert.equal(res.body.success, false);
            assert.equal(stub.state.requests.length, 0);
        });
    }

    it("rejects a malformed token", async () => {
        const res = await app.request("GET", "/api/inference/health", {
            token: "not-a-real-jwt",
        });

        assert.equal(res.status, 401);
        assert.match(res.body.message, /Invalid or expired token/);
    });

    it("ignores a client-supplied userId and uses the token identity", async () => {
        const jwtService = require("../src/services/jwtService");
        const rows = testApp.makeRows(MIN_WINDOW);

        // Give the OTHER user a session profile, and the token user none.
        const otherToken = jwtService.generateToken(testApp.OTHER_USER);
        await app.request("POST", "/api/inference/sessions", {
            body: { signal: { format: "samples", rows } },
            token: otherToken,
        });

        // Now predict as TEST_USER while claiming to be OTHER_USER in the body.
        const res = await app.request("POST", "/api/inference/word", {
            body: {
                signal: { format: "samples", rows },
                userId: testApp.OTHER_USER.user_id,
            },
        });

        assert.equal(res.status, 200);
        // If the body's userId had been honoured, the other user's profile would
        // have been applied. Identity must come from the token alone.
        assert.equal(
            res.body.meta.sessionAdaptation,
            "none",
            "a userId in the request body must be ignored"
        );
        assert.equal(stub.lastRequestTo("/predict").sessionId, null);
    });

    it("keeps session profiles isolated per authenticated user", async () => {
        const jwtService = require("../src/services/jwtService");
        const rows = testApp.makeRows(MIN_WINDOW);

        await app.request("POST", "/api/inference/sessions", {
            body: { signal: { format: "samples", rows } },
        });

        const mine = await app.request("GET", "/api/inference/sessions/current");
        assert.ok(mine.body.session, "authenticated user should have a profile");

        const otherToken = jwtService.generateToken(testApp.OTHER_USER);
        const theirs = await app.request("GET", "/api/inference/sessions/current", {
            token: otherToken,
        });

        assert.equal(theirs.body.session, null, "other user must not see it");
    });
});

/* ------------------------------------------------------------------ *
 * Session adaptation
 * ------------------------------------------------------------------ */
describe("Session adaptation", () => {
    it("creates a profile and binds it to the authenticated user", async () => {
        const res = await app.request("POST", "/api/inference/sessions", {
            body: { signal: { format: "samples", rows: testApp.makeRows(200) } },
        });

        assert.equal(res.status, 201);
        assert.equal(res.body.success, true);
        assert.equal(res.body.session.aiSessionId.length, 32);
        assert.equal(res.body.session.baselineSamples, 200);
        // No active application session was stubbed, so this is explicitly null
        // rather than silently omitted.
        assert.equal(res.body.session.appSessionId, null);
    });

    it("binds to the active application session when one exists", async () => {
        const sessionModel = require("../src/models/sessionModel");
        const original = sessionModel.getActiveSessionByUserId;
        sessionModel.getActiveSessionByUserId = async () => ({ session_id: 777 });

        try {
            const res = await app.request("POST", "/api/inference/sessions", {
                body: { signal: { format: "samples", rows: testApp.makeRows(200) } },
            });

            assert.equal(res.body.session.appSessionId, 777);

            const current = await app.request("GET", "/api/inference/sessions/current");
            assert.equal(current.body.session.appSessionId, 777);
        } finally {
            sessionModel.getActiveSessionByUserId = original;
        }
    });

    it("rejects a baseline below the AI service minimum", async () => {
        const res = await app.request("POST", "/api/inference/sessions", {
            body: { signal: { format: "samples", rows: testApp.makeRows(40) } },
        });

        assert.equal(res.status, 400);
        assert.equal(res.body.code, "AI_BASELINE_TOO_SMALL");
        assert.equal(stub.state.requests.length, 0);
    });

    it("applies a stored profile to later predictions automatically", async () => {
        const rows = testApp.makeRows(MIN_WINDOW);

        await app.request("POST", "/api/inference/sessions", {
            body: { signal: { format: "samples", rows } },
        });

        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows } },
        });

        assert.equal(res.body.meta.sessionAdaptation, "applied");
        assert.equal(stub.lastRequestTo("/predict").sessionId.length, 32);
    });

    it("predicts without adaptation when no profile exists", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        assert.equal(res.body.meta.sessionAdaptation, "none");
        assert.equal(stub.lastRequestTo("/predict").sessionId, null);
    });

    it("clears a profile on request", async () => {
        const rows = testApp.makeRows(MIN_WINDOW);
        await app.request("POST", "/api/inference/sessions", {
            body: { signal: { format: "samples", rows } },
        });

        const cleared = await app.request("DELETE", "/api/inference/sessions/current");
        assert.equal(cleared.status, 200);

        const current = await app.request("GET", "/api/inference/sessions/current");
        assert.equal(current.body.session, null);
    });
});

/* ------------------------------------------------------------------ *
 * 13. Persistence behaviour
 * ------------------------------------------------------------------ */
describe("13. Persistence", () => {
    it("states plainly that a direct window prediction is not persisted", async () => {
        const res = await app.request("POST", "/api/inference/word", {
            body: { signal: { format: "samples", rows: testApp.makeRows(MIN_WINDOW) } },
        });

        // The current schema requires processed_recordings.recording_id, so a
        // stateless window has nowhere to be stored. Say so rather than implying
        // the result was saved.
        assert.equal(res.body.meta.persisted, false);
        assert.match(res.body.meta.persistenceNote, /recording_id/);
    });

    it("keeps mlService returning the shape the persisting path expects", async () => {
        // inferRecording() reads prediction.best_label (snake_case) and
        // modelStatus.modelVersion before writing to processed_recordings.
        const mlService = require("../src/services/mlService");
        const rows = testApp.makeRows(MIN_WINDOW).map((r) => [r.emg, r.pot]);

        const result = await mlService.predictSignal(rows, 0.5);

        assert.ok(result.prediction);
        assert.ok(result.normalizedSignal);
        assert.ok(result.modelStatus);
        assert.equal(typeof result.prediction.best_label, "string");
        assert.equal(result.prediction.label, "help");
        assert.equal(result.normalizedSignal.length, MIN_WINDOW);
        assert.equal(result.normalizedSignal[0].length, 2);
        assert.match(result.modelStatus.modelVersion, /^calibrated_word_model@/);
    });

    it("refuses stored signal data that has no POT channel", async () => {
        const mlService = require("../src/services/mlService");
        const emgOnly = testApp.makeRows(MIN_WINDOW).map((r) => r.emg);

        await assert.rejects(
            () => mlService.predictSignal(emgOnly, 0.5),
            (error) => {
                assert.match(error.message, /POT/);
                assert.equal(error.status, 400);
                return true;
            }
        );
    });

    it("enforces the window rule on the stored-recording path too", async () => {
        const mlService = require("../src/services/mlService");
        const short = testApp.makeRows(100).map((r) => [r.emg, r.pot]);

        await assert.rejects(
            () => mlService.predictSignal(short, 0.5),
            (error) => {
                assert.equal(error.code, "AI_WINDOW_TOO_SMALL");
                return true;
            }
        );
    });
});
