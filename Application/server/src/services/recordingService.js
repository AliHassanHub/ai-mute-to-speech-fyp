const recordingModel = require("../models/recordingModel");

const saveRecording = async (
    userId,
    sessionId,
    rawSignalData,
    channelCount,
    samplingRate,
    durationMs,
    signalLabel
) => {

    const session = await recordingModel.getSessionById(sessionId);

    if (!session) {
        throw {
            status: 404,
            message: "Session not found."
        };
    }

    if (session.user_id !== userId) {
        throw {
            status: 403,
            message: "You are not authorized to access this session."
        };
    }

    if (session.status !== "active") {
        throw {
            status: 400,
            message: "Recording can only be saved to an active session."
        };
    }

    if (!Array.isArray(rawSignalData) || rawSignalData.length < 50) {
        throw {
            status: 400,
            message: "Recording must contain at least 50 EMG samples."
        };
    }

    const isDualChannel = Array.isArray(rawSignalData[0]);
    if (!isDualChannel) {
        throw {
            status: 400,
            message: "Recording must include dual-channel [emg, pot] signal data."
        };
    }

    const resolvedChannelCount = channelCount || 2;
    const recordingId = await recordingModel.createRecording(
        sessionId,
        JSON.stringify(rawSignalData),
        resolvedChannelCount,
        samplingRate,
        durationMs,
        signalLabel || null
    );

    const recording = await recordingModel.getRecordingById(recordingId);

    return {
        success: true,
        message: "Recording saved successfully.",
        recording: {
            recordingId: recording.recording_id,
            sessionId: recording.session_id,
            channelCount: recording.channel_count,
            samplingRate: recording.sampling_rate,
            durationMs: recording.duration_ms,
            signalLabel: recording.signal_label,
            createdAt: recording.created_at
        }
    };

};

const getRecording = async (
    userId,
    recordingId
) => {

    const recording = await recordingModel.getRecordingDetails(recordingId);

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

    let rawSignalData = [];

    try {
        rawSignalData = JSON.parse(recording.raw_signal_data);
    } catch (error) {
        console.error(
            "Invalid raw signal JSON:",
            error
        );
    }

    return {
        success: true,
        recording: {
            recordingId: recording.recording_id,
            sessionId: recording.session_id,
            rawSignalData,
            channelCount: recording.channel_count,
            samplingRate: recording.sampling_rate,
            durationMs: recording.duration_ms,
            signalLabel: recording.signal_label,
            timestamp: recording.timestamp,
            createdAt: recording.created_at
        }
    };

};

const getSessionRecordings = async (

    userId,

    sessionId

) => {

    const session = await recordingModel.getSessionById(

        sessionId

    );

    if (!session) {

        throw {

            status: 404,

            message: "Session not found."

        };

    }

    if (session.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to access this session."

        };

    }

    const recordings = await recordingModel.getSessionRecordings(

        sessionId

    );

    return {

        success: true,

        totalRecordings: recordings.length,

        recordings: recordings.map(recording => ({

            recordingId: recording.recording_id,

            sessionId: recording.session_id,

            channelCount: recording.channel_count,

            samplingRate: recording.sampling_rate,

            durationMs: recording.duration_ms,

            signalLabel: recording.signal_label,

            timestamp: recording.timestamp,

            createdAt: recording.created_at

        }))

    };

};

const deleteRecording = async (

    userId,

    recordingId

) => {

    const recording = await recordingModel.getRecordingDetails(

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

            message: "You are not authorized to delete this recording."

        };

    }

    await recordingModel.deleteRecording(

        recordingId

    );

    return {

        success: true,

        message: "Recording deleted successfully."

    };

};

module.exports = {

    saveRecording,

    getRecording,

    getSessionRecordings,

    deleteRecording

};