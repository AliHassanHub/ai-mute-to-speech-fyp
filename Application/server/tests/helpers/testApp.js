/**
 * Boots the real Express app for tests.
 *
 * The genuine auth middleware runs, so token handling is exercised for real. The
 * only thing replaced is the user lookup, which would otherwise need a seeded
 * database row. The sessions lookup is stubbed for the same reason.
 */

require("dotenv").config();

const http = require("node:http");

const TEST_USER = {
    user_id: 4242,
    email: "qa.ai.phase2@example.test",
    is_active: 1,
};

const OTHER_USER = {
    user_id: 9999,
    email: "other.user@example.test",
    is_active: 1,
};

function installModelStubs() {
    const authModel = require("../../src/models/authModel");
    const sessionModel = require("../../src/models/sessionModel");

    const users = new Map([
        [TEST_USER.user_id, TEST_USER],
        [OTHER_USER.user_id, OTHER_USER],
    ]);

    authModel.findUserById = async (userId) => users.get(Number(userId)) || null;

    // No active application session by default; individual tests override.
    sessionModel.getActiveSessionByUserId = async () => null;

    return { authModel, sessionModel };
}

function tokenFor(user = TEST_USER) {
    const jwtService = require("../../src/services/jwtService");
    return jwtService.generateToken(user);
}

async function start() {
    const stubs = installModelStubs();
    const app = require("../../src/app");
    const server = http.createServer(app);

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const request = async (method, path, { body = null, token = undefined } = {}) => {
        const headers = {};
        if (body) {
            headers["Content-Type"] = "application/json";
        }
        if (token !== null) {
            headers.Authorization = `Bearer ${token === undefined ? tokenFor() : token}`;
        }

        const started = Date.now();
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const text = await response.text();
        let parsed = null;
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            parsed = { raw: text };
        }

        return {
            status: response.status,
            body: parsed,
            elapsedMs: Date.now() - started,
        };
    };

    return {
        baseUrl,
        request,
        stubs,
        TEST_USER,
        OTHER_USER,
        tokenFor,
        async stop() {
            await new Promise((resolve) => server.close(resolve));
        },
    };
}

/** Build a synthetic window of the requested length. */
function makeRows(count, { emg = 900, pot = 39, withTimestamp = false } = {}) {
    const rows = [];
    for (let i = 0; i < count; i += 1) {
        // A varying EMG so the window is not trivially flat.
        const row = {
            emg: emg + Math.round(120 * Math.sin(i / 7)),
            pot,
        };
        if (withTimestamp) {
            row.timestamp = 1700000000000 + i * 20;
        }
        rows.push(row);
    }
    return rows;
}

module.exports = { start, makeRows, TEST_USER, OTHER_USER };
