const {
    buildPhraseBundleForWord,
    getEnglishPhraseForWord,
    getTranslatedPhraseForWord,
    getActiveVocabularyWords,
    PHRASE_UNAVAILABLE,
} = require("../constants/phraseTranslations");

function getPhraseForWord(word) {
    const englishPhrase = getEnglishPhraseForWord(word);
    if (!englishPhrase) {
        return {
            available: false,
            phrase: PHRASE_UNAVAILABLE,
        };
    }

    return {
        available: true,
        phrase: englishPhrase,
    };
}

function getPhraseBundle(word, targetLanguage) {
    return buildPhraseBundleForWord(word, targetLanguage);
}

module.exports = {
    getPhraseForWord,
    getPhraseBundle,
    getTranslatedPhraseForWord,
    getActiveVocabularyWords,
};
