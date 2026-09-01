/**
 * Active vocabulary exposure for personalized calibration.
 */

const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, it } = require("node:test");

const stubAiService = require("./helpers/stubAiService");
const testApp = require("./helpers/testApp");

before(async () => {
    stub = await stubAiService.start();
    process.env.AI_SERVICE_URL = stub.baseUrl;
    app = await testApp.start();
});

after(async () => {
    await app.stop();
    await stub.stop();
});

describe("GET /api/calibration/profile vocabulary", () => {
    beforeEach(() => {
        stub.reset();
        stub.setLabels(stubAiService.FULL_VOCABULARY_LABELS);
    });

    it("returns all nine active model labels including up", async () => {
        const res = await app.request("GET", "/api/calibration/profile");

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.vocabulary.length, 9);
        assert.ok(res.body.vocabulary.includes("up"));
        assert.ok(res.body.vocabulary.includes("land"));
    });

    it("does not fabricate personalized rows for uncalibrated up", async () => {
        const res = await app.request("GET", "/api/calibration/profile");

        assert.equal(res.status, 200);
        const up = res.body.words.find((item) => String(item.word).toLowerCase() === "up");
        assert.equal(up, undefined);
    });
});
