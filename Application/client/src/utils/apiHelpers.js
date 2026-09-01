import { ApiError } from '../services/api';
import {
  getTranslationLanguageFromUser,
  getSpeechLanguageFromUser,
  isEnglishTarget,
  normalizeTargetLanguage,
  normalizeLanguageCode,
  languageCodeToName,
  resolveSpeechText,
  getSupportedLanguages,
  TARGET_LANGUAGES,
  SUPPORTED_LANGUAGES,
} from './language';

export {
  getTranslationLanguageFromUser,
  getSpeechLanguageFromUser,
  isEnglishTarget,
  normalizeTargetLanguage,
  normalizeLanguageCode,
  languageCodeToName,
  resolveSpeechText,
  getSupportedLanguages,
  TARGET_LANGUAGES,
  SUPPORTED_LANGUAGES,
};

export const getTargetLanguageFromUser = getTranslationLanguageFromUser;

export function getErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (error instanceof ApiError) return error.message || fallback;
  if (error?.message) return error.message;
  return fallback;
}

export function formatHistoryDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
