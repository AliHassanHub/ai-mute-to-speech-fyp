const bluetoothService = require("../services/bluetoothService");

const connectDevice = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const {

            deviceName,

            deviceMac

        } = req.body;

        const result = await bluetoothService.connectDevice(

            userId,

            deviceName,

            deviceMac

        );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

const getBluetoothStatus = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const result = await bluetoothService.getBluetoothStatus(

            userId

        );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

const disconnectDevice = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const result = await bluetoothService.disconnectDevice(

            userId

        );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

module.exports = {

    connectDevice,

    getBluetoothStatus,

    disconnectDevice

};