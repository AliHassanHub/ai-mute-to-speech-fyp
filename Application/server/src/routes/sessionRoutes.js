const express = require("express");

const router = express.Router();

const sessionController = require("../controllers/sessionController");

const { authenticate } = require("../middlewares/authMiddleware");

const validateRequest = require("../middlewares/validationMiddleware");

const {

    startSessionValidation,

    completeSessionValidation

} = require("../validators/sessionValidator");

router.get(

    "/current",

    authenticate,

    sessionController.getCurrentSession

);

router.post(

    "/start",

    authenticate,

    startSessionValidation,

    validateRequest,

    sessionController.startSession

);

router.put(

    "/:sessionId/complete",

    authenticate,

    completeSessionValidation,

    validateRequest,

    sessionController.completeSession

);

module.exports = router;