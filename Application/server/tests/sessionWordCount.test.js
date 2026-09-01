/**
 * Session aggregate refresh tests.
 */

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const sessionModel = require("../src/models/sessionModel");
const sessionService = require("../src/services/sessionService");

describe("sessionModel.refreshSessionAggregates", () => {
    it("updates word_count and average_confidence from persisted text results", async () => {
        const calls = [];
        const connection = {
            async query(sql, params) {
                calls.push({ sql, params });
                if (/COUNT\(tr\.text_id\)/i.test(sql)) {
                    return [[{ word_count: 3, average_confidence: 82.5 }]];
                }
                if (/UPDATE sessions/i.test(sql)) {
                    return [{ affectedRows: 1 }];
                }
                return [[]];
            },
        };

        const stats = await sessionModel.refreshSessionAggregates(42, connection);

        assert.equal(stats.wordCount, 3);
        assert.equal(stats.averageConfidence, 82.5);
        assert.equal(calls.length, 2);
        assert.match(calls[1].sql, /UPDATE sessions/i);
        assert.deepEqual(calls[1].params, [3, 82.5, 42]);
    });

    it("stores zero when a session has no saved text results", async () => {
        const connection = {
            async query(sql) {
                if (/COUNT\(tr\.text_id\)/i.test(sql)) {
                    return [[{ word_count: 0, average_confidence: null }]];
                }
                if (/UPDATE sessions/i.test(sql)) {
                    return [{ affectedRows: 1 }];
                }
                return [[]];
            },
        };

        const stats = await sessionModel.refreshSessionAggregates(9, connection);

        assert.equal(stats.wordCount, 0);
        assert.equal(stats.averageConfidence, null);
    });
});

describe("sessionService.completeSession", () => {
    it("uses database-derived aggregates instead of client-supplied counts", async () => {
        const calls = [];
        const originalRefresh = sessionModel.refreshSessionAggregates;
        const originalComplete = sessionModel.completeSession;

        sessionModel.refreshSessionAggregates = async (sessionId) => {
            calls.push(["refresh", sessionId]);
            return { wordCount: 5, averageConfidence: 77.25 };
        };

        sessionModel.completeSession = async (
            sessionId,
            userId,
            wordCount,
            averageConfidence
        ) => {
            calls.push([
                "complete",
                sessionId,
                userId,
                wordCount,
                averageConfidence,
            ]);
            return 1;
        };

        try {
            const result = await sessionService.completeSession(12, 10000, 1, 90);

            assert.equal(result.success, true);
            assert.deepEqual(calls, [
                ["refresh", 12],
                ["complete", 12, 10000, 5, 77.25],
            ]);
        } finally {
            sessionModel.refreshSessionAggregates = originalRefresh;
            sessionModel.completeSession = originalComplete;
        }
    });
});

describe("session aggregate isolation", () => {
    it("counts text results only for the requested session", async () => {
        const connection = {
            async query(sql, params) {
                if (/COUNT\(tr\.text_id\)/i.test(sql)) {
                    assert.equal(params[0], 77);
                    return [[{ word_count: 2, average_confidence: 81 }]];
                }
                if (/UPDATE sessions/i.test(sql)) {
                    assert.equal(params[2], 77);
                    return [{ affectedRows: 1 }];
                }
                return [[]];
            },
        };

        const stats = await sessionModel.refreshSessionAggregates(77, connection);

        assert.equal(stats.wordCount, 2);
        assert.equal(stats.averageConfidence, 81);
    });
});
