const pool = require("../config/db");

const getActiveCalibrationByUserId = async (userId) => {

    const [rows] = await pool.query(

        `
        SELECT

            calibration_id,

            baseline_value,

            threshold_level,

            calibration_data,

            calibration_date,

            is_active

        FROM calibration_profiles

        WHERE user_id = ?

        AND is_active = TRUE

        ORDER BY calibration_date DESC

        LIMIT 1
        `,

        [

            userId

        ]

    );

    return rows[0];

};

const deactivateActiveCalibration = async (userId) => {

    await pool.query(

        `
        UPDATE calibration_profiles

        SET

            is_active = FALSE

        WHERE user_id = ?

        AND is_active = TRUE
        `,

        [

            userId

        ]

    );

};

const createCalibration = async (

    userId,

    baselineValue,

    thresholdLevel,

    calibrationData

) => {

    const [result] = await pool.query(

        `
        INSERT INTO calibration_profiles (

            user_id,

            baseline_value,

            threshold_level,

            calibration_data,

            is_active

        )

        VALUES (?, ?, ?, ?, TRUE)
        `,

        [

            userId,

            baselineValue,

            thresholdLevel,

            calibrationData

        ]

    );

    return result.insertId;

};

const getCalibrationById = async (calibrationId) => {

    const [rows] = await pool.query(

        `
        SELECT

            calibration_id,

            baseline_value,

            threshold_level,

            calibration_data,

            calibration_date,

            is_active

        FROM calibration_profiles

        WHERE calibration_id = ?

        LIMIT 1
        `,

        [

            calibrationId

        ]

    );

    return rows[0];

};

const saveCalibrationTransaction = async (
    userId,
    baselineValue,
    thresholdLevel,
    calibrationData
) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        await connection.query(
            `
            UPDATE calibration_profiles
            SET is_active = FALSE
            WHERE user_id = ?
            AND is_active = TRUE
            `,
            [userId]
        );

        const [result] = await connection.query(
            `
            INSERT INTO calibration_profiles (
                user_id,
                baseline_value,
                threshold_level,
                calibration_data,
                is_active
            )
            VALUES (?, ?, ?, ?, TRUE)
            `,
            [userId, baselineValue, thresholdLevel, calibrationData]
        );

        const calibrationId = result.insertId;

        const [rows] = await connection.query(
            `
            SELECT
                calibration_id,
                baseline_value,
                threshold_level,
                calibration_data,
                calibration_date,
                is_active
            FROM calibration_profiles
            WHERE calibration_id = ?
            LIMIT 1
            `,
            [calibrationId]
        );

        await connection.commit();

        return rows[0];
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

module.exports = {

    getActiveCalibrationByUserId,

    deactivateActiveCalibration,

    createCalibration,

    getCalibrationById,

    saveCalibrationTransaction

};