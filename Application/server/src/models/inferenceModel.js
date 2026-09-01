async function insertEmgRecording(connection, {
    sessionId,
    rawSignalData,
    channelCount,
    samplingRate,
    durationMs,
    signalLabel,
}) {
    const [recordingResult] = await connection.query(
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
            signalLabel,
        ]
    );

    return recordingResult.insertId;
}

async function insertProcessedRecording(connection, {
    recordingId,
    processedData,
    featureVector,
    normalizationFactor,
    noiseReductionLevel,
}) {
    const [processedResult] = await connection.query(
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
            JSON.stringify(processedData),
            JSON.stringify(featureVector),
            normalizationFactor,
            noiseReductionLevel,
        ]
    );

    return processedResult.insertId;
}

async function insertTextResult(connection, {
    processedId,
    recognizedText,
    translatedText,
    sourceLanguage,
    targetLanguage,
    confidenceScore,
    processingTimeMs,
}) {
    const [textResult] = await connection.query(
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
            processingTimeMs,
        ]
    );

    return textResult.insertId;
}

module.exports = {
    insertEmgRecording,
    insertProcessedRecording,
    insertTextResult,
};
