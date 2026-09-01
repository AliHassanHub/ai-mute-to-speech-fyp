const fs = require("fs");

const path = require("path");
const profileModel = require("../models/profileModel");
const bcrypt = require("bcrypt");
const {
    SOURCE_LANGUAGE,
    isSupportedLanguageCode,
    normalizeLanguageCode,
    encodeLanguagePreference,
    parseStoredLanguagePreference,
    buildLanguageSettingsResponse,
} = require("../constants/languages");
const {
    buildNotificationSettingsResponse,
    encodeNotificationPreferences,
    mergeNotificationPreferences,
    parseNotificationPreferences,
} = require("../constants/notifications");

const getProfile = async (userId) => {
    const user = await profileModel.getProfileByUserId(userId);

    if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
    }

    const calibrationStatus =
        user.calibration_id && user.is_active
            ? "Default (Calibrated)"
            : "Not Calibrated";

    const languagePreference = parseStoredLanguagePreference(user.language);

    return {
        user: {
            user_id: user.user_id,
            name: user.name,
            email: user.email,
            profile_image_url: user.profile_image_url,
            language: encodeLanguagePreference(
                languagePreference.translationLanguage,
                languagePreference.speechLanguage
            ),
            targetLanguage: languagePreference.translationLanguageName,
            translationLanguage: languagePreference.translationLanguage,
            speechLanguage: languagePreference.speechLanguage,
            translationLanguageName: languagePreference.translationLanguageName,
            speechLanguageName: languagePreference.speechLanguageName,
            sourceLanguage: SOURCE_LANGUAGE,
            notifications_enabled: Boolean(user.notifications_enabled),
            notification_preferences: parseNotificationPreferences(
                user.notification_preferences
            ),
            calibration_status: calibrationStatus,
            calibration_date: user.calibration_date,
            created_at: user.created_at,
            updated_at: user.updated_at
        },
        language: {
            translationLanguage: languagePreference.translationLanguage,
            speechLanguage: languagePreference.speechLanguage,
            translationLanguageName: languagePreference.translationLanguageName,
            speechLanguageName: languagePreference.speechLanguageName,
            sourceLanguage: SOURCE_LANGUAGE,
        },
        supportedLanguages: buildLanguageSettingsResponse(user.language).supportedLanguages,
    };
};

const updateProfile = async (userId, name) => {
    const existingUser = await profileModel.getUserById(userId);

    if (!existingUser) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
    }

    if (existingUser.name.trim() === name.trim()) {
        const updatedUser = await profileModel.getProfileByUserId(userId);

        return {
            success: true,
            message: "No changes were made.",
            user: updatedUser
        };
    }

    await profileModel.updateProfile(userId, name.trim());

    const updatedUser = await profileModel.getProfileByUserId(userId);

    return {
        success: true,
        message: "Profile updated successfully.",
        user: updatedUser
    };
};

const updateProfileImage = async (

    userId,

    imagePath

) => {


    const user = await profileModel.getUserById(userId);

    if (!user) {

        const error = new Error("User not found.");

        error.status = 404;

        throw error;

    }


    if (user.profile_image_url) {

        const oldImagePath = path.join(

            process.cwd(),

            "uploads",

            user.profile_image_url

        );

        if (fs.existsSync(oldImagePath)) {

            fs.unlinkSync(oldImagePath);

        }

    }

    await profileModel.updateProfileImage(

        userId,

        imagePath

    );

    const updatedUser = await profileModel.getProfileByUserId(userId);

    return {

        success: true,

        message: "Profile image updated successfully.",

        user: updatedUser

    };

};

const changePassword = async (
    userId,
    currentPassword,
    newPassword
) => {
    const user = await profileModel.getPasswordByUserId(userId);

    if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
    }

    const isCurrentPasswordCorrect = await bcrypt.compare(
        currentPassword,
        user.password_hash
    );

    if (!isCurrentPasswordCorrect) {
        const error = new Error("Current password is incorrect.");
        error.status = 400;
        throw error;
    }

    const isSamePassword = await bcrypt.compare(
        newPassword,
        user.password_hash
    );

    if (isSamePassword) {
        const error = new Error(
            "New password must be different from the current password."
        );
        error.status = 400;
        throw error;
    }

    const newPasswordHash = await bcrypt.hash(
        newPassword,
        10
    );

    await profileModel.updatePasswordWithTransaction(
        userId,
        newPasswordHash
    );

    return {

    success: true,

    message: "Password changed successfully. Please login again.",

    requireLogin: true

};

};

const updateNotificationPreference = async (

    userId,

    notificationsEnabled

) => {

    const user = await profileModel.getUserById(

        userId

    );

    if (!user) {

        const error = new Error(

            "User not found."

        );

        error.status = 404;

        throw error;

    }

    await profileModel.updateNotificationPreference(

        userId,

        notificationsEnabled

    );

    return {

        success: true,

        message: "Notification preference updated successfully.",

        notificationsEnabled,

        ...buildNotificationSettingsResponse(
            notificationsEnabled,
            user.notification_preferences
        ),

    };

};

const getNotificationSettings = async (userId) => {
    const user = await profileModel.getUserById(userId);

    if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
    }

    return {
        success: true,
        ...buildNotificationSettingsResponse(
            user.notifications_enabled,
            user.notification_preferences
        ),
    };
};

const updateNotificationSettings = async (
    userId,
    { notificationsEnabled, preferences } = {}
) => {
    const user = await profileModel.getUserById(userId);

    if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
    }

    const resolvedEnabled =
        typeof notificationsEnabled === "boolean"
            ? notificationsEnabled
            : Boolean(user.notifications_enabled);
    const mergedPreferences = mergeNotificationPreferences(
        user.notification_preferences,
        preferences
    );

    await profileModel.updateNotificationSettings(userId, {
        notificationsEnabled:
            typeof notificationsEnabled === "boolean"
                ? notificationsEnabled
                : undefined,
        notificationPreferences: encodeNotificationPreferences(
            mergedPreferences
        ),
    });

    return {
        success: true,
        message: "Notification settings updated successfully.",
        ...buildNotificationSettingsResponse(
            resolvedEnabled,
            mergedPreferences
        ),
    };
};

const updateLanguagePreference = async (
    userId,
    { translationLanguage, speechLanguage, targetLanguage } = {}
) => {
    const user = await profileModel.getUserById(userId);

    if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
    }

    const resolvedTranslation =
        translationLanguage ??
        targetLanguage ??
        parseStoredLanguagePreference(user.language).translationLanguage;
    const resolvedSpeech =
        speechLanguage ??
        parseStoredLanguagePreference(user.language).speechLanguage;

    const translationCode = normalizeLanguageCode(resolvedTranslation);
    const speechCode = normalizeLanguageCode(resolvedSpeech);

    if (!isSupportedLanguageCode(translationCode) || !isSupportedLanguageCode(speechCode)) {
        const error = new Error(
            "Translation and speech languages must be English, Urdu, or Punjabi."
        );
        error.status = 400;
        throw error;
    }

    const storedValue = encodeLanguagePreference(translationCode, speechCode);
    await profileModel.updateLanguagePreference(userId, storedValue);

    const updatedUser = await profileModel.getProfileByUserId(userId);
    const settings = buildLanguageSettingsResponse(updatedUser.language);

    return {
        success: true,
        message: "Language settings updated successfully.",
        targetLanguage: settings.language.translationLanguageName,
        sourceLanguage: SOURCE_LANGUAGE,
        language: settings.language,
        supportedLanguages: settings.supportedLanguages,
        user: {
            ...updatedUser,
            language: storedValue,
            targetLanguage: settings.language.translationLanguageName,
            translationLanguage: settings.language.translationLanguage,
            speechLanguage: settings.language.speechLanguage,
            translationLanguageName: settings.language.translationLanguageName,
            speechLanguageName: settings.language.speechLanguageName,
            sourceLanguage: SOURCE_LANGUAGE,
        },
    };
};

const getLanguageSettings = async (userId) => {
    const user = await profileModel.getUserById(userId);

    if (!user) {
        const error = new Error("User not found.");
        error.status = 404;
        throw error;
    }

    return {
        success: true,
        ...buildLanguageSettingsResponse(user.language),
    };
};

const deleteUserAccount = async (userId) => {

    const user = await profileModel.getUserById(userId);

    if (!user) {

        const error = new Error("User not found.");

        error.status = 404;

        throw error;

    }

    await profileModel.deleteUserAccount(userId);

    return {

        success: true,

        message: "Account deleted successfully.",

        requireLogout: true

    };

};

const logout = async () => {

    return {

        success: true,

        message: "Logged out successfully."

    };

};

module.exports = {

    getProfile,

    updateProfile,

    updateProfileImage,

    changePassword,

    updateNotificationPreference,

    getNotificationSettings,

    updateNotificationSettings,

    updateLanguagePreference,

    getLanguageSettings,

    deleteUserAccount,

    logout

};
