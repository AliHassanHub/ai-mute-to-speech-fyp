const pool = require("../config/db");

const createProcessedRecording = async (

    recordingId,

    processedData,

    featureVector,

    normalizationFactor,

    noiseReductionLevel

) => {

    const [result] = await pool.query(

        `
        INSERT INTO processed_recordings (

            recording_id,

            processed_data,

            feature_vector,

            normalization_factor,

            noise_reduction_level

        )

        VALUES (?, ?, ?, ?, ?)
        `,

        [

            recordingId,

            processedData,

            featureVector,

            normalizationFactor,

            noiseReductionLevel

        ]

    );

    return result.insertId;

};

const getProcessedRecordingById = async (processedId) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM processed_recordings

        WHERE processed_id = ?

        LIMIT 1
        `,

        [

            processedId

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

            s.user_id

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

const getProcessedRecordingByRecordingId = async (

    recordingId

) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM processed_recordings

        WHERE recording_id = ?

        LIMIT 1
        `,

        [

            recordingId

        ]

    );

    return rows[0];

};

const deleteProcessedRecording = async (processedId) => {

    await pool.query(

        `
        DELETE FROM processed_recordings

        WHERE processed_id = ?
        `,

        [

            processedId

        ]

    );

};

module.exports = {

    createProcessedRecording,

    getProcessedRecordingById,

    getProcessedRecordingByRecordingId,

    getRecordingDetails,

    deleteProcessedRecording

};