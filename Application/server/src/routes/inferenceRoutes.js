const express = require("express");

const router = express.Router();

const inferenceController = require("../controllers/inferenceController");
const { authenticate } = require("../middlewares/authMiddleware");
const validateRequest = require("../middlewares/validationMiddleware");
const {
    inferRecordingValidation,
    predictWordValidation,
    persistWordValidation,
    createSessionValidation,
} = require("../validators/inferenceValidator");

router.get(
    "/status",
    authenticate,
    inferenceController.getModelStatus
);

router.get(
    "/health",
    authenticate,
    inferenceController.getAiHealth
);

// Direct window prediction. Every request must carry a complete inference
// window; the endpoint answers { ready: false } rather than guessing when the
// window is short, so a rolling-window client can keep buffering.
router.post(
    "/word",
    authenticate,
    predictWordValidation,
    validateRequest,
    inferenceController.predictWord
);

router.post(
    "/word/persist",
    authenticate,
    persistWordValidation,
    validateRequest,
    inferenceController.persistWordPrediction
);

router.post(
    "/sessions",
    authenticate,
    createSessionValidation,
    validateRequest,
    inferenceController.createPredictionSession
);

router.get(
    "/sessions/current",
    authenticate,
    inferenceController.getPredictionSession
);

router.delete(
    "/sessions/current",
    authenticate,
    inferenceController.clearPredictionSession
);

router.post(
    "/recordings/:recordingId/infer",
    authenticate,
    inferRecordingValidation,
    validateRequest,
    inferenceController.inferRecording
);

module.exports = router;
