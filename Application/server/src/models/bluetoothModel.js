const pool = require("../config/db");

const getConnectionByUserId = async (userId) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM bluetooth_connections

        WHERE user_id = ?

        LIMIT 1
        `,

        [userId]

    );

    return rows[0];

};

const createConnection = async (

    userId,

    deviceName,

    deviceMac

) => {

    const [result] = await pool.query(

        `
        INSERT INTO bluetooth_connections (

            user_id,

            device_name,

            device_mac,

            connection_status,

            connected_at,

            disconnected_at

        )

        VALUES (

            ?,

            ?,

            ?,

            'connected',

            CURRENT_TIMESTAMP,

            NULL

        )
        `,

        [

            userId,

            deviceName,

            deviceMac

        ]

    );

    return result.insertId;

};

const connectDevice = async (

    userId,

    deviceName,

    deviceMac

) => {

    await pool.query(

        `
        UPDATE bluetooth_connections

        SET

            device_name = ?,

            device_mac = ?,

            connection_status = 'connected',

            connected_at = CURRENT_TIMESTAMP,

            disconnected_at = NULL,

            last_seen = CURRENT_TIMESTAMP

        WHERE user_id = ?
        `,

        [

            deviceName,

            deviceMac,

            userId

        ]

    );

};

const getConnectionById = async (connectionId) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM bluetooth_connections

        WHERE connection_id = ?

        LIMIT 1
        `,

        [connectionId]

    );

    return rows[0];

};

const disconnectDevice = async (userId) => {

    await pool.query(

        `
        UPDATE bluetooth_connections

        SET

            connection_status = 'disconnected',

            disconnected_at = CURRENT_TIMESTAMP,

            last_seen = CURRENT_TIMESTAMP

        WHERE user_id = ?
        `,

        [

            userId

        ]

    );

};

module.exports = {

    getConnectionByUserId,

    createConnection,

    connectDevice,

    disconnectDevice,

    getConnectionById

};