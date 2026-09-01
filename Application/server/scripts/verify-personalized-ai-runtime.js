/**
 * Runtime verification for personalized AI inference (user 10000).
 * Run: node scripts/verify-personalized-ai-runtime.js
 */
require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const pool = require("../src/config/db");
const jwtService = require("../src/services/jwtService");
const userCalibrationService = require("../src/services/userCalibrationService");

const USER_ID = 10000;
const API_BASE = (process.env.VERIFY_API_BASE || "http://127.0.0.1:5000/api").replace(
    /\/+$/,
    ""
);
const AI_URL = (process.env.AI_SERVICE_URL || "http://127.0.0.1:8077").replace(/\/+$/, "");
const CAPTURES_DIR = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "EMG_Silent_Speech",
    "captures"
);

function readCapture(filePath) {
    const text = fs.readFileSync(filePath, "utf8");
    const rows = [];
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const esp = line.match(/EMG\s*:\s*(-?\d+(?:\.\d+)?).*POT\s*:\s*(-?\d+(?:\.\d+)?)/i);
        if (esp) {
            rows.push({ emg: Number(esp[1]), pot: Number(esp[2]) });
            continue;
        }
        const parts = line.split(";");
        if (parts.length === 2) {
            rows.push({ emg: Number(parts[0]), pot: Number(parts[1]) });
        }
    }
    return rows;
}

function firstCapture(label) {
    const dir = path.join(CAPTURES_DIR, label);
    const file = fs.readdirSync(dir).find((name) => name.endsWith(".txt"));
    return readCapture(path.join(dir, file)).slice(0, 768);
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
}

async function loadUser(userId) {
    const [rows] = await pool.query(
        `SELECT user_id, email, is_active FROM users WHERE user_id = ? LIMIT 1`,
        [userId]
    );
    return rows[0] || null;
}

async function loadCalibrationSnapshot(userId) {
    const [profileRows] = await pool.query(
        `SELECT calibration_id, profile_version, model_sha256, status
         FROM calibration_profiles
         WHERE user_id = ? AND status = 'active'
         LIMIT 1`,
        [userId]
    );
    const profile = profileRows[0];
    if (!profile) {
        return { profile: null, words: [], neutral: null };
    }

    const [words] = await pool.query(
        `SELECT cwe.word_label, cwe.state, cwe.pot_center, cwe.pot_radius, cwe.capture_count,
                CASE WHEN cwe.emg_reference IS NULL THEN 0 ELSE JSON_LENGTH(cwe.emg_reference) END AS emg_dim
         FROM calibration_word_entries cwe
         INNER JOIN calibration_profiles cp ON cp.calibration_id = cwe.calibration_id
         WHERE cp.user_id = ? AND cp.calibration_id = ?
         ORDER BY cwe.word_label`,
        [userId, profile.calibration_id]
    );

    const [neutralRows] = await pool.query(
        `SELECT cnb.baseline_adc, cnb.noise_floor, cnb.emg_std, cnb.pot_mean, cnb.sample_count
         FROM calibration_neutral_baseline cnb
         INNER JOIN calibration_profiles cp ON cp.calibration_id = cnb.calibration_id
         WHERE cp.user_id = ? AND cp.calibration_id = ?
         LIMIT 1`,
        [userId, profile.calibration_id]
    );

    return {
        profile,
        words,
        neutral: neutralRows[0] || null,
    };
}

async function listPersonalizedUsers() {
    const [rows] = await pool.query(
        `SELECT DISTINCT cp.user_id, u.email, cp.calibration_id, cp.profile_version
         FROM calibration_profiles cp
         INNER JOIN users u ON u.user_id = cp.user_id
         INNER JOIN calibration_word_entries cwe ON cwe.calibration_id = cp.calibration_id
         WHERE cp.status = 'active' AND cp.is_active = TRUE AND cwe.state = 'calibrated'
         ORDER BY cp.user_id`
    );
    return rows;
}

async function main() {
    const report = {
        timestamp: new Date().toISOString(),
        userId: USER_ID,
        apiBase: API_BASE,
        aiUrl: AI_URL,
    };

    const user = await loadUser(USER_ID);
    if (!user) {
        throw new Error(`User ${USER_ID} not found`);
    }

    const token = jwtService.generateToken(user);
    const auth = { Authorization: `Bearer ${token}` };

    report.user = { user_id: user.user_id, email: user.email };

    const calibrationBefore = await loadCalibrationSnapshot(USER_ID);
    report.calibrationBefore = calibrationBefore;

    const health = await fetchJson(`${AI_URL}/health`);
    report.pythonHealth = {
        status: health.status,
        model_sha256: health.body?.model_sha256 || null,
        labels: health.body?.labels || [],
    };

    report.modelShaMatch =
        !calibrationBefore.profile?.model_sha256 ||
        calibrationBefore.profile.model_sha256 === health.body?.model_sha256;

    const resolved = await userCalibrationService.resolveForUser(USER_ID);
    report.nodeResolution = {
        hasContext: Boolean(resolved.context),
        meta: resolved.meta,
        profileVersion: resolved.context?.profileVersion ?? null,
        calibratedWordCount: Object.keys(resolved.context?.words || {}).length,
        wireWords: Object.keys(resolved.context?.words || {}).sort(),
    };

    const helpRows = firstCapture("help");
    const stopRows = firstCapture("stop");

    const nodeHelp = await fetchJson(`${API_BASE}/inference/word`, {
        method: "POST",
        headers: auth,
        body: { signal: { format: "samples", rows: helpRows } },
    });
    report.nodeHelpPrediction = {
        status: nodeHelp.status,
        label: nodeHelp.body?.prediction?.label ?? null,
        accepted: nodeHelp.body?.prediction?.accepted ?? null,
        confidence: nodeHelp.body?.prediction?.confidence ?? null,
        personalization: nodeHelp.body?.meta?.personalization ?? null,
    };

    const pythonWith = await fetchJson(`${AI_URL}/predict`, {
        method: "POST",
        body: {
            kind: "word",
            signal: { format: "samples", rows: helpRows },
            userCalibration: resolved.context,
        },
    });
    report.pythonWithPersonalization = {
        status: pythonWith.status,
        label: pythonWith.body?.label ?? null,
        accepted: pythonWith.body?.accepted ?? null,
        confidence: pythonWith.body?.confidence ?? null,
        personalization: pythonWith.body?.personalization ?? null,
    };

    const pythonWithout = await fetchJson(`${AI_URL}/predict`, {
        method: "POST",
        body: {
            kind: "word",
            signal: { format: "samples", rows: helpRows },
        },
    });
    report.pythonWithoutPersonalization = {
        status: pythonWithout.status,
        label: pythonWithout.body?.label ?? null,
        accepted: pythonWithout.body?.accepted ?? null,
        confidence: pythonWithout.body?.confidence ?? null,
        personalization: pythonWithout.body?.personalization ?? null,
    };

    const nodeStop = await fetchJson(`${API_BASE}/inference/word`, {
        method: "POST",
        headers: auth,
        body: { signal: { format: "samples", rows: stopRows } },
    });
    report.globalFallbackStop = {
        status: nodeStop.status,
        label: nodeStop.body?.prediction?.label ?? null,
        accepted: nodeStop.body?.prediction?.accepted ?? null,
        personalization: nodeStop.body?.meta?.personalization ?? null,
    };

    const personalizedUsers = await listPersonalizedUsers();
    report.personalizedUsers = personalizedUsers;

    const calibrationAfter = await loadCalibrationSnapshot(USER_ID);
    report.calibrationAfter = calibrationAfter;
    report.calibrationUnchanged =
        JSON.stringify(calibrationBefore) === JSON.stringify(calibrationAfter);

    console.log(JSON.stringify(report, null, 2));
    await pool.end();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await pool.end();
    } catch {}
    process.exit(1);
});
