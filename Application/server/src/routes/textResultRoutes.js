const express = require("express");

const router = express.Router();

const textResultController =
require("../controllers/textResultController");

const {

    authenticate

} = require("../middlewares/authMiddleware");

const validateRequest =
require("../middlewares/validationMiddleware");

const {

    saveTextResultValidation

} = require("../validators/textResultValidator");

router.post(

    "/",

    authenticate,

    saveTextResultValidation,

    validateRequest,

    textResultController.saveTextResult

);

router.get(

    "/processed/:processedId",

    authenticate,

    textResultController.getTextResultByProcessedId

);

router.get(

    "/:textId",

    authenticate,

    textResultController.getTextResult

);

router.delete(

    "/:textId",

    authenticate,

    textResultController.deleteTextResult

);

module.exports = router;