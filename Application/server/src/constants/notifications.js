const DEFAULT_NOTIFICATION_PREFERENCES = {
    deviceConnected: true,
    deviceDisconnected: true,
    calibrationComplete: true,
    calibrationRequired: true,
    predictionResult: true,
};

const NOTIFICATION_PREFERENCE_KEYS = Object.keys(
    DEFAULT_NOTIFICATION_PREFERENCES
);

function parseNotificationPreferences(raw) {
    let parsed = raw;

    if (typeof raw === "string") {
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = null;
        }
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    }

    const result = { ...DEFAULT_NOTIFICATION_PREFERENCES };

    for (const key of NOTIFICATION_PREFERENCE_KEYS) {
        if (typeof parsed[key] === "boolean") {
            result[key] = parsed[key];
        }
    }

    return result;
}

function encodeNotificationPreferences(preferences) {
    return JSON.stringify(parseNotificationPreferences(preferences));
}

function buildNotificationSettingsResponse(
    notificationsEnabled,
    rawPreferences
) {
    return {
        notificationsEnabled: Boolean(notificationsEnabled),
        preferences: parseNotificationPreferences(rawPreferences),
    };
}

function shouldNotifyCategory(type, notificationsEnabled, rawPreferences) {
    if (!notificationsEnabled) {
        return false;
    }

    const preferences = parseNotificationPreferences(rawPreferences);
    return Boolean(preferences[type]);
}

function mergeNotificationPreferences(currentPreferences, incomingPreferences) {
    const base = parseNotificationPreferences(currentPreferences);
    const next = { ...base };

    if (!incomingPreferences || typeof incomingPreferences !== "object") {
        return next;
    }

    for (const key of NOTIFICATION_PREFERENCE_KEYS) {
        if (typeof incomingPreferences[key] === "boolean") {
            next[key] = incomingPreferences[key];
        }
    }

    return next;
}

module.exports = {
    DEFAULT_NOTIFICATION_PREFERENCES,
    NOTIFICATION_PREFERENCE_KEYS,
    parseNotificationPreferences,
    encodeNotificationPreferences,
    buildNotificationSettingsResponse,
    shouldNotifyCategory,
    mergeNotificationPreferences,
};
