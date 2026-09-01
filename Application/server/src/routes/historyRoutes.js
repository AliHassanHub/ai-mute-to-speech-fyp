const express = require("express");

const router = express.Router();

const historyController = require("../controllers/historyController");

const { authenticate } = require("../middlewares/authMiddleware");

const {

    getHistoryDetailsValidation

} = require("../validators/historyValidator");

const validateRequest = require("../middlewares/validationMiddleware");

router.get(

    "/",

    authenticate,

    historyController.getHistoryList

);

router.get(

    "/:textId",

    authenticate,

    getHistoryDetailsValidation,

    validateRequest,

    historyController.getHistoryDetails

);

router.delete(

    "/:textId",

    authenticate,

    getHistoryDetailsValidation,

    validateRequest,

    historyController.deleteHistory

);

module.exports = router;