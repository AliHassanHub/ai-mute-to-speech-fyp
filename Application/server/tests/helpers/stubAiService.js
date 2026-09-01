/**
 * A real HTTP server that stands in for the Python AI service.
 *
 * Using a real socket rather than a mocked fetch means the tests exercise the
 * actual transport path: timeouts, aborts, JSON parsing and status mapping.
 */

const http = require("node:http");

const FULL_VOCABULARY_LABELS = [
    "help",
    "no",
    "pain",
    "stop",
    "Assistance",
    "Medical",
    "Pick",
    "Land",
    "Up",
];

const HEALTH_OK = {
    status: "ok",
    model: "calibrated_word_model",
    word_model_loaded: true,
    labels: ["help", "no", "pain", "stop"],
    version: "0.1.0",
    model_sha256:
        "28655d4f5084e2ffbfc2d8e1e46ea0eb703f474aca0fb651b1d83e52bdf7f7a8",
    model_size_bytes: 174849,
    model_modified_utc: "2026-07-06T13:48:56Z",
    model_path: "/x/training/results/calibrated_word_model.npz",
    sentence_model_supported: false,
    min_predict_samples: 768,
    max_predict_samples: 1800,
    hard_min_samples: 50,
    default_min_confidence: 0.5,
};

const PREDICT_ACCEPTED = {
    kind: "word",
    label: "help",
    bestLabel: "help",
    confidence: 0.98,
    accepted: true,
    distance: 0.016478,
    margin: 12.0,
    processingTimeMs: 3.71,
    sampleCount: 802,
    quality: "ok",
    sessionAdaptation: "none",
    requiredConfidence: 0.5,
    personalization: {
        applied: false,
        profileVersion: null,
        modelSha256Match: true,
        profileFallbackRequired: false,
        calibratedWords: [],
        potPersonalizedWords: [],
        emgReferenceWords: [],
    },
    confidenceBasis:
        "weighted heuristic score, not a probability and not cosine similarity: min(0.98, 0.48*pot_conf + 0.34*distance_conf + 0.18*gap_conf)",
    marginUnit: "potentiometer counts (pot_gap) whenever only one label passes the POT gate",
    distanceUnit: "scaled feature-space RMS distance to the 3 nearest in-class references",
};

const PREDICT_UNKNOWN = {
    ...PREDICT_ACCEPTED,
    label: "unknown",
    bestLabel: "low-quality-signal:flat-emg:std=0.0",
    confidence: 0.0,
    accepted: false,
    distance: null,
    margin: 0.0,
    quality: "flat-emg:std=0.0",
};

async function start() {
    const state = {
        mode: "ok",
        delayMs: 0,
        requests: [],
        labels: [...HEALTH_OK.labels],
    };

    const server = http.createServer((req, res) => {
        let raw = "";
        req.on("data", (chunk) => {
            raw += chunk;
        });

        req.on("end", () => {
            const respond = (status, payload) => {
                const send = () => {
                    res.writeHead(status, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(payload));
                };
                if (state.delayMs > 0) {
                    setTimeout(send, state.delayMs);
                } else {
                    send();
                }
            };

            let body = null;
            try {
                body = raw ? JSON.parse(raw) : null;
            } catch {
                body = null;
            }

            const rows = body?.signal?.rows;
            state.requests.push({
                method: req.method,
                url: req.url,
                rowCount: rows?.length ?? null,
                kind: body?.kind ?? null,
                sessionId: body?.sessionId ?? null,
                minConfidence: body?.minConfidence ?? null,
                userCalibration: body?.userCalibration ?? null,
                firstRow: rows?.[0] ?? null,
                pythonRowKeys: rows?.[0] ? Object.keys(rows[0]).sort() : [],
                anyRowHasTimestamp: Array.isArray(rows)
                    ? rows.some((row) =>
                          Object.prototype.hasOwnProperty.call(row, "timestamp")
                      )
                    : false,
            });

            if (state.mode === "malformed-json") {
                const send = () => {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end("{ this is not json");
                };
                if (state.delayMs > 0) setTimeout(send, state.delayMs);
                else send();
                return;
            }

            if (req.url === "/health") {
                if (state.mode === "model-missing") {
                    return respond(503, {
                        status: "error",
                        word_model_loaded: false,
                        error: "model-unavailable",
                        detail: "calibrated model not found: /x/missing.npz",
                    });
                }
                if (state.mode === "health-window-mismatch") {
                    return respond(200, { ...HEALTH_OK, min_predict_samples: 384 });
                }
                return respond(200, { ...HEALTH_OK, labels: state.labels });
            }

            if (req.url === "/session") {
                if (state.mode === "session-short") {
                    return respond(422, {
                        error: "insufficient-baseline",
                        detail: "session adaptation needs at least 80 neutral samples",
                    });
                }
                return respond(200, {
                    sessionId: "a".repeat(32),
                    baselineSamples: body?.signal?.rows?.length ?? 0,
                    baseline: 60.0,
                    noiseFloor: 1883.7,
                    activeScale: 4709.25,
                    peakScale: 4709.25,
                    quietGate: 4957.62,
                });
            }

            if (req.url === "/calibration/word-reference") {
                const dim = 203;
                const emgReference = Array.from({ length: dim }, (_, i) =>
                    Number((0.01 * (i + 1)).toFixed(6))
                );
                const captureCount = body?.captures?.length ?? 0;
                const firstRows = body?.captures?.[0]?.signal?.rows || [];
                const potValues = firstRows.map((row) => Number(row.pot)).filter(Number.isFinite);
                const potCenter =
                    potValues.length > 0
                        ? potValues.reduce((sum, value) => sum + value, 0) /
                          potValues.length
                        : 10.0;
                const userSalt = String(body?.word || "pain")
                    .split("")
                    .reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
                for (let i = 0; i < emgReference.length; i += 1) {
                    emgReference[i] = Number(
                        (emgReference[i] + userSalt * 0.0001 + potCenter * 0.00001).toFixed(6)
                    );
                }
                return respond(200, {
                    word: body?.word ?? "pain",
                    emgReference,
                    featureDimension: dim,
                    potCenter: Number(potCenter.toFixed(4)),
                    potRadius: 2.5,
                    qualityScore: 88.5,
                    captureCount,
                    submittedCaptureCount: captureCount,
                    rejectedCaptures: [],
                    captureMetadata: {
                        extractionVersion: "test-stub",
                        featureDimension: dim,
                        usableCaptureCount: captureCount,
                    },
                    modelSha256: HEALTH_OK.model_sha256,
                    processingTimeMs: 4.2,
                });
            }

            if (req.url === "/predict") {
                switch (state.mode) {
                    case "422":
                        return respond(422, {
                            error: "insufficient-samples",
                            detail: "need at least 768 samples",
                        });
                    case "501":
                        return respond(501, {
                            kind: "sentence",
                            label: "unknown",
                            bestLabel: "sentence-model-disabled",
                            confidence: 0.0,
                            accepted: false,
                            supported: false,
                            reason: "Sentence prediction is disabled",
                        });
                    case "500":
                        return respond(500, { detail: "internal predictor failure" });
                    case "model-missing":
                        return respond(503, {
                            error: "model-unavailable",
                            detail: "calibrated model not found",
                        });
                    case "unknown-prediction":
                        return respond(200, PREDICT_UNKNOWN);
                    case "pain":
                        return respond(200, {
                            ...PREDICT_ACCEPTED,
                            label: "pain",
                            bestLabel: "pain",
                            confidence: 0.84,
                            sampleCount: body?.signal?.rows?.length ?? 0,
                            sessionAdaptation: body?.sessionId ? "applied" : "none",
                        });
                    case "bad-payload":
                        return respond(200, { nothing: "useful" });
                    default:
                        return respond(200, {
                            ...PREDICT_ACCEPTED,
                            sampleCount: body?.signal?.rows?.length ?? 0,
                            sessionAdaptation: body?.sessionId ? "applied" : "none",
                        });
                }
            }

            return respond(404, { detail: "not found" });
        });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    return {
        state,
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        setMode(mode) {
            state.mode = mode;
        },
        setDelay(ms) {
            state.delayMs = ms;
        },
        reset() {
            state.mode = "ok";
            state.delayMs = 0;
            state.requests = [];
            state.labels = [...HEALTH_OK.labels];
        },
        setLabels(labels) {
            state.labels = [...labels];
        },
        lastRequest() {
            return state.requests[state.requests.length - 1] || null;
        },
        /**
         * Last request to a specific path. Needed because a prediction is
         * followed by a /health call to resolve the model version, so the
         * overall last request is not the one under test.
         */
        lastRequestTo(path) {
            for (let i = state.requests.length - 1; i >= 0; i -= 1) {
                if (state.requests[i].url === path) {
                    return state.requests[i];
                }
            }
            return null;
        },
        requestsTo(path) {
            return state.requests.filter((r) => r.url === path);
        },
        async stop() {
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

module.exports = { start, HEALTH_OK, FULL_VOCABULARY_LABELS, PREDICT_ACCEPTED, PREDICT_UNKNOWN };
