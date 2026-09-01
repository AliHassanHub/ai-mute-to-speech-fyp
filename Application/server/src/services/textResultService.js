const textResultModel = require("../models/textResultModel");

const formatTextResult = (textResult) => ({

    textId: textResult.text_id,

    processedId: textResult.processed_id,

    recognizedText: textResult.recognized_text,

    translatedText: textResult.translated_text,

    sourceLanguage: textResult.source_language,

    targetLanguage: textResult.target_language,

    confidenceScore: textResult.confidence_score,

    processingTimeMs: textResult.processing_time_ms,

    createdAt: textResult.created_at,

    updatedAt: textResult.updated_at,

});

const saveTextResult = async (

    userId,

    processedId,

    recognizedText,

    translatedText,

    sourceLanguage,

    targetLanguage,

    confidenceScore,

    processingTimeMs

) => {

    const processedRecording =
        await textResultModel.getProcessedRecordingDetails(

            processedId

        );

    if (!processedRecording) {

        throw {

            status: 404,

            message: "Processed recording not found."

        };

    }

    if (processedRecording.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to create a text result for this processed recording."

        };

    }

    const existingTextResult =
        await textResultModel.getTextResultByProcessedId(

            processedId

        );

    if (existingTextResult) {

        throw {

            status: 409,

            message: "Text result already exists for this processed recording."

        };

    }

    const textId =
        await textResultModel.createTextResult(

            processedId,

            recognizedText,

            translatedText,

            sourceLanguage,

            targetLanguage,

            confidenceScore,

            processingTimeMs

        );

    const textResult =
        await textResultModel.getTextResultById(

            textId

        );

    return {

        success: true,

        message: "Text result saved successfully.",

        textResult: {

            textId: textResult.text_id,

            processedId: textResult.processed_id,

            recognizedText: textResult.recognized_text,

            translatedText: textResult.translated_text,

            sourceLanguage: textResult.source_language,

            targetLanguage: textResult.target_language,

            confidenceScore: textResult.confidence_score,

            processingTimeMs: textResult.processing_time_ms,

            createdAt: textResult.created_at

        }

    };

};

const getTextResult = async (

    userId,

    textId

) => {

    const textResult = await textResultModel.getTextResultById(

        textId

    );

    if (!textResult) {

        throw {

            status: 404,

            message: "Text result not found."

        };

    }

    const processedRecording =
        await textResultModel.getProcessedRecordingDetails(

            textResult.processed_id

        );

    if (!processedRecording) {

        throw {

            status: 404,

            message: "Processed recording not found."

        };

    }

    if (processedRecording.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to access this text result."

        };

    }

    return {

        success: true,

        textResult: {

            textId: textResult.text_id,

            processedId: textResult.processed_id,

            recognizedText: textResult.recognized_text,

            translatedText: textResult.translated_text,

            sourceLanguage: textResult.source_language,

            targetLanguage: textResult.target_language,

            confidenceScore: textResult.confidence_score,

            processingTimeMs: textResult.processing_time_ms,

            createdAt: textResult.created_at,

            updatedAt: textResult.updated_at

        }

    };

};

const getTextResultByProcessedId = async (

    userId,

    processedId

) => {

    const processedRecording =
        await textResultModel.getProcessedRecordingDetails(

            processedId

        );

    if (!processedRecording) {

        throw {

            status: 404,

            message: "Processed recording not found."

        };

    }

    if (processedRecording.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to access this text result."

        };

    }

    const textResult =
        await textResultModel.getTextResultByProcessedId(

            processedId

        );

    if (!textResult) {

        throw {

            status: 404,

            message: "Text result not found."

        };

    }

    return {

        success: true,

        textResult: formatTextResult(textResult)

    };

};

const deleteTextResult = async (

    userId,

    textId

) => {

    const textResult =
        await textResultModel.getTextResultById(

            textId

        );

    if (!textResult) {

        throw {

            status: 404,

            message: "Text result not found."

        };

    }

    const processedRecording =
        await textResultModel.getProcessedRecordingDetails(

            textResult.processed_id

        );

    if (processedRecording.user_id !== userId) {

        throw {

            status: 403,

            message: "You are not authorized to delete this text result."

        };

    }

    await textResultModel.deleteTextResult(

        textId

    );

    return {

        success: true,

        message: "Text result deleted successfully."

    };

};

module.exports = {

    saveTextResult,

    getTextResult,

    getTextResultByProcessedId,

    deleteTextResult

};