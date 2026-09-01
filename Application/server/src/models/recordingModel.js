const pool = require("../config/db");

const createRecording = async (

    sessionId,

    rawSignalData,

    channelCount,

    samplingRate,

    durationMs,

    signalLabel

) => {

    const [result] = await pool.query(

        `
        INSERT INTO emg_recordings (

            session_id,

            raw_signal_data,

            channel_count,

            sampling_rate,

            duration_ms,

            signal_label

        )

        VALUES (?, ?, ?, ?, ?, ?)
        `,

        [

            sessionId,

            rawSignalData,

            channelCount,

            samplingRate,

            durationMs,

            signalLabel

        ]

    );

    return result.insertId;

};

const getRecordingById = async (recordingId) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM emg_recordings

        WHERE recording_id = ?

        LIMIT 1
        `,

        [

            recordingId

        ]

    );

    return rows[0];

};

const getSessionById = async (sessionId) => {

    const [rows] = await pool.query(

        `
        SELECT

            session_id,

            user_id,

            status

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

const getRecordingDetails = async (recordingId) => {

    const [rows] = await pool.query(

        `
        SELECT

            er.recording_id,

            er.session_id,

            s.user_id,

            er.raw_signal_data,

            er.channel_count,

            er.sampling_rate,

            er.duration_ms,

            er.signal_label,

            er.timestamp,

            er.created_at

        FROM emg_recordings er

        INNER JOIN sessions s

            ON er.session_id = s.session_id

        WHERE er.recording_id = ?

        LIMIT 1
        `,

        [

            recordingId

        ]

    );

    return rows[0];

};

const getSessionRecordings = async (sessionId) => {

    const [rows] = await pool.query(

        `
        SELECT

            recording_id,

            session_id,

            channel_count,

            sampling_rate,

            duration_ms,

            signal_label,

            timestamp,

            created_at

        FROM emg_recordings

        WHERE session_id = ?

        ORDER BY created_at ASC
        `,

        [

            sessionId

        ]

    );

    return rows;

};

const deleteRecording = async (recordingId) => {

    const [result] = await pool.query(

        `
        DELETE FROM emg_recordings
        WHERE recording_id = ?
        `,

        [recordingId]

    );

    return result.affectedRows;

};
module.exports = {

    createRecording,

    getRecordingById,

    getSessionById,

    getRecordingDetails,

    getSessionRecordings,

    deleteRecording

};