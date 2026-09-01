/**
 * Client mirror of server phrase translations for presentation-layer generation.
 */

import { normalizeLanguageCode, normalizeTargetLanguage } from '../utils/language';

export const PHRASE_UNAVAILABLE = 'Phrase unavailable';
export const TRANSLATION_UNAVAILABLE = 'Translation unavailable';

export const PHRASE_TRANSLATIONS = {
  help: {
    en: 'I need help.',
    ur: 'مجھے مدد چاہیے۔',
    pa: 'مینوں مدد چاہیدی اے۔',
  },
  no: {
    en: 'No, please.',
    ur: 'نہیں، براہ کرم۔',
    pa: 'نئیں، مہربانی کر کے۔',
  },
  pain: {
    en: 'I am feeling pain.',
    ur: 'مجھے درد ہو رہا ہے۔',
    pa: 'مینوں دکھ ہو رہی اے۔',
  },
  stop: {
    en: 'Please stop.',
    ur: 'براہ کرم رک جائیں۔',
    pa: 'مہربانی کر کے رُک جاؤ۔',
  },
  assistance: {
    en: 'I need assistance.',
    ur: 'مجھے معاونت چاہیے۔',
    pa: 'مینوں سہائتا چاہیدی اے۔',
  },
  medical: {
    en: 'I need medical help.',
    ur: 'مجھے طبی مدد چاہیے۔',
    pa: 'مینوں ڈاکٹری مدد چاہیدی اے۔',
  },
  pick: {
    en: 'Please pick it up.',
    ur: 'براہ کرم اسے اٹھائیں۔',
    pa: 'مہربانی کر کے ایہہ چک لو۔',
  },
  land: {
    en: 'Please help me land safely.',
    ur: 'براہ کرم مجھے محفوظ طریقے سے اتارنے میں مدد کریں۔',
    pa: 'مہربانی کر کے مینوں محفوظ طریقے نال اتارن چ مدد کرو۔',
  },
  up: {
    en: 'Please move me up.',
    ur: 'براہ کرم مجھے اوپر منتقل کریں۔',
    pa: 'مہربانی کر کے مینوں اوپر لے جاؤ۔',
  },
};

function resolveLanguageKey(targetLanguage) {
  const directCode = normalizeLanguageCode(targetLanguage);
  if (directCode === 'en' || directCode === 'ur' || directCode === 'pa') {
    return directCode;
  }

  const normalizedName = normalizeTargetLanguage(targetLanguage);
  const nameCode = normalizeLanguageCode(normalizedName);
  if (nameCode === 'en' || nameCode === 'ur' || nameCode === 'pa') {
    return nameCode;
  }

  return null;
}

export function normalizeVocabularyKey(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase();
}

function lookupPhraseEntry(word) {
  const key = normalizeVocabularyKey(word);
  if (!key) {
    return null;
  }
  return PHRASE_TRANSLATIONS[key] ?? null;
}

export function getPhraseForWord(word) {
  const entry = lookupPhraseEntry(word);
  if (!entry) {
    return {
      available: false,
      phrase: PHRASE_UNAVAILABLE,
    };
  }

  return {
    available: true,
    phrase: entry.en,
  };
}

export function getTranslatedPhraseForWord(word, targetLanguage) {
  const entry = lookupPhraseEntry(word);
  if (!entry) {
    return null;
  }

  const langKey = resolveLanguageKey(targetLanguage) ?? 'en';
  return entry[langKey] ?? null;
}

export function getActiveVocabularyWords() {
  return Object.keys(PHRASE_TRANSLATIONS);
}

export function buildPhraseTranslationsForWord(word) {
  const entry = lookupPhraseEntry(word);
  if (!entry) {
    return {
      available: false,
      phraseTranslations: {
        en: PHRASE_UNAVAILABLE,
        ur: TRANSLATION_UNAVAILABLE,
        pa: TRANSLATION_UNAVAILABLE,
      },
    };
  }

  return {
    available: true,
    phraseTranslations: {
      en: entry.en,
      ur: entry.ur,
      pa: entry.pa,
    },
  };
}

export function buildPhraseBundleForWord(word, targetLanguage) {
  const { available, phraseTranslations } = buildPhraseTranslationsForWord(word);
  if (!available) {
    return {
      available: false,
      englishPhrase: PHRASE_UNAVAILABLE,
      translatedPhrase: TRANSLATION_UNAVAILABLE,
      phraseTranslations,
    };
  }

  const langKey = resolveLanguageKey(targetLanguage) ?? 'en';
  return {
    available: true,
    englishPhrase: phraseTranslations.en,
    translatedPhrase: phraseTranslations[langKey] ?? TRANSLATION_UNAVAILABLE,
    phraseTranslations,
    translationLanguage: langKey,
  };
}
