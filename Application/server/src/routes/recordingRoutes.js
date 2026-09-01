const express = require("express");

const router = express.Router();

const recordingController = require("../controllers/recordingController");

const { authenticate } = require("../middlewares/authMiddleware");

const validateRequest = require("../middlewares/validationMiddleware");

const {

    saveRecordingValidation

} = require("../validators/recordingValidator");

router.post(

    "/",

    authenticate,

    saveRecordingValidation,

    validateRequest,

    recordingController.saveRecording

);

router.get(

    "/session/:sessionId",

    authenticate,

    recordingController.getSessionRecordings

);

router.get(

    "/:recordingId",

    authenticate,

    recordingController.getRecording

);

router.delete(

    "/:recordingId",

    authenticate,

    recordingController.deleteRecording

);

module.exports = router;