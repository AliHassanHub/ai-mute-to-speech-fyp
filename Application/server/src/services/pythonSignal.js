/**
 * Mapping at the Node → Python boundary.
 *
 * The mobile API keeps per-sample timestamps (timing, Hz, debug). Python's
 * SampleRow is extra="forbid" and only accepts { emg, pot }. Strip here, never
 * in the React Native buffer or the public /api/inference/word body.
 *
 * Values are copied, not mutated, rounded, or dropped.
 */

function toPythonSamples(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }

    return rows.map((row) => ({
        emg: row.emg,
        pot: row.pot,
    }));
}

module.exports = { toPythonSamples };
