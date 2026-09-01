const SOURCE_LANGUAGE = "English";
const SOURCE_LANGUAGE_CODE = "en";

const SUPPORTED_LANGUAGES = [
    { code: "en", name: "English" },
    { code: "ur", name: "Urdu" },
    { code: "pa", name: "Punjabi" },
];

const SUPPORTED_TARGET_LANGUAGES = SUPPORTED_LANGUAGES.map((entry) => entry.name);

const LANGUAGE_ALIASES = {
    en: "English",
    english: "English",
    ur: "Urdu",
    urdu: "Urdu",
    pa: "Punjabi",
    punjabi: "Punjabi",
};

const LANGUAGE_CODES = {
    English: "en",
    Urdu: "ur",
    Punjabi: "pa",
};

function normalizeTargetLanguage(value) {
    if (value == null || value === "") {
        return SOURCE_LANGUAGE;
    }

    const raw = String(value).trim();
    if (!raw) {
        return SOURCE_LANGUAGE;
    }

    if (SUPPORTED_TARGET_LANGUAGES.includes(raw)) {
        return raw;
    }

    const alias = LANGUAGE_ALIASES[raw.toLowerCase()];
    if (alias) {
        return alias;
    }

    return SOURCE_LANGUAGE;
}

function normalizeLanguageCode(value) {
    const raw = String(value ?? "").trim().toLowerCase();
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

function languageCodeToName(code) {
    const normalized = normalizeLanguageCode(code);
    const entry = SUPPORTED_LANGUAGES.find((item) => item.code === normalized);
    return entry ? entry.name : SOURCE_LANGUAGE;
}

function languageNameToCode(name) {
    return normalizeLanguageCode(name);
}

function isSupportedTargetLanguage(value) {
    const normalized = normalizeTargetLanguage(value);
    return SUPPORTED_TARGET_LANGUAGES.includes(normalized);
}

function isSupportedLanguageCode(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) {
        return false;
    }

    if (LANGUAGE_ALIASES[raw]) {
        const code = raw.length === 2 ? raw : LANGUAGE_CODES[LANGUAGE_ALIASES[raw]];
        return SUPPORTED_LANGUAGES.some((entry) => entry.code === code);
    }

    const byName = SUPPORTED_LANGUAGES.find(
        (entry) => entry.name.toLowerCase() === raw
    );
    if (byName) {
        return true;
    }

    return SUPPORTED_LANGUAGES.some((entry) => entry.code === raw);
}

function isEnglishTarget(targetLanguage) {
    return normalizeTargetLanguage(targetLanguage) === SOURCE_LANGUAGE;
}

function getSupportedLanguages() {
    return SUPPORTED_LANGUAGES.map((entry) => ({ ...entry }));
}

/**
 * Persist translation + speech preferences in users.language without schema changes.
 * Format: "<translationCode>:<speechCode>" e.g. "ur:pa"
 * Legacy values like "Urdu" map to both fields.
 */
function encodeLanguagePreference(translationLanguage, speechLanguage) {
    const translationCode = normalizeLanguageCode(translationLanguage);
    const speechCode = normalizeLanguageCode(speechLanguage);
    return `${translationCode}:${speechCode}`;
}

function parseStoredLanguagePreference(storedValue) {
    const raw = String(storedValue ?? "").trim();
    if (!raw) {
        return {
            translationLanguage: SOURCE_LANGUAGE_CODE,
            speechLanguage: SOURCE_LANGUAGE_CODE,
            translationLanguageName: SOURCE_LANGUAGE,
            speechLanguageName: SOURCE_LANGUAGE,
        };
    }

    if (raw.includes(":")) {
        const [translationPart, speechPart] = raw.split(":");
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
    const legacyCode = languageNameToCode(legacyName);
    return {
        translationLanguage: legacyCode,
        speechLanguage: legacyCode,
        translationLanguageName: legacyName,
        speechLanguageName: legacyName,
    };
}

function buildLanguageSettingsResponse(storedValue) {
    const parsed = parseStoredLanguagePreference(storedValue);
    return {
        language: {
            translationLanguage: parsed.translationLanguage,
            speechLanguage: parsed.speechLanguage,
            translationLanguageName: parsed.translationLanguageName,
            speechLanguageName: parsed.speechLanguageName,
            sourceLanguage: SOURCE_LANGUAGE,
            sourceLanguageCode: SOURCE_LANGUAGE_CODE,
        },
        supportedLanguages: getSupportedLanguages(),
    };
}

module.exports = {
    SOURCE_LANGUAGE,
    SOURCE_LANGUAGE_CODE,
    SUPPORTED_LANGUAGES,
    SUPPORTED_TARGET_LANGUAGES,
    LANGUAGE_ALIASES,
    LANGUAGE_CODES,
    normalizeTargetLanguage,
    normalizeLanguageCode,
    languageCodeToName,
    languageNameToCode,
    isSupportedTargetLanguage,
    isSupportedLanguageCode,
    isEnglishTarget,
    getSupportedLanguages,
    encodeLanguagePreference,
    parseStoredLanguagePreference,
    buildLanguageSettingsResponse,
};
