const historyModel = require("../models/historyModel");
const textResultModel = require("../models/textResultModel");

const formatHistoryDetails = (history) => ({

    textId: history.text_id,

    sessionId: history.session_id,

    recordingId: history.recording_id,

    processedId: history.processed_id,

    recognizedText: history.recognized_text,

    translatedText: history.translated_text,

    sourceLanguage: history.source_language,

    targetLanguage: history.target_language,

    confidenceScore: Number(history.confidence_score),

    processingTimeMs: history.processing_time_ms,

    recordingDate: history.created_at,

    audioUrl: history.audio_url

});

const getHistoryList = async (

    userId,

    page = 1,

    limit = 10

) => {

    const offset = (page - 1) * limit;

    const history = await historyModel.getHistoryList(

        userId,

        limit,

        offset

    );

    return {

        success: true,

        page,

        limit,

        count: history.length,

        history: history.map(item => ({

            textId: item.text_id,

            recognizedText: item.recognized_text,

            translatedText: item.translated_text,

            sourceLanguage: item.source_language,

            targetLanguage: item.target_language,

            confidenceScore: Number(item.confidence_score),

            createdAt: item.created_at

        }))

    };

};

const getHistoryDetails = async (

    userId,

    textId

) => {

    const history = await historyModel.getHistoryDetails(

        userId,

        textId

    );

    if (!history) {

        throw {

            status: 404,

            message: "History record not found."

        };

    }

    return {

        success: true,

        history: formatHistoryDetails(history)

    };

};

const deleteHistory = async (

    userId,

    textId

) => {

    const history = await historyModel.getHistoryOwnership(

        userId,

        textId

    );

    if (!history) {

        throw {

            status: 404,

            message: "History record not found."

        };

    }

    await textResultModel.deleteTextResult(

        textId

    );

    return {

        success: true,

        message: "History deleted successfully."

    };

};

module.exports = {

    getHistoryList,

    getHistoryDetails,

    deleteHistory

};