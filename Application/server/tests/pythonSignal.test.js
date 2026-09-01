/**
 * Node → Python sample mapping. No HTTP, no model.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { toPythonSamples } = require("../src/services/pythonSignal");

describe("toPythonSamples", () => {
    it("copies emg and pot and drops timestamp", () => {
        const rows = [
            { emg: 1234, pot: 39, timestamp: 1700000000000 },
            { emg: 1300, pot: 39, timestamp: 1700000000020 },
        ];
        const out = toPythonSamples(rows);

        assert.equal(out.length, 2);
        assert.deepEqual(out[0], { emg: 1234, pot: 39 });
        assert.deepEqual(out[1], { emg: 1300, pot: 39 });
        assert.equal(Object.prototype.hasOwnProperty.call(out[0], "timestamp"), false);
    });

    it("does not mutate the original rows", () => {
        const rows = [{ emg: 10, pot: 6, timestamp: 99 }];
        toPythonSamples(rows);
        assert.deepEqual(rows[0], { emg: 10, pot: 6, timestamp: 99 });
    });

    it("preserves order and does not alter values", () => {
        const rows = [
            { emg: 0.5, pot: 58.25, timestamp: 1 },
            { emg: 4095, pot: 0, timestamp: 2 },
        ];
        const out = toPythonSamples(rows);
        assert.equal(out[0].emg, 0.5);
        assert.equal(out[0].pot, 58.25);
        assert.equal(out[1].emg, 4095);
        assert.equal(out[1].pot, 0);
        assert.equal(out[0].emg, rows[0].emg);
        assert.equal(out[1].pot, rows[1].pot);
    });

    it("does not drop valid samples", () => {
        const rows = Array.from({ length: 768 }, (_, i) => ({
            emg: 900 + i,
            pot: 39,
            timestamp: i,
        }));
        assert.equal(toPythonSamples(rows).length, 768);
    });

    it("returns an empty array for a non-array", () => {
        assert.deepEqual(toPythonSamples(null), []);
        assert.deepEqual(toPythonSamples(undefined), []);
    });
});
