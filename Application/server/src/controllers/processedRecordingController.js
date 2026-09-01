const processedRecordingService = require("../services/processedRecordingService");

const saveProcessedRecording = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const {

            recordingId,

            processedData,

            featureVector,

            normalizationFactor,

            noiseReductionLevel

        } = req.body;

        const result =
            await processedRecordingService.saveProcessedRecording(

                userId,

                recordingId,

                processedData,

                featureVector,

                normalizationFactor,

                noiseReductionLevel

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

const getProcessedRecording = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const processedId = Number(

            req.params.processedId

        );

        const result =
            await processedRecordingService.getProcessedRecording(

                userId,

                processedId

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

const getProcessedRecordingByRecordingId = async (

    req,

    res

) => {

    try {

        const userId = req.user.user_id;

        const recordingId = Number(

            req.params.recordingId

        );

        const result =
            await processedRecordingService.getProcessedRecordingByRecordingId(

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

const deleteProcessedRecording = async (

    req,

    res

) => {

    try {

        const userId = req.user.user_id;

        const processedId = Number(

            req.params.processedId

        );

        const result =
            await processedRecordingService.deleteProcessedRecording(

                userId,

                processedId

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

    saveProcessedRecording,

    getProcessedRecording,

    getProcessedRecordingByRecordingId,

    deleteProcessedRecording

};