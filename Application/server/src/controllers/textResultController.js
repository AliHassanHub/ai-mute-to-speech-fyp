const textResultService = require("../services/textResultService");

const saveTextResult = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const {

            processedId,

            recognizedText,

            translatedText,

            sourceLanguage,

            targetLanguage,

            confidenceScore,

            processingTimeMs

        } = req.body;

        const result =
            await textResultService.saveTextResult(

                userId,

                processedId,

                recognizedText,

                translatedText,

                sourceLanguage,

                targetLanguage,

                confidenceScore,

                processingTimeMs

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

const getTextResult = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const textId = Number(

            req.params.textId

        );

        const result = await textResultService.getTextResult(

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

const getTextResultByProcessedId = async (

    req,

    res

) => {

    try {

        const userId = req.user.user_id;

        const processedId = Number(

            req.params.processedId

        );

        const result =
            await textResultService.getTextResultByProcessedId(

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

const deleteTextResult = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const textId = Number(req.params.textId);

        const result =
            await textResultService.deleteTextResult(

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

    saveTextResult,

    getTextResult,

    getTextResultByProcessedId,

    deleteTextResult

};