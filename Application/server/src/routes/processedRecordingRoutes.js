const express = require("express");

const router = express.Router();

const processedRecordingController =
require("../controllers/processedRecordingController");

const { authenticate } =
require("../middlewares/authMiddleware");

const validateRequest =
require("../middlewares/validationMiddleware");

const {

    saveProcessedRecordingValidation

} = require("../validators/processedRecordingValidator");

router.post(

    "/",

    authenticate,

    saveProcessedRecordingValidation,

    validateRequest,

    processedRecordingController.saveProcessedRecording

);

router.get(

    "/recording/:recordingId",

    authenticate,

    processedRecordingController.getProcessedRecordingByRecordingId

);

router.get(

    "/:processedId",

    authenticate,

    processedRecordingController.getProcessedRecording

);

router.delete(

    "/:processedId",

    authenticate,

    processedRecordingController.deleteProcessedRecording

);

module.exports = router;