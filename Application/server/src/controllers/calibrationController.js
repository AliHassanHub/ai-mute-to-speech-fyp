const calibrationService = require("../services/calibrationService");
const calibrationWordService = require("../services/calibrationWordService");
const { AppError } = require("../utils/AppError");

const getActiveCalibration = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const result = await calibrationService.getActiveCalibration(

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

const saveCalibration = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const {

            baselineValue,

            thresholdLevel,

            calibrationData

        } = req.body;

        const result = await calibrationService.saveCalibration(

            userId,

            baselineValue,

            thresholdLevel,

            calibrationData

        );

        return res.status(201).json(result);

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

const getCalibrationStatus = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const result = await calibrationService.getCalibrationStatus(

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

const getPersonalizedProfile = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const result = await calibrationWordService.getPersonalizedProfile(userId);
        return res.status(200).json(result);
    } catch (error) {
        console.error(error);
        if (error instanceof AppError) {
            return res.status(error.status || 500).json({
                success: false,
                message: error.message,
                code: error.code,
            });
        }
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Internal Server Error",
        });
    }
};

const calibrateWord = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const { word, captures, idempotencyKey } = req.body;
        const result = await calibrationWordService.calibrateWord(userId, {
            word,
            captures,
            idempotencyKey,
        });
        return res.status(200).json(result);
    } catch (error) {
        console.error(error);
        if (error instanceof AppError) {
            return res.status(error.status || 500).json({
                success: false,
                message: error.message,
                code: error.code,
            });
        }
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Internal Server Error",
        });
    }
};

const saveNeutralBaseline = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const { captures } = req.body;
        const result = await calibrationWordService.saveNeutralBaseline(userId, {
            captures,
        });
        return res.status(200).json(result);
    } catch (error) {
        console.error(error);
        if (error instanceof AppError) {
            return res.status(error.status || 500).json({
                success: false,
                message: error.message,
                code: error.code,
            });
        }
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Internal Server Error",
        });
    }
};

module.exports = {
    getActiveCalibration,
    saveCalibration,
    getCalibrationStatus,
    getPersonalizedProfile,
    calibrateWord,
    saveNeutralBaseline,
};