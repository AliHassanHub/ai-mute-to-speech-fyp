const { body } = require("express-validator");
const { isSupportedTargetLanguage } = require("../constants/languages");
const aiServiceConfig = require("../config/aiService");

// Hardware ranges, matching the ESP32 sketch ("EMG:<0-4095>  POT:<0-100>") and
// the AI service's own validation.
const EMG_MIN = -4095;
const EMG_MAX = 4095;
const POT_MIN = 0;
const POT_MAX = 4095;

const inferRecordingValidation = [
    body("targetLanguage")
        .optional()
        .trim()
        .custom((value) => {
            if (value == null || value === "") {
                return true;
            }
            if (!isSupportedTargetLanguage(value)) {
                throw new Error(
                    "targetLanguage must be English, Urdu, or Punjabi."
                );
            }
            return true;
        }),
    body("minConfidence")
        .optional()
        .isFloat({ min: 0, max: 1 })
        .withMessage("minConfidence must be between 0 and 1."),
];

/**
 * Validate a sample window. Invalid samples are rejected, never repaired.
 *
 * Checks every row rather than sampling, because a single NaN would otherwise
 * reach the model and be silently coerced.
 */
function validateSampleRows(rows, { requirePot = true } = {}) {
    if (!Array.isArray(rows)) {
        throw new Error("signal.rows must be an array.");
    }

    if (rows.length === 0) {
        throw new Error("signal.rows must not be empty.");
    }

    if (rows.length > aiServiceConfig.maxWindowSamples) {
        throw new Error(
            `signal.rows must not exceed ${aiServiceConfig.maxWindowSamples} samples.`
        );
    }

    for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];

        if (row == null || typeof row !== "object" || Array.isArray(row)) {
            throw new Error(`signal.rows[${index}] must be an object.`);
        }

        // Reject strings, booleans and null outright: only real numbers pass.
        if (typeof row.emg !== "number" || !Number.isFinite(row.emg)) {
            throw new Error(
                `signal.rows[${index}].emg must be a finite number.`
            );
        }

        if (row.emg < EMG_MIN || row.emg > EMG_MAX) {
            throw new Error(
                `signal.rows[${index}].emg must be between ${EMG_MIN} and ${EMG_MAX}.`
            );
        }

        if (requirePot) {
            // POT is not optional: the calibrated model uses it to select the
            // candidate label, so a missing channel cannot be defaulted.
            if (typeof row.pot !== "number" || !Number.isFinite(row.pot)) {
                throw new Error(
                    `signal.rows[${index}].pot must be a finite number. The calibrated model requires both EMG and POT.`
                );
            }

            if (row.pot < POT_MIN || row.pot > POT_MAX) {
                throw new Error(
                    `signal.rows[${index}].pot must be between ${POT_MIN} and ${POT_MAX}.`
                );
            }
        }

        if (row.timestamp !== undefined) {
            if (typeof row.timestamp !== "number" || !Number.isFinite(row.timestamp)) {
                throw new Error(
                    `signal.rows[${index}].timestamp must be a finite number when provided.`
                );
            }
            if (row.timestamp < 0) {
                throw new Error(
                    `signal.rows[${index}].timestamp must not be negative.`
                );
            }
        }
    }

    return true;
}

const signalValidation = (options = {}) => [
    body("signal")
        .exists()
        .withMessage("signal is required.")
        .bail()
        .isObject()
        .withMessage("signal must be an object."),
    body("signal.format")
        .exists()
        .withMessage("signal.format is required.")
        .bail()
        .equals("samples")
        .withMessage('signal.format must be "samples".'),
    body("signal.rows")
        .exists()
        .withMessage("signal.rows is required.")
        .bail()
        .custom((rows) => validateSampleRows(rows, options)),
];

const predictWordValidation = [
    ...signalValidation(),
    body("minConfidence")
        .optional()
        .isFloat({ min: 0, max: 1 })
        .withMessage("minConfidence must be between 0 and 1."),
    body("sessionId")
        .optional()
        .isString()
        .withMessage("sessionId must be a string.")
        .bail()
        .isLength({ min: 8, max: 64 })
        .withMessage("sessionId is not a valid session identifier."),
];

const persistWordValidation = [
    ...signalValidation(),
    body("minConfidence")
        .optional()
        .isFloat({ min: 0, max: 1 })
        .withMessage("minConfidence must be between 0 and 1."),
    body("targetLanguage")
        .optional()
        .trim()
        .custom((value) => {
            if (value == null || value === "") {
                return true;
            }
            if (!isSupportedTargetLanguage(value)) {
                throw new Error(
                    "targetLanguage must be English, Urdu, or Punjabi."
                );
            }
            return true;
        }),
    body("durationMs")
        .optional()
        .isInt({ min: 1 })
        .withMessage("durationMs must be a positive integer."),
    body("signalLabel")
        .optional()
        .isString()
        .withMessage("signalLabel must be a string.")
        .bail()
        .isLength({ max: 120 })
        .withMessage("signalLabel must be at most 120 characters."),
    body("textId")
        .optional()
        .isInt({ min: 1 })
        .withMessage("textId must be a positive integer."),
    body("deviceName")
        .optional()
        .isString()
        .withMessage("deviceName must be a string.")
        .bail()
        .isLength({ max: 120 })
        .withMessage("deviceName must be at most 120 characters."),
];

// A neutral baseline still carries POT, because the client streams whole samples.
const createSessionValidation = [...signalValidation()];

module.exports = {
    inferRecordingValidation,
    predictWordValidation,
    persistWordValidation,
    createSessionValidation,
    validateSampleRows,
};
