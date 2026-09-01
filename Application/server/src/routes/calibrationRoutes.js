const express = require("express");

const router = express.Router();

const calibrationController = require("../controllers/calibrationController");

const { authenticate } = require("../middlewares/authMiddleware");

const validateRequest = require("../middlewares/validationMiddleware");

const {

    saveCalibrationValidation,
    calibrateWordValidation,
    saveNeutralBaselineValidation,

} = require("../validators/calibrationValidator");

router.get(

    "/",

    authenticate,

    calibrationController.getActiveCalibration

);

router.post(

    "/",

    authenticate,

    saveCalibrationValidation,

    validateRequest,

    calibrationController.saveCalibration

);

router.get(

    "/status",

    authenticate,

    calibrationController.getCalibrationStatus

);

router.get(

    "/profile",

    authenticate,

    calibrationController.getPersonalizedProfile

);

router.post(

    "/word",

    authenticate,

    calibrateWordValidation,

    validateRequest,

    calibrationController.calibrateWord

);

router.post(

    "/neutral",

    authenticate,

    saveNeutralBaselineValidation,

    validateRequest,

    calibrationController.saveNeutralBaseline

);

module.exports = router;