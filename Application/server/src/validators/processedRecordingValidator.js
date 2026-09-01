const { body } = require("express-validator");

const saveProcessedRecordingValidation = [

    body("recordingId")

        .isInt({ min: 1 })

        .withMessage("Valid recording ID is required.")

        .toInt(),

    body("processedData")

        .isObject()

        .withMessage("Processed data must be a valid object."),

    body("featureVector")

        .isObject()

        .withMessage("Feature vector must be a valid object."),

    body("normalizationFactor")

        .isFloat({ min: 0 })

        .withMessage("Normalization factor must be zero or greater.")

        .toFloat(),

    body("noiseReductionLevel")

        .isFloat({ min: 0 })

        .withMessage("Noise reduction level must be zero or greater.")

        .toFloat()

];

module.exports = {

    saveProcessedRecordingValidation

};

