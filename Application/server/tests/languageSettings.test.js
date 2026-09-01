/**
 * Language settings API and preference encoding tests.
 */

const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, it } = require("node:test");

const {
    SUPPORTED_LANGUAGES,
    encodeLanguagePreference,
    parseStoredLanguagePreference,
    buildLanguageSettingsResponse,
    normalizeLanguageCode,
    isSupportedLanguageCode,
} = require("../src/constants/languages");

const testApp = require("./helpers/testApp");

let app;
let profileModel;
let originals = {};
let storedLanguageByUser = new Map();

function installProfileMocks() {
    profileModel = require("../src/models/profileModel");

    originals = {
        getUserById: profileModel.getUserById,
        getProfileByUserId: profileModel.getProfileByUserId,
        updateLanguagePreference: profileModel.updateLanguagePreference,
    };

    storedLanguageByUser.set(testApp.TEST_USER.user_id, "English");
    storedLanguageByUser.set(testApp.OTHER_USER.user_id, "en:en");

    profileModel.getUserById = async (userId) => {
        const language = storedLanguageByUser.get(Number(userId)) ?? "en:en";
        return {
            user_id: Number(userId),
            name: "Test User",
            email: "test@example.test",
            language,
            notifications_enabled: 1,
        };
    };

    profileModel.getProfileByUserId = async (userId) => {
        const language = storedLanguageByUser.get(Number(userId)) ?? "en:en";
        return {
            user_id: Number(userId),
            name: "Test User",
            email: "test@example.test",
            language,
            notifications_enabled: 1,
            profile_image_url: null,
            calibration_id: null,
            is_active: 0,
            calibration_date: null,
            created_at: new Date(),
            updated_at: new Date(),
        };
    };

    profileModel.updateLanguagePreference = async (userId, languageValue) => {
        storedLanguageByUser.set(Number(userId), languageValue);
        return { affectedRows: 1 };
    };
}

function restoreProfileMocks() {
    for (const [key, value] of Object.entries(originals)) {
        profileModel[key] = value;
    }
}

before(async () => {
    installProfileMocks();
    app = await testApp.start();
});

after(async () => {
    restoreProfileMocks();
    await app.stop();
});

beforeEach(() => {
    storedLanguageByUser.set(testApp.TEST_USER.user_id, "English");
    storedLanguageByUser.set(testApp.OTHER_USER.user_id, "en:en");
});

describe("languages constants", () => {
    it("returns all three supported languages", () => {
        assert.equal(SUPPORTED_LANGUAGES.length, 3);
        assert.deepEqual(
            SUPPORTED_LANGUAGES.map((entry) => entry.code),
            ["en", "ur", "pa"]
        );
    });

    it("encodes and parses independent translation and speech codes", () => {
        const encoded = encodeLanguagePreference("ur", "pa");
        assert.equal(encoded, "ur:pa");

        const parsed = parseStoredLanguagePreference(encoded);
        assert.equal(parsed.translationLanguage, "ur");
        assert.equal(parsed.speechLanguage, "pa");
    });

    it("maps legacy English profile values to both fields", () => {
        const parsed = parseStoredLanguagePreference("English");
        assert.equal(parsed.translationLanguage, "en");
        assert.equal(parsed.speechLanguage, "en");
    });

    it("maps legacy Urdu profile values to both fields", () => {
        const parsed = parseStoredLanguagePreference("Urdu");
        assert.equal(parsed.translationLanguage, "ur");
        assert.equal(parsed.speechLanguage, "ur");
    });

    it("always returns supportedLanguages as an array", () => {
        const response = buildLanguageSettingsResponse(null);
        assert.ok(Array.isArray(response.supportedLanguages));
        assert.equal(response.supportedLanguages.length, 3);
    });

    it("rejects unsupported language codes during normalization fallback", () => {
        assert.equal(normalizeLanguageCode("fr"), "en");
        assert.equal(isSupportedLanguageCode("fr"), false);
        assert.equal(isSupportedLanguageCode("pa"), true);
    });
});

describe("GET /api/profile/language", () => {
    it("requires authentication", async () => {
        const res = await app.request("GET", "/api/profile/language", { token: null });
        assert.equal(res.status, 401);
    });

    it("returns translation and speech language with supportedLanguages array", async () => {
        storedLanguageByUser.set(testApp.TEST_USER.user_id, "ur:pa");

        const res = await app.request("GET", "/api/profile/language");

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.language.translationLanguage, "ur");
        assert.equal(res.body.language.speechLanguage, "pa");
        assert.ok(Array.isArray(res.body.supportedLanguages));
        assert.equal(res.body.supportedLanguages.length, 3);
    });

    it("handles legacy English profile without speech language field", async () => {
        storedLanguageByUser.set(testApp.TEST_USER.user_id, "English");

        const res = await app.request("GET", "/api/profile/language");

        assert.equal(res.status, 200);
        assert.equal(res.body.language.translationLanguage, "en");
        assert.equal(res.body.language.speechLanguage, "en");
    });
});

describe("PUT /api/profile/language", () => {
    it("persists independent translation and speech languages", async () => {
        const res = await app.request("PUT", "/api/profile/language", {
            body: {
                translationLanguage: "ur",
                speechLanguage: "en",
            },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.language.translationLanguage, "ur");
        assert.equal(res.body.language.speechLanguage, "en");
        assert.equal(storedLanguageByUser.get(testApp.TEST_USER.user_id), "ur:en");
    });

    it("persists Punjabi for both fields", async () => {
        const res = await app.request("PUT", "/api/profile/language", {
            body: {
                translationLanguage: "pa",
                speechLanguage: "pa",
            },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.language.translationLanguage, "pa");
        assert.equal(res.body.language.speechLanguage, "pa");
    });

    it("rejects invalid language values", async () => {
        const res = await app.request("PUT", "/api/profile/language", {
            body: {
                translationLanguage: "French",
                speechLanguage: "en",
            },
        });

        assert.equal(res.status, 400);
        assert.equal(res.body.success, false);
    });

    it("keeps user language settings isolated per account", async () => {
        await app.request("PUT", "/api/profile/language", {
            body: {
                translationLanguage: "ur",
                speechLanguage: "pa",
            },
        });

        const other = await app.request("GET", "/api/profile/language", {
            token: app.tokenFor(testApp.OTHER_USER),
        });

        assert.equal(other.body.language.translationLanguage, "en");
        assert.equal(other.body.language.speechLanguage, "en");
    });

    it("reload preserves saved settings", async () => {
        await app.request("PUT", "/api/profile/language", {
            body: {
                translationLanguage: "pa",
                speechLanguage: "ur",
            },
        });

        const reload = await app.request("GET", "/api/profile/language");
        assert.equal(reload.body.language.translationLanguage, "pa");
        assert.equal(reload.body.language.speechLanguage, "ur");
    });
});
