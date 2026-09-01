const bluetoothModel = require("../models/bluetoothModel");

const connectDevice = async (

    userId,

    deviceName,

    deviceMac

) => {

    const existingConnection = await bluetoothModel.getConnectionByUserId(

        userId

    );

    let connection;

    if (!existingConnection) {

        const connectionId = await bluetoothModel.createConnection(

            userId,

            deviceName,

            deviceMac

        );

        connection = await bluetoothModel.getConnectionById(

            connectionId

        );

    }

    else {

        await bluetoothModel.connectDevice(

            userId,

            deviceName,

            deviceMac

        );

        connection = await bluetoothModel.getConnectionByUserId(

            userId

        );

    }

    return {

        success: true,

        message: "Device connected successfully.",

        connection: {

            connectionId: connection.connection_id,

            deviceName: connection.device_name,

            deviceMac: connection.device_mac,

            connectionStatus: connection.connection_status,

            connectedAt: connection.connected_at,

            lastSeen: connection.last_seen

        }

    };

};

const getBluetoothStatus = async (userId) => {

    const connection = await bluetoothModel.getConnectionByUserId(

        userId

    );

    if (

        !connection ||

        connection.connection_status !== "connected"

    ) {

        return {

            success: true,

            isConnected: false,

            connection: null

        };

    }

    return {

        success: true,

        isConnected: true,

        connection: {

            connectionId: connection.connection_id,

            deviceName: connection.device_name,

            deviceMac: connection.device_mac,

            connectionStatus: connection.connection_status,

            connectedAt: connection.connected_at,

            lastSeen: connection.last_seen

        }

    };

};

const disconnectDevice = async (userId) => {

    const connection = await bluetoothModel.getConnectionByUserId(

        userId

    );

    if (!connection) {

        throw {

            status: 404,

            message: "Bluetooth connection not found."

        };

    }

    if (connection.connection_status === "disconnected") {

        return {

            success: true,

            message: "Device is already disconnected.",

            connection: {

                connectionId: connection.connection_id,

                connectionStatus: connection.connection_status,

                disconnectedAt: connection.disconnected_at,

                lastSeen: connection.last_seen

            }

        };

    }

    await bluetoothModel.disconnectDevice(

        userId

    );

    const updatedConnection = await bluetoothModel.getConnectionByUserId(

        userId

    );

    return {

        success: true,

        message: "Device disconnected successfully.",

        connection: {

            connectionId: updatedConnection.connection_id,

            connectionStatus: updatedConnection.connection_status,

            disconnectedAt: updatedConnection.disconnected_at,

            lastSeen: updatedConnection.last_seen

        }

    };

};

module.exports = {

    connectDevice,

    getBluetoothStatus,

    disconnectDevice

};