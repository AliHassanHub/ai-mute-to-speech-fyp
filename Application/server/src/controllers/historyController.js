const historyService = require("../services/historyService");

const getHistoryList = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const page = Number(req.query.page) || 1;

        const limit = Number(req.query.limit) || 10;

        const result = await historyService.getHistoryList(

            userId,

            page,

            limit

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

const getHistoryDetails = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const textId = Number(req.params.textId);

        const result = await historyService.getHistoryDetails(

            userId,

            textId

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

const deleteHistory = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const textId = Number(

            req.params.textId

        );

        const result = await historyService.deleteHistory(

            userId,

            textId

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

    getHistoryList,

    getHistoryDetails,

    deleteHistory

};