const { body } = require("express-validator");
const { isSupportedLanguageCode } = require("../constants/languages");

const updateProfileValidation = [
    body("name")
        .trim()
        .notEmpty()
        .withMessage("Name is required.")
        .isLength({
            min: 3,
            max: 100,
        })
        .withMessage("Name must be between 3 and 100 characters."),
];

const changePasswordValidation = [
    body("currentPassword")
        .trim()
        .notEmpty()
        .withMessage("Current password is required."),
    body("newPassword")
        .notEmpty()
        .withMessage("New password is required.")
        .isLength({ min: 8 })
        .withMessage("Password must be at least 8 characters.")
        .matches(/[A-Z]/)
        .withMessage("Password must contain at least one uppercase letter.")
        .matches(/[a-z]/)
        .withMessage("Password must contain at least one lowercase letter.")
        .matches(/[0-9]/)
        .withMessage("Password must contain at least one number.")
        .matches(/[!@#$%^&*(),.?":{}|<>]/)
        .withMessage("Password must contain at least one special character."),
    body("confirmPassword").custom((value, { req }) => {
        if (value !== req.body.newPassword) {
            throw new Error("Passwords do not match.");
        }
        return true;
    }),
];

const notificationPreferenceValidation = [
    body("notificationsEnabled")
        .optional()
        .isBoolean()
        .withMessage("Notification preference must be true or false."),
    body("preferences")
        .optional()
        .isObject()
        .withMessage("Notification preferences must be an object."),
    body("preferences.deviceConnected")
        .optional()
        .isBoolean()
        .withMessage("deviceConnected must be true or false."),
    body("preferences.deviceDisconnected")
        .optional()
        .isBoolean()
        .withMessage("deviceDisconnected must be true or false."),
    body("preferences.calibrationComplete")
        .optional()
        .isBoolean()
        .withMessage("calibrationComplete must be true or false."),
    body("preferences.calibrationRequired")
        .optional()
        .isBoolean()
        .withMessage("calibrationRequired must be true or false."),
    body("preferences.predictionResult")
        .optional()
        .isBoolean()
        .withMessage("predictionResult must be true or false."),
    body().custom((_, { req }) => {
        if (
            req.body.notificationsEnabled === undefined &&
            req.body.preferences === undefined
        ) {
            throw new Error(
                "notificationsEnabled or preferences is required."
            );
        }
        return true;
    }),
];

function validateLanguageField(fieldName) {
    return body(fieldName)
        .optional()
        .trim()
        .notEmpty()
        .withMessage(`${fieldName} is required.`)
        .custom((value) => {
            if (!isSupportedLanguageCode(value)) {
                throw new Error(
                    `${fieldName} must be English, Urdu, or Punjabi.`
                );
            }
            return true;
        });
}

const languagePreferenceValidation = [
    validateLanguageField("translationLanguage"),
    validateLanguageField("speechLanguage"),
    body("targetLanguage")
        .optional()
        .trim()
        .custom((value, { req }) => {
            if (
                !req.body.translationLanguage &&
                !req.body.speechLanguage &&
                !value
            ) {
                throw new Error(
                    "translationLanguage and speechLanguage are required."
                );
            }
            if (value && !isSupportedLanguageCode(value)) {
                throw new Error(
                    "Target language must be English, Urdu, or Punjabi."
                );
            }
            return true;
        }),
    body().custom((_, { req }) => {
        if (
            !req.body.translationLanguage &&
            !req.body.speechLanguage &&
            !req.body.targetLanguage
        ) {
            throw new Error(
                "translationLanguage and speechLanguage are required."
            );
        }
        return true;
    }),
];

module.exports = {
    updateProfileValidation,
    changePasswordValidation,
    notificationPreferenceValidation,
    languagePreferenceValidation,
};
