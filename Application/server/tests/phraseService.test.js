/**
 * Phrase generation service tests.
 */

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
    getPhraseForWord,
    getPhraseBundle,
    getTranslatedPhraseForWord,
    getActiveVocabularyWords,
} = require("../src/services/phraseService");
const {
    translatePhraseForWord,
} = require("../src/services/translationService");
const { PHRASE_TRANSLATIONS } = require("../src/constants/phraseTranslations");

const ACTIVE_WORDS = [
    "help",
    "no",
    "pain",
    "stop",
    "Assistance",
    "Medical",
    "Pick",
    "Land",
    "Up",
];

describe("phraseService", () => {
    it("returns English phrases for all active vocabulary words", () => {
        for (const word of ACTIVE_WORDS) {
            const result = getPhraseForWord(word);
            assert.equal(result.available, true);
            assert.ok(result.phrase.length > 0);
        }
    });

    it("normalizes word casing for phrase lookup", () => {
        assert.equal(getPhraseForWord("Pain").phrase, "I am feeling pain.");
        assert.equal(getPhraseForWord("PAIN").phrase, "I am feeling pain.");
    });

    it("returns phrase unavailable for unknown words", () => {
        const result = getPhraseForWord("Unknown");
        assert.equal(result.available, false);
        assert.equal(result.phrase, "Phrase unavailable");
    });

    it("returns Urdu and Punjabi phrase translations for pain", () => {
        assert.equal(
            getTranslatedPhraseForWord("pain", "ur"),
            PHRASE_TRANSLATIONS.pain.ur
        );
        assert.equal(
            getTranslatedPhraseForWord("pain", "pa"),
            PHRASE_TRANSLATIONS.pain.pa
        );
        assert.notEqual(
            getTranslatedPhraseForWord("pain", "ur"),
            getTranslatedPhraseForWord("pain", "pa")
        );
    });

    it("exposes all active vocabulary words dynamically", () => {
        assert.equal(getActiveVocabularyWords().length, 9);
    });

    it("builds phrase bundles for English, Urdu, and Punjabi", () => {
        const english = getPhraseBundle("help", "en");
        const urdu = getPhraseBundle("help", "ur");
        const punjabi = getPhraseBundle("help", "pa");

        assert.equal(english.translatedPhrase, "I need help.");
        assert.equal(urdu.translatedPhrase, PHRASE_TRANSLATIONS.help.ur);
        assert.equal(punjabi.translatedPhrase, PHRASE_TRANSLATIONS.help.pa);
    });
});

describe("translatePhraseForWord", () => {
    it("returns English phrase for English target", () => {
        assert.equal(
            translatePhraseForWord("Pain", "English"),
            "I am feeling pain."
        );
    });

    it("returns Urdu phrase for Urdu target", () => {
        assert.equal(
            translatePhraseForWord("Pain", "Urdu"),
            PHRASE_TRANSLATIONS.pain.ur
        );
    });

    it("returns Punjabi phrase for Punjabi target", () => {
        assert.equal(
            translatePhraseForWord("Pain", "Punjabi"),
            PHRASE_TRANSLATIONS.pain.pa
        );
    });

    it("returns curated phrase translations for every active vocabulary word", () => {
        for (const word of ACTIVE_WORDS) {
            const key = word.toLowerCase();
            assert.equal(
                translatePhraseForWord(word, "English"),
                PHRASE_TRANSLATIONS[key].en
            );
            assert.equal(
                translatePhraseForWord(word, "Urdu"),
                PHRASE_TRANSLATIONS[key].ur
            );
            assert.equal(
                translatePhraseForWord(word, "Punjabi"),
                PHRASE_TRANSLATIONS[key].pa
            );
            assert.notEqual(
                translatePhraseForWord(word, "Urdu"),
                translatePhraseForWord(word, "Punjabi")
            );
        }
    });
});
