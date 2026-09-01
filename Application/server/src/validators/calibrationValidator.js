const { body } = require("express-validator");
const aiServiceConfig = require("../config/aiService");
const { validateSampleRows } = require("./inferenceValidator");

const saveCalibrationValidation = [

    body("baselineValue")

        .notEmpty()

        .withMessage("Baseline value is required.")

        .isFloat()

        .withMessage("Baseline value must be a valid number.")

        .toFloat(),

    body("thresholdLevel")

        .notEmpty()

        .withMessage("Threshold level is required.")

        .isFloat()

        .withMessage("Threshold level must be a valid number.")

        .toFloat(),

    body("calibrationData")

        .notEmpty()

        .withMessage("Calibration data is required.")

        .isString()

        .withMessage("Calibration data must be a string.")

];

function validateCalibrationCaptures(captures) {
    if (!Array.isArray(captures) || captures.length === 0) {
        throw new Error("captures must be a non-empty array.");
    }
    if (captures.length > aiServiceConfig.maxCalibrationCaptures) {
        throw new Error(
            `captures must not exceed ${aiServiceConfig.maxCalibrationCaptures} items.`
        );
    }
    captures.forEach((capture, index) => {
        if (!capture || typeof capture !== "object") {
            throw new Error(`captures[${index}] must be an object.`);
        }
        if (!capture.signal || capture.signal.format !== "samples") {
            throw new Error(
                `captures[${index}].signal.format must be "samples".`
            );
        }
        validateSampleRows(capture.signal.rows);
        if (capture.signal.rows.length < aiServiceConfig.minCalibrationSamples) {
            throw new Error(
                `captures[${index}] needs at least ${aiServiceConfig.minCalibrationSamples} samples.`
            );
        }
    });
    return true;
}

const calibrateWordValidation = [
    body("word")
        .notEmpty()
        .withMessage("word is required.")
        .isString()
        .withMessage("word must be a string.")
        .bail()
        .isLength({ min: 1, max: 50 })
        .withMessage("word must be between 1 and 50 characters."),
    body("captures")
        .exists()
        .withMessage("captures is required.")
        .bail()
        .custom(validateCalibrationCaptures),
    body("idempotencyKey")
        .optional()
        .isString()
        .withMessage("idempotencyKey must be a string.")
        .bail()
        .isLength({ min: 8, max: 128 })
        .withMessage("idempotencyKey must be between 8 and 128 characters."),
];

const saveNeutralBaselineValidation = [
    body("captures")
        .exists()
        .withMessage("captures is required.")
        .bail()
        .custom((captures) => {
            if (!Array.isArray(captures) || captures.length !== 1) {
                throw new Error("Neutral baseline requires exactly one capture.");
            }
            validateCalibrationCaptures(captures);
            return true;
        }),
];

module.exports = {
    saveCalibrationValidation,
    calibrateWordValidation,
    saveNeutralBaselineValidation,
};