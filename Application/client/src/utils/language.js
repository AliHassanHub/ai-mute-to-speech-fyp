import {
  SOURCE_LANGUAGE,
  SOURCE_LANGUAGE_CODE,
  SUPPORTED_LANGUAGES,
  TARGET_LANGUAGES,
  LANGUAGE_ALIASES,
  LANGUAGE_CODES,
  getSupportedLanguages,
} from '../constants/languages';

export {
  SOURCE_LANGUAGE,
  SOURCE_LANGUAGE_CODE,
  SUPPORTED_LANGUAGES,
  TARGET_LANGUAGES,
  LANGUAGE_ALIASES,
  LANGUAGE_CODES,
  getSupportedLanguages,
};

export function normalizeLanguageCode(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) {
    return SOURCE_LANGUAGE_CODE;
  }

  if (LANGUAGE_ALIASES[raw]) {
    return raw.length === 2 ? raw : LANGUAGE_CODES[LANGUAGE_ALIASES[raw]];
  }

  const byName = SUPPORTED_LANGUAGES.find(
    (entry) => entry.name.toLowerCase() === raw
  );
  if (byName) {
    return byName.code;
  }

  return SOURCE_LANGUAGE_CODE;
}

export function languageCodeToName(code) {
  const normalized = normalizeLanguageCode(code);
  const entry = SUPPORTED_LANGUAGES.find((item) => item.code === normalized);
  return entry ? entry.name : SOURCE_LANGUAGE;
}

export function normalizeTargetLanguage(value) {
  if (value == null || value === '') {
    return SOURCE_LANGUAGE;
  }

  const raw = String(value).trim();
  if (!raw) {
    return SOURCE_LANGUAGE;
  }

  if (TARGET_LANGUAGES.includes(raw)) {
    return raw;
  }

  const alias = LANGUAGE_ALIASES[raw.toLowerCase()];
  if (alias) {
    return alias;
  }

  if (raw.includes(':')) {
    const [translationPart] = raw.split(':');
    return languageCodeToName(translationPart);
  }

  return SOURCE_LANGUAGE;
}

export function isEnglishTarget(targetLanguage) {
  return normalizeTargetLanguage(targetLanguage) === SOURCE_LANGUAGE;
}

export function parseStoredLanguagePreference(storedValue) {
  const raw = String(storedValue ?? '').trim();
  if (!raw) {
    return {
      translationLanguage: SOURCE_LANGUAGE_CODE,
      speechLanguage: SOURCE_LANGUAGE_CODE,
      translationLanguageName: SOURCE_LANGUAGE,
      speechLanguageName: SOURCE_LANGUAGE,
    };
  }

  if (raw.includes(':')) {
    const [translationPart, speechPart] = raw.split(':');
    const translationCode = normalizeLanguageCode(translationPart);
    const speechCode = normalizeLanguageCode(speechPart || translationPart);
    return {
      translationLanguage: translationCode,
      speechLanguage: speechCode,
      translationLanguageName: languageCodeToName(translationCode),
      speechLanguageName: languageCodeToName(speechCode),
    };
  }

  const legacyName = normalizeTargetLanguage(raw);
  const legacyCode = normalizeLanguageCode(legacyName);
  return {
    translationLanguage: legacyCode,
    speechLanguage: legacyCode,
    translationLanguageName: legacyName,
    speechLanguageName: legacyName,
  };
}

export function getTranslationLanguageFromUser(user) {
  if (!user) {
    return SOURCE_LANGUAGE;
  }

  if (user.translationLanguage) {
    return languageCodeToName(user.translationLanguage);
  }

  return parseStoredLanguagePreference(
    user.language ?? user.target_language ?? user.targetLanguage
  ).translationLanguageName;
}

export function getSpeechLanguageFromUser(user) {
  if (!user) {
    return SOURCE_LANGUAGE;
  }

  if (user.speechLanguage) {
    return languageCodeToName(user.speechLanguage);
  }

  return parseStoredLanguagePreference(
    user.language ?? user.target_language ?? user.targetLanguage
  ).speechLanguageName;
}

export const SPEECH_TEXT_UNAVAILABLE = 'Speech output is unavailable for this result.';

/**
 * Selects the displayed translated phrase from translationLanguage only.
 */
export function resolveDisplayPhrase({
  phraseTranslations = null,
  translationLanguage,
  englishPhrase = '',
  translatedPhrase = '',
}) {
  const translationCode = normalizeLanguageCode(translationLanguage);

  if (phraseTranslations?.[translationCode]) {
    return phraseTranslations[translationCode];
  }

  if (translationCode === SOURCE_LANGUAGE_CODE) {
    return englishPhrase || translatedPhrase;
  }

  return translatedPhrase || englishPhrase;
}

/**
 * Selects TTS text from speechLanguage only.
 * Never uses translatedText or translationLanguage for speech selection.
 */
export function resolveSpeechText({
  recognizedText = '',
  englishPhrase = '',
  phraseTranslations = null,
  speechLanguage,
}) {
  const speechCode = normalizeLanguageCode(speechLanguage);

  if (phraseTranslations?.[speechCode]) {
    const phrase = String(phraseTranslations[speechCode]).trim();
    if (phrase) {
      return phrase;
    }
  }

  if (speechCode === SOURCE_LANGUAGE_CODE) {
    return englishPhrase || recognizedText;
  }

  return '';
}
