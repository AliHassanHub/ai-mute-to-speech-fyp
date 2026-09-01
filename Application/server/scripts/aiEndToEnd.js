/**
 * Real end-to-end test: Node.js backend -> Python AI service -> real captures.
 *
 * Requires the Python AI service to be running:
 *   cd EMG_Silent_Speech
 *   python -m uvicorn ai_service.app.main:app --host 127.0.0.1 --port 8077
 *
 * Then:
 *   cd Application/server
 *   npm run ai:e2e
 *
 * Reads the actual capture files from the verified AI package and pushes them
 * through the real Node.js endpoint. No stubs, no synthetic signals, no fake
 * labels. The Node result is compared against the Python API called directly.
 */

require("dotenv").config();

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const CAPTURES_DIR = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "EMG_Silent_Speech",
    "captures"
);

const LABELS = ["help", "no", "pain", "stop"];
const MIN_WINDOW = Number(process.env.AI_MIN_WINDOW_SAMPLES || 768);
const MAX_WINDOW = Number(process.env.AI_MAX_WINDOW_SAMPLES || 1800);
const AI_URL = (process.env.AI_SERVICE_URL || "http://127.0.0.1:8077").replace(/\/+$/, "");

/**
 * Parse a capture file the same way runtime/signal_io.py does for the two
 * formats these files actually use: "emg;pot" and "EMG:<n>  POT:<n>".
 */
function readCapture(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    const rows = [];

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        const esp = line.match(/EMG\s*:\s*(-?\d+(?:\.\d+)?).*POT\s*:\s*(-?\d+(?:\.\d+)?)/i);
        if (esp) {
            rows.push({ emg: Number(esp[1]), pot: Number(esp[2]) });
            continue;
        }

        const parts = line.split(";");
        if (parts.length === 2) {
            rows.push({ emg: Number(parts[0]), pot: Number(parts[1]) });
            continue;
        }
        if (parts.length >= 5) {
            rows.push({ emg: Number(parts[2]), pot: Number(parts[3]) });
            continue;
        }

        throw new Error(`unparsed capture line in ${filePath}: ${line}`);
    }

    return rows;
}

async function callJson(url, { method = "GET", body = null, headers = {} } = {}) {
    const started = process.hrtime.bigint();
    const response = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json", ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = { raw: text };
    }

    return { status: response.status, body: parsed, elapsedMs };
}

function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, index)];
}

function mean(values) {
    return values.length
        ? values.reduce((sum, v) => sum + v, 0) / values.length
        : 0;
}

async function main() {
    console.log("=".repeat(78));
    console.log("AI PHASE 2 — REAL END-TO-END TEST");
    console.log("=".repeat(78));
    console.log(`captures : ${CAPTURES_DIR}`);
    console.log(`AI service: ${AI_URL}`);
    console.log(`window   : ${MIN_WINDOW}..${MAX_WINDOW} samples`);

    if (!fs.existsSync(CAPTURES_DIR)) {
        console.error(`\nFAIL: captures directory not found: ${CAPTURES_DIR}`);
        process.exit(1);
    }

    // --- Python service must be up -------------------------------------
    let pyHealth;
    try {
        pyHealth = await callJson(`${AI_URL}/health`);
    } catch (error) {
        console.error(`\nFAIL: cannot reach the Python AI service (${error.message}).`);
        console.error("Start it with:");
        console.error("  cd EMG_Silent_Speech");
        console.error("  python -m uvicorn ai_service.app.main:app --host 127.0.0.1 --port 8077");
        process.exit(1);
    }

    if (pyHealth.status !== 200 || pyHealth.body.word_model_loaded !== true) {
        console.error("\nFAIL: Python AI service is not healthy:", pyHealth.body);
        process.exit(1);
    }

    console.log(`\nPython model: ${pyHealth.body.model} labels=${JSON.stringify(pyHealth.body.labels)}`);
    console.log(`Python sha256: ${String(pyHealth.body.model_sha256).slice(0, 12)}...`);
    console.log(`Python min_predict_samples: ${pyHealth.body.min_predict_samples}`);

    // --- Boot the real Node app in-process ------------------------------
    // The genuine auth middleware runs; only the user lookup is stubbed,
    // because a seeded database row is not the subject of this test.
    const authModel = require("../src/models/authModel");
    const sessionModel = require("../src/models/sessionModel");
    const jwtService = require("../src/services/jwtService");

    const testUser = { user_id: 4242, email: "ai.e2e@example.test", is_active: 1 };
    authModel.findUserById = async () => testUser;
    sessionModel.getActiveSessionByUserId = async () => null;

    const app = require("../src/app");
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const nodeUrl = `http://127.0.0.1:${server.address().port}`;
    const token = jwtService.generateToken(testUser);
    const auth = { Authorization: `Bearer ${token}` };

    console.log(`Node backend: ${nodeUrl}`);

    let exitCode = 0;

    try {
        // --- Node health -------------------------------------------------
        console.log("\n" + "=".repeat(78));
        console.log("GET /api/inference/health");
        console.log("=".repeat(78));
        const nodeHealth = await callJson(`${nodeUrl}/api/inference/health`, { headers: auth });
        console.log(`HTTP ${nodeHealth.status} (${nodeHealth.elapsedMs.toFixed(1)} ms)`);
        console.log(JSON.stringify(nodeHealth.body, null, 2));

        if (nodeHealth.status !== 200 || nodeHealth.body.available !== true) {
            console.error("FAIL: Node could not reach the AI service");
            process.exit(1);
        }
        if (nodeHealth.body.windowAgreement !== true) {
            console.error("FAIL: Node and Python disagree on the inference window");
            exitCode = 1;
        }

        // --- Real captures ------------------------------------------------
        console.log("\n" + "=".repeat(78));
        console.log("POST /api/inference/word — real captures, Node vs Python direct");
        console.log("=".repeat(78));
        console.log(
            "capture".padEnd(32) +
                "n".padStart(6) +
                "python".padStart(9) +
                "node".padStart(9) +
                "conf".padStart(7) +
                "acc".padStart(5) +
                "py_ms".padStart(8) +
                "node_ms".padStart(9)
        );

        const nodeLatencies = [];
        const pyLatencies = [];
        const aiInferenceTimes = [];
        const mismatches = [];
        const notReady = [];
        const skipped = [];
        let compared = 0;

        for (const label of LABELS) {
            const dir = path.join(CAPTURES_DIR, label);
            if (!fs.existsSync(dir)) {
                console.log(`  (missing capture folder: ${label})`);
                continue;
            }

            for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort()) {
                const filePath = path.join(dir, file);
                const rows = readCapture(filePath);

                // Windows outside the verified range are expected to be refused;
                // record them rather than counting them as failures.
                if (rows.length > MAX_WINDOW) {
                    const res = await callJson(`${nodeUrl}/api/inference/word`, {
                        method: "POST",
                        headers: auth,
                        body: { signal: { format: "samples", rows } },
                    });
                    skipped.push({
                        file: `${label}/${file}`,
                        n: rows.length,
                        status: res.status,
                        code: res.body.code,
                    });
                    continue;
                }

                if (rows.length < MIN_WINDOW) {
                    const res = await callJson(`${nodeUrl}/api/inference/word`, {
                        method: "POST",
                        headers: auth,
                        body: { signal: { format: "samples", rows } },
                    });
                    notReady.push({
                        file: `${label}/${file}`,
                        n: rows.length,
                        ready: res.body.ready,
                    });
                    continue;
                }

                // Python directly, for the comparison baseline.
                const py = await callJson(`${AI_URL}/predict`, {
                    method: "POST",
                    body: { kind: "word", signal: { format: "samples", rows } },
                });

                // Then the same window through Node, with timestamps the
                // mobile client sends. Python must not see those fields.
                const stamped = rows.map((row, i) => ({
                    emg: row.emg,
                    pot: row.pot,
                    timestamp: 1_700_000_000_000 + i * 20,
                }));
                const node = await callJson(`${nodeUrl}/api/inference/word`, {
                    method: "POST",
                    headers: auth,
                    body: { signal: { format: "samples", rows: stamped } },
                });

                if (py.status !== 200 || node.status !== 200) {
                    mismatches.push(
                        `${label}/${file}: python=${py.status} node=${node.status}`
                    );
                    continue;
                }

                compared += 1;
                pyLatencies.push(py.elapsedMs);
                nodeLatencies.push(node.elapsedMs);
                if (typeof node.body.meta?.aiProcessingTimeMs === "number") {
                    aiInferenceTimes.push(node.body.meta.aiProcessingTimeMs);
                }

                const pyLabel = py.body.label;
                const nodeLabel = node.body.prediction.label;
                const sameLabel = pyLabel === nodeLabel;
                const sameAccept = py.body.accepted === node.body.prediction.accepted;
                const expectedOk = nodeLabel === label;

                if (!sameLabel || !sameAccept) {
                    mismatches.push(
                        `${label}/${file}: python=${pyLabel}/${py.body.accepted} node=${nodeLabel}/${node.body.prediction.accepted}`
                    );
                }
                if (!expectedOk) {
                    mismatches.push(
                        `${label}/${file}: expected ${label}, node returned ${nodeLabel}`
                    );
                }

                const flag = sameLabel && sameAccept && expectedOk ? " " : "X";
                console.log(
                    flag +
                        `${label}/${file}`.padEnd(31) +
                        String(rows.length).padStart(6) +
                        String(pyLabel).padStart(9) +
                        String(nodeLabel).padStart(9) +
                        node.body.prediction.confidence.toFixed(3).padStart(7) +
                        String(node.body.prediction.accepted).padStart(5) +
                        py.elapsedMs.toFixed(1).padStart(8) +
                        node.elapsedMs.toFixed(1).padStart(9)
                );
            }
        }

        // --- Rejection paths -----------------------------------------------
        console.log("\n" + "=".repeat(78));
        console.log("Rejection and guard paths (real Node -> real Python)");
        console.log("=".repeat(78));

        const sample = readCapture(
            path.join(CAPTURES_DIR, "help", fs.readdirSync(path.join(CAPTURES_DIR, "help"))[0])
        );

        const guards = [
            ["single BLE packet", { signal: { format: "samples", rows: sample.slice(0, 1) } }],
            ["420 samples", { signal: { format: "samples", rows: sample.slice(0, 420) } }],
            ["767 samples", { signal: { format: "samples", rows: sample.slice(0, 767) } }],
            ["empty rows", { signal: { format: "samples", rows: [] } }],
            ["missing POT", {
                signal: {
                    format: "samples",
                    rows: sample.slice(0, MIN_WINDOW).map(({ emg }) => ({ emg })),
                },
            }],
            ["NaN as string", {
                signal: {
                    format: "samples",
                    rows: sample.slice(0, MIN_WINDOW).map((r, i) =>
                        i === 10 ? { emg: "NaN", pot: r.pot } : r
                    ),
                },
            }],
            ["bad format", { signal: { format: "csv", rows: sample.slice(0, MIN_WINDOW) } }],
            ["flat EMG (real reject path)", {
                signal: {
                    format: "samples",
                    rows: Array.from({ length: MIN_WINDOW }, () => ({ emg: 600, pot: 39 })),
                },
            }],
        ];

        for (const [name, body] of guards) {
            const res = await callJson(`${nodeUrl}/api/inference/word`, {
                method: "POST",
                headers: auth,
                body,
            });
            const summary =
                res.body.ready === false
                    ? `ready=false received=${res.body.receivedSamples}`
                    : res.body.code
                      ? res.body.code
                      : res.body.prediction
                        ? `${res.body.prediction.label}/accepted=${res.body.prediction.accepted}`
                        : res.body.message;
            console.log(`  ${name.padEnd(30)} HTTP ${res.status}  ${summary}`);
        }

        const unauth = await callJson(`${nodeUrl}/api/inference/word`, {
            method: "POST",
            body: { signal: { format: "samples", rows: sample.slice(0, MIN_WINDOW) } },
        });
        console.log(`  ${"no auth token".padEnd(30)} HTTP ${unauth.status}  ${unauth.body.message}`);
        if (unauth.status !== 401) {
            mismatches.push("unauthenticated request was not rejected");
        }

        // --- Session adaptation ---------------------------------------------
        console.log("\n" + "=".repeat(78));
        console.log("Session adaptation (real Node -> real Python)");
        console.log("=".repeat(78));

        const sessionRes = await callJson(`${nodeUrl}/api/inference/sessions`, {
            method: "POST",
            headers: auth,
            body: { signal: { format: "samples", rows: sample } },
        });
        console.log(`  create: HTTP ${sessionRes.status} (${sessionRes.elapsedMs.toFixed(1)} ms)`);
        console.log(`  ${JSON.stringify(sessionRes.body.session)}`);

        const adapted = await callJson(`${nodeUrl}/api/inference/word`, {
            method: "POST",
            headers: auth,
            body: { signal: { format: "samples", rows: sample.slice(0, MIN_WINDOW) } },
        });
        console.log(
            `  predict with session: HTTP ${adapted.status} label=${adapted.body.prediction?.label} ` +
                `adaptation=${adapted.body.meta?.sessionAdaptation}`
        );
        if (adapted.body.meta?.sessionAdaptation !== "applied") {
            mismatches.push("session profile was not applied to the prediction");
        }

        await callJson(`${nodeUrl}/api/inference/sessions/current`, {
            method: "DELETE",
            headers: auth,
        });

        // --- Result -----------------------------------------------------------
        console.log("\n" + "=".repeat(78));
        console.log("RESULT");
        console.log("=".repeat(78));
        console.log(`captures compared           : ${compared}`);
        console.log(`below ${MIN_WINDOW}-sample window   : ${notReady.length} (answered ready=false)`);
        console.log(`above ${MAX_WINDOW}-sample window  : ${skipped.length} (rejected 400)`);
        console.log(`mismatches                  : ${mismatches.length}`);
        for (const m of mismatches) {
            console.log(`  ${m}`);
        }

        if (skipped.length) {
            console.log("\noversized captures (expected rejections):");
            for (const s of skipped) {
                console.log(`  ${s.file} n=${s.n} -> HTTP ${s.status} ${s.code || ""}`);
            }
        }

        console.log("\nPERFORMANCE");
        console.log(
            `  Python direct        : mean ${mean(pyLatencies).toFixed(1)} ms  ` +
                `p95 ${percentile(pyLatencies, 95).toFixed(1)} ms  max ${Math.max(...pyLatencies).toFixed(1)} ms`
        );
        console.log(
            `  Node end-to-end      : mean ${mean(nodeLatencies).toFixed(1)} ms  ` +
                `p95 ${percentile(nodeLatencies, 95).toFixed(1)} ms  max ${Math.max(...nodeLatencies).toFixed(1)} ms`
        );
        console.log(
            `  Python inference only: mean ${mean(aiInferenceTimes).toFixed(2)} ms  ` +
                `p95 ${percentile(aiInferenceTimes, 95).toFixed(2)} ms  max ${Math.max(...aiInferenceTimes).toFixed(2)} ms`
        );
        console.log(
            `  Node orchestration   : mean ${(mean(nodeLatencies) - mean(pyLatencies)).toFixed(1)} ms ` +
                `(Node end-to-end minus Python direct)`
        );

        if (mismatches.length > 0) {
            exitCode = 1;
        }

        console.log(`\n${exitCode === 0 ? "PASS" : "FAIL"}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        try {
            require("../src/config/db").end();
        } catch {
            // Pool may not have been opened.
        }
    }

    process.exit(exitCode);
}

main().catch((error) => {
    console.error("\nE2E FAILED:", error.message);
    process.exit(1);
});
