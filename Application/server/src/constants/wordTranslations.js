/**
 * Curated translations for the active EMG word vocabulary.
 *
 * Keys use ISO-style language codes (en, ur, pa). Lookup must never fall back
 * from Punjabi (pa) to Urdu (ur).
 *
 * Punjabi entries use Shahmukhi script (project convention).
 */

const { normalizeLanguageCode, normalizeTargetLanguage } = require("./languages");

const VOCABULARY_TRANSLATIONS = {
    help: {
        en: "Help",
        ur: "مدد",
        pa: "مدد",
    },
    no: {
        en: "No",
        ur: "نہیں",
        pa: "نئیں",
    },
    pain: {
        en: "Pain",
        ur: "درد",
        pa: "دکھ",
    },
    stop: {
        en: "Stop",
        ur: "رکو",
        pa: "رُک",
    },
    assistance: {
        en: "Assistance",
        ur: "مدد",
        pa: "مدد",
    },
    medical: {
        en: "Medical",
        ur: "طبی",
        pa: "ڈاکٹری",
    },
    pick: {
        en: "Pick",
        ur: "اٹھاؤ",
        pa: "چکو",
    },
    land: {
        en: "Land",
        ur: "زمین",
        pa: "ذرتھی",
    },
    up: {
        en: "Up",
        ur: "اوپر",
        pa: "اُتھے",
    },
};

const UNKNOWN_GUESS_PATTERN =
    /^unknown\s*\(best guess:\s*(.+?)\)\s*$/i;

const UNKNOWN_GUESS_TEMPLATES = {
    ur: (guess) => `نامعلوم (بہترین اندازہ: ${guess})`,
    pa: (guess) => `پتہ نہیں (بہترین اندازہ: ${guess})`,
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

function lookupVocabularyWord(word, targetLanguage) {
    const key = normalizeVocabularyKey(word);
    const entry = VOCABULARY_TRANSLATIONS[key];
    if (!entry) {
        return null;
    }

    const langKey = resolveLanguageKey(targetLanguage);
    if (!langKey || langKey === "en") {
        return null;
    }

    const translation = entry[langKey];
    if (translation == null || translation === "") {
        return null;
    }

    return translation;
}

function translateRecognizedToken(recognizedText, targetLanguage) {
    const sourceText = String(recognizedText ?? "").trim();
    if (!sourceText) {
        return null;
    }

    const langKey = resolveLanguageKey(targetLanguage);
    if (!langKey || langKey === "en") {
        return null;
    }

    const direct = lookupVocabularyWord(sourceText, langKey);
    if (direct) {
        return direct;
    }

    const unknownMatch = sourceText.match(UNKNOWN_GUESS_PATTERN);
    if (unknownMatch) {
        const guess = lookupVocabularyWord(unknownMatch[1], langKey);
        if (guess) {
            const template = UNKNOWN_GUESS_TEMPLATES[langKey];
            return template ? template(guess) : null;
        }
    }

    return null;
}

module.exports = {
    VOCABULARY_TRANSLATIONS,
    resolveLanguageKey,
    lookupVocabularyWord,
    translateRecognizedToken,
};
