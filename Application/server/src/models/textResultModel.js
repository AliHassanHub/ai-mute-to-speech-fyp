const pool = require("../config/db");

const createTextResult = async (

    processedId,

    recognizedText,

    translatedText,

    sourceLanguage,

    targetLanguage,

    confidenceScore,

    processingTimeMs

) => {

    const [result] = await pool.query(

        `
        INSERT INTO text_results (

            processed_id,

            recognized_text,

            translated_text,

            source_language,

            target_language,

            confidence_score,

            processing_time_ms

        )

        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,

        [

            processedId,

            recognizedText,

            translatedText,

            sourceLanguage,

            targetLanguage,

            confidenceScore,

            processingTimeMs

        ]

    );

    return result.insertId;

};

const getTextResultById = async (textId) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM text_results

        WHERE text_id = ?

        LIMIT 1
        `,

        [

            textId

        ]

    );

    return rows[0];

};

const getTextResultByProcessedId = async (

    processedId

) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM text_results

        WHERE processed_id = ?

        LIMIT 1
        `,

        [

            processedId

        ]

    );

    return rows[0];

};

const getProcessedRecordingDetails = async (

    processedId

) => {

    const [rows] = await pool.query(

        `
        SELECT

            pr.processed_id,

            pr.recording_id,

            s.user_id

        FROM processed_recordings pr

        INNER JOIN emg_recordings er

            ON pr.recording_id = er.recording_id

        INNER JOIN sessions s

            ON er.session_id = s.session_id

        WHERE pr.processed_id = ?

        LIMIT 1
        `,

        [

            processedId

        ]

    );

    return rows[0];

};

const deleteTextResult = async (textId) => {

    const [result] = await pool.query(

        `
        DELETE FROM text_results
        WHERE text_id = ?
        `,

        [

            textId

        ]

    );

    return result.affectedRows;

};

module.exports = {

    createTextResult,

    getTextResultById,

    getTextResultByProcessedId,

    getProcessedRecordingDetails,

    deleteTextResult

};