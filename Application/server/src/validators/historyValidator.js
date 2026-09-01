const { param } = require("express-validator");

const getHistoryDetailsValidation = [

    param("textId")

        .isInt({ min: 1 })

        .withMessage("Valid text ID is required.")

        .toInt()

];

module.exports = {

    getHistoryDetailsValidation

};