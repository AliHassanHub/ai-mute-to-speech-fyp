const recordingService = require("../services/recordingService");

const saveRecording = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const {

            sessionId,

            rawSignalData,

            channelCount,

            samplingRate,

            durationMs,

            signalLabel

        } = req.body;

        const result = await recordingService.saveRecording(

            userId,

            sessionId,

            rawSignalData,

            channelCount,

            samplingRate,

            durationMs,

            signalLabel

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

const getRecording = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const recordingId = Number(

            req.params.recordingId

        );

        const result = await recordingService.getRecording(

            userId,

            recordingId

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

const getSessionRecordings = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const sessionId = Number(

            req.params.sessionId

        );

        const result = await recordingService.getSessionRecordings(

            userId,

            sessionId

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

const deleteRecording = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const recordingId = Number(

            req.params.recordingId

        );

        const result = await recordingService.deleteRecording(

            userId,

            recordingId

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

    saveRecording,

    getRecording,

    getSessionRecordings,

    deleteRecording

};