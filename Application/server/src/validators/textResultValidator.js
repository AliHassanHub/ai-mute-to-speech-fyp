const { body } = require("express-validator");
const { isSupportedTargetLanguage } = require("../constants/languages");

const saveTextResultValidation = [

    body("processedId")

        .isInt({ min: 1 })

        .withMessage("Valid processed ID is required.")

        .toInt(),

    body("recognizedText")

        .trim()

        .notEmpty()

        .withMessage("Recognized text is required."),

    body("translatedText")

        .optional()

        .isString()

        .withMessage("Translated text must be a string."),

    body("sourceLanguage")
        .trim()
        .notEmpty()
        .withMessage("Source language is required.")
        .custom((value) => {
            const normalized = String(value).trim().toLowerCase();
            if (normalized !== "english" && normalized !== "en") {
                throw new Error("Source language must be English.");
            }
            return true;
        }),

    body("targetLanguage")
        .trim()
        .notEmpty()
        .withMessage("Target language is required.")
        .custom((value) => {
            if (!isSupportedTargetLanguage(value)) {
                throw new Error(
                    "Target language must be English, Urdu, or Punjabi."
                );
            }
            return true;
        }),

    body("confidenceScore")

        .isFloat({

            min: 0,

            max: 100

        })

        .withMessage(

            "Confidence score must be between 0 and 100."

        )

        .toFloat(),

    body("processingTimeMs")

        .isInt({

            min: 0

        })

        .withMessage(

            "Processing time must be zero or greater."

        )

        .toInt()

];

module.exports = {

    saveTextResultValidation

};