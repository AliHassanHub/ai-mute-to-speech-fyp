const pool = require("../config/db");

const getActiveSessionByUserId = async (userId) => {

    const [rows] = await pool.query(

        `
        SELECT

            session_id,
            user_id,
            status,
            start_time,
            device_name

        FROM sessions

        WHERE user_id = ?

        AND status = 'active'

        LIMIT 1
        `,

        [

            userId

        ]

    );

    return rows[0];

};

const createSession = async (

    userId,

    deviceName

) => {

    const [result] = await pool.query(

        `
        INSERT INTO sessions (

            user_id,

            device_name,

            status

        )

        VALUES (

            ?,

            ?,

            'active'

        )
        `,

        [

            userId,

            deviceName || null

        ]

    );

    return result.insertId;

};

const getSessionById = async (

    sessionId

) => {

    const [rows] = await pool.query(

        `
        SELECT

            session_id,

            user_id,

            start_time,

            end_time,

            status,

            device_name,

            word_count,

            average_confidence,

            created_at,

            updated_at

        FROM sessions

        WHERE session_id = ?

        LIMIT 1
        `,

        [

            sessionId

        ]

    );

    return rows[0];

};

const getSessionResultStats = async (sessionId, connection = null) => {

    const executor = connection || pool;

    const [rows] = await executor.query(

        `
        SELECT
            COUNT(tr.text_id) AS word_count,
            AVG(tr.confidence_score) AS average_confidence
        FROM emg_recordings er
        INNER JOIN processed_recordings pr
            ON pr.recording_id = er.recording_id
        INNER JOIN text_results tr
            ON tr.processed_id = pr.processed_id
        WHERE er.session_id = ?
        `,

        [sessionId]

    );

    const stats = rows[0] || {};

    return {
        wordCount: Number(stats.word_count || 0),
        averageConfidence:
            stats.average_confidence != null
                ? Number(Number(stats.average_confidence).toFixed(2))
                : null,
    };

};

const refreshSessionAggregates = async (sessionId, connection = null) => {

    const stats = await getSessionResultStats(sessionId, connection);

    const executor = connection || pool;

    await executor.query(

        `
        UPDATE sessions
        SET
            word_count = ?,
            average_confidence = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
        `,

        [
            stats.wordCount,
            stats.averageConfidence,
            sessionId,
        ]

    );

    return stats;

};

const completeSession = async (

    sessionId,

    userId,

    wordCount,

    averageConfidence

) => {

    const [result] = await pool.query(

        `
        UPDATE sessions

        SET

            end_time = CURRENT_TIMESTAMP,

            status = 'completed',

            word_count = ?,

            average_confidence = ?,

            updated_at = CURRENT_TIMESTAMP

        WHERE session_id = ?

        AND user_id = ?

        AND status = 'active'
        `,

        [

            wordCount,

            averageConfidence,

            sessionId,

            userId

        ]

    );

    return result.affectedRows;

};

module.exports = {

    getActiveSessionByUserId,

    createSession,

    getSessionById,

    getSessionResultStats,

    refreshSessionAggregates,

    completeSession

};