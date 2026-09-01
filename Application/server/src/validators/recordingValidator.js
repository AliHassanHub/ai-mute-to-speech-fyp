const { body } = require("express-validator");

const saveRecordingValidation = [

    body("sessionId")

        .isInt({ min: 1 })

        .withMessage("Valid session ID is required.")

        .toInt(),

    body("rawSignalData")

        .isArray({ min: 1 })

        .withMessage("Raw signal data must be a non-empty array."),

    body("channelCount")

        .isInt({ min: 2 })

        .withMessage("Channel count must be 2 for EMG and potentiometer.")

        .toInt(),

    body("samplingRate")

        .isInt({ min: 1 })

        .withMessage("Sampling rate must be greater than zero.")

        .toInt(),

    body("durationMs")

        .isInt({ min: 1 })

        .withMessage("Duration must be greater than zero.")

        .toInt(),

    body("signalLabel")

        .optional()

        .trim()

        .isLength({ max: 50 })

        .withMessage("Signal label cannot exceed 50 characters.")

];

module.exports = {

    saveRecordingValidation

};