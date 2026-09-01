const { body } = require("express-validator");

const startSessionValidation = [
body("deviceName")

    .optional({ nullable: true })

    .trim()

    .notEmpty()

    .withMessage("Device name cannot be empty.")

    .isLength({ max: 100 })

    .withMessage("Device name cannot exceed 100 characters.")

];

const completeSessionValidation = [

    body("wordCount")

        .notEmpty()

        .withMessage("Word count is required.")

        .isInt({ min: 0 })

        .withMessage("Word count must be a non-negative integer."),

    body("averageConfidence")

        .notEmpty()

        .withMessage("Average confidence is required.")

        .isFloat({

            min: 0,

            max: 100

        })

        .withMessage(

            "Average confidence must be between 0 and 100."

        )

];

module.exports = {

    startSessionValidation,

    completeSessionValidation

};