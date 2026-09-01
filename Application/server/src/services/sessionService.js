const sessionModel = require("../models/sessionModel");

const startSession = async (
    userId,
    deviceName
) => {
    const activeSession = await sessionModel.getActiveSessionByUserId(
        userId
    );

    if (activeSession) {
        const error = new Error(
            "You already have an active session."
        );

        error.status = 409;
        throw error;
    }

    const sessionId = await sessionModel.createSession(
        userId,
        deviceName
    );

    const session = await sessionModel.getSessionById(
        sessionId
    );

    return {
        success: true,
        message: "Session started successfully.",
        session: {
            sessionId: session.session_id,
            status: session.status,
            deviceName: session.device_name,
            startTime: session.start_time
        }
    };
};

const getCurrentSession = async (userId) => {

    const session = await sessionModel.getActiveSessionByUserId(

        userId

    );

    if (!session) {

        return {

            success: true,

            session: null

        };

    }

    return {

        success: true,

        session: {

            sessionId: session.session_id,

            status: session.status,

            deviceName: session.device_name,

            startTime: session.start_time

        }

    };

};

const completeSession = async (

    sessionId,

    userId,

    wordCount,

    averageConfidence

) => {

    const stats = await sessionModel.refreshSessionAggregates(sessionId);

    const affectedRows = await sessionModel.completeSession(

        sessionId,

        userId,

        stats.wordCount,

        stats.averageConfidence ?? averageConfidence

    );

    if (!affectedRows) {

        const error = new Error(

            "Active session not found."

        );

        error.status = 404;

        throw error;

    }

    return {

        success: true,

        message: "Session completed successfully."

    };

};

module.exports = {

    startSession,

    getCurrentSession,

    completeSession

};