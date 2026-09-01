import { SOURCE_LANGUAGE } from '../constants/languages';
import { normalizeTargetLanguage } from './language';

export function normalizeSessionResult(data = {}) {
  const confidenceScore = Number(data.confidenceScore ?? data.confidence ?? 0);

  return {
    textId: data.textId ?? data.text_id ?? null,
    sessionId: data.sessionId ?? data.session_id ?? null,
    recordingId: data.recordingId ?? data.recording_id ?? null,
    processedId: data.processedId ?? data.processed_id ?? null,
    recognizedText: data.recognizedText ?? data.recognized_text ?? '',
    translatedText: data.translatedText ?? data.translated_text ?? data.recognizedText ?? '',
    sourceLanguage: data.sourceLanguage ?? data.source_language ?? SOURCE_LANGUAGE,
    targetLanguage: normalizeTargetLanguage(data.targetLanguage ?? data.target_language),
    translationLanguage:
      data.translationLanguage ??
      data.translation_language ??
      normalizeTargetLanguage(data.targetLanguage ?? data.target_language),
    speechLanguage: data.speechLanguage ?? data.speech_language ?? null,
    confidenceScore,
    processingTimeMs: data.processingTimeMs ?? data.processing_time_ms ?? null,
    accepted: data.accepted ?? data.prediction?.accepted ?? false,
    prediction: data.prediction ?? null,
    createdAt: data.createdAt ?? data.recordingDate ?? data.created_at ?? null,
  };
}

export function normalizeHistoryItem(item = {}) {
  const normalized = normalizeSessionResult(item);

  return {
    id: String(normalized.textId ?? item.id ?? ''),
    textId: normalized.textId,
    date: item.date ?? normalized.createdAt,
    recognizedText: normalized.recognizedText,
    translatedText: normalized.translatedText,
    sourceLanguage: normalized.sourceLanguage,
    targetLanguage: normalized.targetLanguage,
    confidence: `${normalized.confidenceScore.toFixed(2)}%`,
    confidenceScore: normalized.confidenceScore,
    processingTimeMs: normalized.processingTimeMs,
    accepted: normalized.accepted,
    prediction: normalized.prediction,
  };
}
