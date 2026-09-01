/**
 * Notification preferences API and constants tests.
 */

const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, it } = require("node:test");

const {
    DEFAULT_NOTIFICATION_PREFERENCES,
    parseNotificationPreferences,
    buildNotificationSettingsResponse,
    shouldNotifyCategory,
    mergeNotificationPreferences,
} = require("../src/constants/notifications");

const testApp = require("./helpers/testApp");

let app;
let profileModel;
let originals = {};
const storedSettingsByUser = new Map();

function defaultSettings() {
    return {
        notificationsEnabled: 1,
        notificationPreferences: JSON.stringify(
            DEFAULT_NOTIFICATION_PREFERENCES
        ),
    };
}

function installProfileMocks() {
    profileModel = require("../src/models/profileModel");

    originals = {
        getUserById: profileModel.getUserById,
        getProfileByUserId: profileModel.getProfileByUserId,
        updateNotificationPreference: profileModel.updateNotificationPreference,
        updateNotificationSettings: profileModel.updateNotificationSettings,
    };

    storedSettingsByUser.set(testApp.TEST_USER.user_id, defaultSettings());
    storedSettingsByUser.set(testApp.OTHER_USER.user_id, defaultSettings());

    profileModel.getUserById = async (userId) => {
        const settings =
            storedSettingsByUser.get(Number(userId)) ?? defaultSettings();
        return {
            user_id: Number(userId),
            name: "Test User",
            email: "test@example.test",
            language: "en:en",
            notifications_enabled: settings.notificationsEnabled,
            notification_preferences: settings.notificationPreferences,
        };
    };

    profileModel.getProfileByUserId = async (userId) => {
        const settings =
            storedSettingsByUser.get(Number(userId)) ?? defaultSettings();
        return {
            user_id: Number(userId),
            name: "Test User",
            email: "test@example.test",
            language: "en:en",
            notifications_enabled: settings.notificationsEnabled,
            notification_preferences: settings.notificationPreferences,
            profile_image_url: null,
            calibration_id: null,
            is_active: 0,
            calibration_date: null,
            created_at: new Date(),
            updated_at: new Date(),
        };
    };

    profileModel.updateNotificationPreference = async (
        userId,
        notificationsEnabled
    ) => {
        const current =
            storedSettingsByUser.get(Number(userId)) ?? defaultSettings();
        storedSettingsByUser.set(Number(userId), {
            ...current,
            notificationsEnabled: notificationsEnabled ? 1 : 0,
        });
        return { affectedRows: 1 };
    };

    profileModel.updateNotificationSettings = async (
        userId,
        { notificationsEnabled, notificationPreferences }
    ) => {
        const current =
            storedSettingsByUser.get(Number(userId)) ?? defaultSettings();
        storedSettingsByUser.set(Number(userId), {
            notificationsEnabled:
                typeof notificationsEnabled === "boolean"
                    ? notificationsEnabled
                        ? 1
                        : 0
                    : current.notificationsEnabled,
            notificationPreferences:
                notificationPreferences ?? current.notificationPreferences,
        });
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
    storedSettingsByUser.set(testApp.TEST_USER.user_id, defaultSettings());
    storedSettingsByUser.set(testApp.OTHER_USER.user_id, defaultSettings());
});

describe("notification constants", () => {
    it("parses stored JSON preferences with defaults", () => {
        const parsed = parseNotificationPreferences(
            JSON.stringify({
                deviceConnected: false,
                predictionResult: false,
            })
        );

        assert.equal(parsed.deviceConnected, false);
        assert.equal(parsed.deviceDisconnected, true);
        assert.equal(parsed.predictionResult, false);
    });

    it("merges partial preference updates without dropping existing values", () => {
        const merged = mergeNotificationPreferences(
            { deviceConnected: false, deviceDisconnected: true },
            { calibrationComplete: false }
        );

        assert.equal(merged.deviceConnected, false);
        assert.equal(merged.calibrationComplete, false);
        assert.equal(merged.deviceDisconnected, true);
    });

    it("blocks all categories when master switch is off", () => {
        const response = buildNotificationSettingsResponse(
            false,
            DEFAULT_NOTIFICATION_PREFERENCES
        );

        assert.equal(
            shouldNotifyCategory(
                "deviceConnected",
                response.notificationsEnabled,
                response.preferences
            ),
            false
        );
    });
});

describe("notification preferences API", () => {
    it("returns notification settings for authenticated user", async () => {
        const res = await app.request("GET", "/api/profile/notifications");

        assert.equal(res.status, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.notificationsEnabled, true);
        assert.equal(res.body.preferences.deviceConnected, true);
    });

    it("updates master toggle without erasing individual preferences", async () => {
        storedSettingsByUser.set(testApp.TEST_USER.user_id, {
            notificationsEnabled: 1,
            notificationPreferences: JSON.stringify({
                ...DEFAULT_NOTIFICATION_PREFERENCES,
                deviceConnected: false,
            }),
        });

        const res = await app.request("PUT", "/api/profile/notifications", {
            body: { notificationsEnabled: false },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.notificationsEnabled, false);
        assert.equal(res.body.preferences.deviceConnected, false);
    });

    it("persists individual category preferences", async () => {
        const res = await app.request("PUT", "/api/profile/notifications", {
            body: {
                notificationsEnabled: true,
                preferences: {
                    deviceConnected: false,
                    predictionResult: false,
                },
            },
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.preferences.deviceConnected, false);
        assert.equal(res.body.preferences.predictionResult, false);
        assert.equal(res.body.preferences.calibrationComplete, true);
    });

    it("isolates notification settings between users", async () => {
        await app.request("PUT", "/api/profile/notifications", {
            body: {
                notificationsEnabled: true,
                preferences: { deviceConnected: false },
            },
        });

        const other = await app.request("GET", "/api/profile/notifications", {
            token: app.tokenFor(testApp.OTHER_USER),
        });

        assert.equal(other.status, 200);
        assert.equal(other.body.preferences.deviceConnected, true);
    });
});
