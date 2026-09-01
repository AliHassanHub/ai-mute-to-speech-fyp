const processedRecordingModel = require("../models/processedRecordingModel");

const saveProcessedRecording = async (

    userId,

    recordingId,

    processedData,

    featureVector,

    normalizationFactor,

    noiseReductionLevel

) => {

    const recording = await processedRecordingModel.getRecordingDetails(

        recordingId

    );

    if (!recording) {

        throw {

            status: 404,

            message: "Recording not found."

        };

    }

    if (recording.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to process this recording."

        };

    }

    const existingProcessedRecording =
        await processedRecordingModel.getProcessedRecordingByRecordingId(

            recordingId

        );

    if (existingProcessedRecording) {

        throw {

            status: 409,

            message: "Processed recording already exists for this recording."

        };

    }

    const processedId =
        await processedRecordingModel.createProcessedRecording(

            recordingId,

            JSON.stringify(processedData),

            JSON.stringify(featureVector),

            normalizationFactor,

            noiseReductionLevel

        );

    const processedRecording =
        await processedRecordingModel.getProcessedRecordingById(

            processedId

        );

    return {

        success: true,

        message: "Processed recording saved successfully.",

        processedRecording: {

            processedId: processedRecording.processed_id,

            recordingId: processedRecording.recording_id,

            normalizationFactor:
                processedRecording.normalization_factor,

            noiseReductionLevel:
                processedRecording.noise_reduction_level,

            processedAt:
                processedRecording.processed_at

        }

    };

};

const getProcessedRecording = async (

    userId,

    processedId

) => {

    const processedRecording =
        await processedRecordingModel.getProcessedRecordingById(

            processedId

        );

    if (!processedRecording) {

        throw {

            status: 404,

            message: "Processed recording not found."

        };

    }

    const recording =
        await processedRecordingModel.getRecordingDetails(

            processedRecording.recording_id

        );

    if (recording.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to access this processed recording."

        };

    }

    let processedData = {};

    let featureVector = {};

    try {

        processedData = JSON.parse(

            processedRecording.processed_data

        );

    }

    catch {

        processedData = {};

    }

    try {

        featureVector = JSON.parse(

            processedRecording.feature_vector

        );

    }

    catch {

        featureVector = {};

    }

    return {

        success: true,

        processedRecording: {

            processedId:

                processedRecording.processed_id,

            recordingId:

                processedRecording.recording_id,

            processedData,

            featureVector,

            normalizationFactor:

                processedRecording.normalization_factor,

            noiseReductionLevel:

                processedRecording.noise_reduction_level,

            processedAt:

                processedRecording.processed_at,

            updatedAt:

                processedRecording.updated_at

        }

    };

};

const getProcessedRecordingByRecordingId = async (

    userId,

    recordingId

) => {

    const recording = await processedRecordingModel.getRecordingDetails(

        recordingId

    );

    if (!recording) {

        throw {

            status: 404,

            message: "Recording not found."

        };

    }

    if (recording.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to access this recording."

        };

    }

    const processedRecording =
        await processedRecordingModel.getProcessedRecordingByRecordingId(

            recordingId

        );

    if (!processedRecording) {

        throw {

            status: 404,

            message: "Processed recording not found."

        };

    }

    let processedData = {};

    let featureVector = {};

    try {

        processedData = JSON.parse(

            processedRecording.processed_data

        );

    }

    catch {

        processedData = {};

    }

    try {

        featureVector = JSON.parse(

            processedRecording.feature_vector

        );

    }

    catch {

        featureVector = {};

    }

    return {

        success: true,

        processedRecording: {

            processedId:

                processedRecording.processed_id,

            recordingId:

                processedRecording.recording_id,

            processedData,

            featureVector,

            normalizationFactor:

                processedRecording.normalization_factor,

            noiseReductionLevel:

                processedRecording.noise_reduction_level,

            processedAt:

                processedRecording.processed_at,

            updatedAt:

                processedRecording.updated_at

        }

    };

};

const deleteProcessedRecording = async (

    userId,

    processedId

) => {

    const processedRecording =
        await processedRecordingModel.getProcessedRecordingById(

            processedId

        );

    if (!processedRecording) {

        throw {

            status: 404,

            message: "Processed recording not found."

        };

    }

    const recording =
        await processedRecordingModel.getRecordingDetails(

            processedRecording.recording_id

        );

    if (recording.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to delete this processed recording."

        };

    }

    await processedRecordingModel.deleteProcessedRecording(

        processedId

    );

    return {

        success: true,

        message: "Processed recording deleted successfully."

    };

};

module.exports = {

    saveProcessedRecording,

    getProcessedRecording,

    getProcessedRecordingByRecordingId,

    deleteProcessedRecording

};