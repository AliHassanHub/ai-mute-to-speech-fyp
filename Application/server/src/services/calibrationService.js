const calibrationModel = require("../models/calibrationModel");

const getActiveCalibration = async (userId) => {

    const calibration = await calibrationModel.getActiveCalibrationByUserId(

        userId

    );

    if (!calibration) {

        return {

            success: true,

            hasCalibration: false,

            calibration: null

        };

    }

    return {

        success: true,

        hasCalibration: true,

        calibration: {

            calibrationId: calibration.calibration_id,

            baselineValue: calibration.baseline_value,

            thresholdLevel: calibration.threshold_level,

            calibrationData: calibration.calibration_data,

            calibrationDate: calibration.calibration_date

        }

    };

};

const saveCalibration = async (

    userId,

    baselineValue,

    thresholdLevel,

    calibrationData

) => {

    const calibration = await calibrationModel.saveCalibrationTransaction(

        userId,

        baselineValue,

        thresholdLevel,

        calibrationData

    );

    return {

        success: true,

        message: "Calibration saved successfully.",

        calibration: {

            calibrationId: calibration.calibration_id,

            baselineValue: calibration.baseline_value,

            thresholdLevel: calibration.threshold_level,

            calibrationData: calibration.calibration_data,

            calibrationDate: calibration.calibration_date,

            isActive: calibration.is_active

        }

    };

};

const getCalibrationStatus = async (userId) => {

    const calibration = await calibrationModel.getActiveCalibrationByUserId(

        userId

    );

    return {

        success: true,

        isCalibrated: !!calibration

    };

};

module.exports = {

    getActiveCalibration,

    saveCalibration,

    getCalibrationStatus

};
