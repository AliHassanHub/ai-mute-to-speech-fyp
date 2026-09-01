/**
 * Curated phrase translations for the active EMG vocabulary.
 *
 * Phrase-level translations are explicit and deterministic.
 * Keys use ISO-style language codes (en, ur, pa).
 */

const { normalizeLanguageCode, normalizeTargetLanguage } = require("./languages");

const PHRASE_UNAVAILABLE = "Phrase unavailable";
const TRANSLATION_UNAVAILABLE = "Translation unavailable";

const PHRASE_TRANSLATIONS = {
    help: {
        en: "I need help.",
        ur: "مجھے مدد چاہیے۔",
        pa: "مینوں مدد چاہیدی اے۔",
    },
    no: {
        en: "No, please.",
        ur: "نہیں، براہ کرم۔",
        pa: "نئیں، مہربانی کر کے۔",
    },
    pain: {
        en: "I am feeling pain.",
        ur: "مجھے درد ہو رہا ہے۔",
        pa: "مینوں دکھ ہو رہی اے۔",
    },
    stop: {
        en: "Please stop.",
        ur: "براہ کرم رک جائیں۔",
        pa: "مہربانی کر کے رُک جاؤ۔",
    },
    assistance: {
        en: "I need assistance.",
        ur: "مجھے معاونت چاہیے۔",
        pa: "مینوں سہائتا چاہیدی اے۔",
    },
    medical: {
        en: "I need medical help.",
        ur: "مجھے طبی مدد چاہیے۔",
        pa: "مینوں ڈاکٹری مدد چاہیدی اے۔",
    },
    pick: {
        en: "Please pick it up.",
        ur: "براہ کرم اسے اٹھائیں۔",
        pa: "مہربانی کر کے ایہہ چک لو۔",
    },
    land: {
        en: "Please help me land safely.",
        ur: "براہ کرم مجھے محفوظ طریقے سے اتارنے میں مدد کریں۔",
        pa: "مہربانی کر کے مینوں محفوظ طریقے نال اتارن چ مدد کرو۔",
    },
    up: {
        en: "Please move me up.",
        ur: "براہ کرم مجھے اوپر منتقل کریں۔",
        pa: "مہربانی کر کے مینوں اوپر لے جاؤ۔",
    },
};

function resolveLanguageKey(targetLanguage) {
    const directCode = normalizeLanguageCode(targetLanguage);
    if (directCode === "en" || directCode === "ur" || directCode === "pa") {
        return directCode;
    }

    const normalizedName = normalizeTargetLanguage(targetLanguage);
    const nameCode = normalizeLanguageCode(normalizedName);
    if (nameCode === "en" || nameCode === "ur" || nameCode === "pa") {
        return nameCode;
    }

    return null;
}

function normalizeVocabularyKey(text) {
    return String(text || "")
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

function getEnglishPhraseForWord(word) {
    const entry = lookupPhraseEntry(word);
    if (!entry) {
        return null;
    }
    return entry.en;
}

function getTranslatedPhraseForWord(word, targetLanguage) {
    const entry = lookupPhraseEntry(word);
    if (!entry) {
        return null;
    }

    const langKey = resolveLanguageKey(targetLanguage) ?? "en";
    const translation = entry[langKey];
    if (!translation) {
        return null;
    }

    return translation;
}

function getActiveVocabularyWords() {
    return Object.keys(PHRASE_TRANSLATIONS);
}

function buildPhraseTranslationsForWord(word) {
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

function buildPhraseBundleForWord(word, targetLanguage) {
    const { available, phraseTranslations } = buildPhraseTranslationsForWord(word);
    if (!available) {
        return {
            available: false,
            englishPhrase: PHRASE_UNAVAILABLE,
            translatedPhrase: TRANSLATION_UNAVAILABLE,
            phraseTranslations,
        };
    }

    const langKey = resolveLanguageKey(targetLanguage) ?? "en";

    return {
        available: true,
        englishPhrase: phraseTranslations.en,
        translatedPhrase: phraseTranslations[langKey] ?? TRANSLATION_UNAVAILABLE,
        phraseTranslations,
        translationLanguage: langKey,
    };
}

module.exports = {
    PHRASE_TRANSLATIONS,
    PHRASE_UNAVAILABLE,
    TRANSLATION_UNAVAILABLE,
    normalizeVocabularyKey,
    lookupPhraseEntry,
    getEnglishPhraseForWord,
    getTranslatedPhraseForWord,
    getActiveVocabularyWords,
    buildPhraseBundleForWord,
};
