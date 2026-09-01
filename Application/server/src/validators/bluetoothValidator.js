const { body } = require("express-validator");

const connectDeviceValidation = [

    body("deviceName")

        .trim()

        .notEmpty()

        .withMessage("Device name is required.")

        .isLength({ max: 100 })

        .withMessage("Device name cannot exceed 100 characters."),

    body("deviceMac")

        .optional()

        .trim()

        .isLength({ max: 50 })

        .withMessage("Device MAC address cannot exceed 50 characters.")

];

module.exports = {

    connectDeviceValidation

};