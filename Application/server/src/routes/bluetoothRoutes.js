const express = require("express");

const router = express.Router();

const bluetoothController = require("../controllers/bluetoothController");

const { authenticate } = require("../middlewares/authMiddleware");

const validateRequest = require("../middlewares/validationMiddleware");

const {

    connectDeviceValidation

} = require("../validators/bluetoothValidator");

router.post(

    "/connect",

    authenticate,

    connectDeviceValidation,

    validateRequest,

    bluetoothController.connectDevice

);

router.get(

    "/status",

    authenticate,

    bluetoothController.getBluetoothStatus

);

router.post(

    "/disconnect",

    authenticate,

    bluetoothController.disconnectDevice

);

module.exports = router;