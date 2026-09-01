const sessionService = require("../services/sessionService");

const startSession = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const deviceName = req.body.deviceName || null;

        const result = await sessionService.startSession(

            userId,

            deviceName

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

const getCurrentSession = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const result = await sessionService.getCurrentSession(

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

const completeSession = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const sessionId = parseInt(req.params.sessionId);

        const {

            wordCount,

            averageConfidence

        } = req.body;

        const result = await sessionService.completeSession(

            sessionId,

            userId,

            wordCount,

            averageConfidence

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

    startSession,

    getCurrentSession,

    completeSession

};