const pool = require("../config/db");

const getHistoryList = async (
    userId,
    limit,
    offset
) => {

    const [rows] = await pool.query(

        `
        SELECT

            tr.text_id,

            tr.recognized_text,

            tr.translated_text,

            tr.source_language,

            tr.target_language,

            tr.confidence_score,

            tr.created_at

        FROM text_results tr

        INNER JOIN processed_recordings pr

            ON tr.processed_id = pr.processed_id

        INNER JOIN emg_recordings er

            ON pr.recording_id = er.recording_id

        INNER JOIN sessions s

            ON er.session_id = s.session_id

        WHERE s.user_id = ?

        ORDER BY tr.created_at DESC

        LIMIT ?

        OFFSET ?
        `,

        [
            userId,
            limit,
            offset
        ]

    );

    return rows;

};

const getHistoryDetails = async (userId, textId) => {

    const [rows] = await pool.query(

        `
        SELECT

            tr.text_id,

            tr.processed_id,

            tr.recognized_text,

            tr.translated_text,

            tr.source_language,

            tr.target_language,

            tr.confidence_score,

            tr.processing_time_ms,

            tr.created_at,

            pr.recording_id,

            er.session_id

        FROM text_results tr

        INNER JOIN processed_recordings pr
            ON tr.processed_id = pr.processed_id

        INNER JOIN emg_recordings er
            ON pr.recording_id = er.recording_id

        INNER JOIN sessions s
            ON er.session_id = s.session_id

        WHERE

            tr.text_id = ?

            AND s.user_id = ?

        LIMIT 1
        `,

        [

            textId,

            userId

        ]

    );

    return rows[0];

};

const getHistoryOwnership = async (

    userId,

    textId

) => {

    const [rows] = await pool.query(

        `
        SELECT

            tr.text_id

        FROM text_results tr

        INNER JOIN processed_recordings pr

            ON tr.processed_id = pr.processed_id

        INNER JOIN emg_recordings er

            ON pr.recording_id = er.recording_id

        INNER JOIN sessions s

            ON er.session_id = s.session_id

        WHERE

            tr.text_id = ?

            AND s.user_id = ?

        LIMIT 1
        `,

        [

            textId,

            userId

        ]

    );

    return rows[0];

};

module.exports = {

    getHistoryList,

    getHistoryDetails,

    getHistoryOwnership

};