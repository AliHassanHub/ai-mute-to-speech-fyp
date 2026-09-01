const { AppError } = require("../utils/AppError");
const {
    SOURCE_LANGUAGE,
    normalizeTargetLanguage,
    isEnglishTarget,
    isSupportedTargetLanguage,
} = require("../constants/languages");
const { translateRecognizedToken } = require("../constants/wordTranslations");
const { getTranslatedPhraseForWord } = require("./phraseService");

/**
 * Translate a recognized English EMG label into the user's target language.
 *
 * @returns {{
 *   sourceText: string,
 *   sourceLanguage: string,
 *   targetLanguage: string,
 *   translatedText: string,
 * }}
 */
function translateRecognizedTextDetailed(recognizedText, targetLanguage) {
    const targetLabel = normalizeTargetLanguage(targetLanguage) || SOURCE_LANGUAGE;
    const sourceText = String(recognizedText ?? "").trim();

    if (!sourceText) {
        if (isEnglishTarget(targetLabel)) {
            return {
                sourceText,
                sourceLanguage: SOURCE_LANGUAGE,
                targetLanguage: targetLabel,
                translatedText: sourceText,
            };
        }
        throw new AppError(
            "Nothing to translate.",
            422,
            "TRANSLATION_EMPTY_TEXT"
        );
    }

    if (isEnglishTarget(targetLabel)) {
        return {
            sourceText,
            sourceLanguage: SOURCE_LANGUAGE,
            targetLanguage: targetLabel,
            translatedText: sourceText,
        };
    }

    if (!isSupportedTargetLanguage(targetLabel)) {
        throw new AppError(
            `Target language "${targetLabel}" is not supported.`,
            400,
            "TRANSLATION_UNSUPPORTED_LANGUAGE"
        );
    }

    const translatedText = translateRecognizedToken(sourceText, targetLabel);
    if (!translatedText) {
        throw new AppError(
            "Translation is not available for this recognition result.",
            422,
            "TRANSLATION_UNSUPPORTED_TEXT"
        );
    }

    return {
        sourceText,
        sourceLanguage: SOURCE_LANGUAGE,
        targetLanguage: targetLabel,
        translatedText,
    };
}

function translateRecognizedText(recognizedText, targetLanguage) {
    return translateRecognizedTextDetailed(recognizedText, targetLanguage)
        .translatedText;
}

/**
 * Translate the curated English phrase for a recognized vocabulary word.
 * Used when persisting/displaying full-sentence output after AI word prediction.
 */
function translatePhraseForWordDetailed(recognizedText, targetLanguage) {
    const targetLabel = normalizeTargetLanguage(targetLanguage) || SOURCE_LANGUAGE;
    const sourceText = String(recognizedText ?? "").trim();

    if (!sourceText) {
        if (isEnglishTarget(targetLabel)) {
            return {
                sourceText,
                sourceLanguage: SOURCE_LANGUAGE,
                targetLanguage: targetLabel,
                translatedText: sourceText,
            };
        }
        throw new AppError(
            "Nothing to translate.",
            422,
            "TRANSLATION_EMPTY_TEXT"
        );
    }

    if (!isSupportedTargetLanguage(targetLabel)) {
        throw new AppError(
            `Target language "${targetLabel}" is not supported.`,
            400,
            "TRANSLATION_UNSUPPORTED_LANGUAGE"
        );
    }

    const translatedText = getTranslatedPhraseForWord(sourceText, targetLabel);
    if (!translatedText) {
        throw new AppError(
            "Phrase translation is not available for this recognition result.",
            422,
            "TRANSLATION_UNSUPPORTED_TEXT"
        );
    }

    return {
        sourceText,
        sourceLanguage: SOURCE_LANGUAGE,
        targetLanguage: targetLabel,
        translatedText,
    };
}

function translatePhraseForWord(recognizedText, targetLanguage) {
    return translatePhraseForWordDetailed(recognizedText, targetLanguage)
        .translatedText;
}

module.exports = {
    translateRecognizedText,
    translateRecognizedTextDetailed,
    translatePhraseForWord,
    translatePhraseForWordDetailed,
};
