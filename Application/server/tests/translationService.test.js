/**
 * Translation service tests for word-level EMG vocabulary.
 */

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
    translateRecognizedText,
    translateRecognizedTextDetailed,
} = require("../src/services/translationService");
const { VOCABULARY_TRANSLATIONS } = require("../src/constants/wordTranslations");
const { AppError } = require("../src/utils/AppError");

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

const WORDS_WITH_DISTINCT_PUNJABI = ["no", "pain", "stop", "medical", "pick", "land", "up"];

describe("translationService", () => {
    it("returns English unchanged for English target", () => {
        assert.equal(translateRecognizedText("Help", "English"), "Help");
        const detailed = translateRecognizedTextDetailed("Pain", "English");
        assert.equal(detailed.translatedText, "Pain");
        assert.equal(detailed.sourceLanguage, "English");
        assert.equal(detailed.targetLanguage, "English");
    });

    it("translates a recognized vocabulary word to Urdu", () => {
        assert.equal(translateRecognizedText("Help", "Urdu"), "مدد");
        assert.equal(translateRecognizedText("pain", "Urdu"), "درد");
    });

    it("translates a recognized vocabulary word to Punjabi", () => {
        assert.equal(translateRecognizedText("Stop", "Punjabi"), "رُک");
        assert.equal(translateRecognizedText("pain", "Punjabi"), "دکھ");
        assert.equal(translateRecognizedText("Medical", "Punjabi"), "ڈاکٹری");
    });

    it("translates all active vocabulary labels", () => {
        for (const word of ACTIVE_WORDS) {
            assert.ok(translateRecognizedText(word, "Urdu"), `${word} should translate to Urdu`);
            assert.ok(translateRecognizedText(word, "Punjabi"), `${word} should translate to Punjabi`);
        }
    });

    it("never returns the Urdu dictionary value when Punjabi is requested for distinct words", () => {
        for (const word of WORDS_WITH_DISTINCT_PUNJABI) {
            const key = word.toLowerCase();
            const urdu = translateRecognizedText(word, "ur");
            const punjabi = translateRecognizedText(word, "pa");

            assert.notEqual(
                punjabi,
                urdu,
                `${word}: Punjabi (${punjabi}) must not equal Urdu (${urdu})`
            );
            assert.equal(
                punjabi,
                VOCABULARY_TRANSLATIONS[key].pa,
                `${word}: Punjabi lookup must use pa dictionary entry`
            );
        }
    });

    it("resolves pa code to Punjabi dictionary entries, not Urdu", () => {
        assert.equal(translateRecognizedText("Pain", "pa"), "دکھ");
        assert.notEqual(translateRecognizedText("Pain", "pa"), "درد");
        assert.equal(translateRecognizedText("Pick", "pa"), "چکو");
        assert.equal(translateRecognizedText("Pick", "ur"), "اٹھاؤ");
    });

    it("translates unknown-best-guess messages when the guess is in vocabulary", () => {
        const urdu = translateRecognizedText("Unknown (best guess: Help)", "Urdu");
        const punjabi = translateRecognizedText("Unknown (best guess: Help)", "Punjabi");

        assert.match(urdu, /مدد/);
        assert.match(punjabi, /مدد/);
        assert.notEqual(urdu, punjabi);
    });

    it("defaults unknown language aliases to English passthrough", () => {
        assert.equal(translateRecognizedText("Help", "French"), "Help");
        const detailed = translateRecognizedTextDetailed("Help", "French");
        assert.equal(detailed.targetLanguage, "English");
    });

    it("rejects unsupported recognition text for non-English targets", () => {
        assert.throws(
            () => translateRecognizedText("Could not recognize speech", "Urdu"),
            (error) =>
                error instanceof AppError &&
                error.code === "TRANSLATION_UNSUPPORTED_TEXT"
        );

        assert.throws(
            () => translateRecognizedText("Could not recognize speech", "Punjabi"),
            (error) =>
                error instanceof AppError &&
                error.code === "TRANSLATION_UNSUPPORTED_TEXT"
        );
    });

    it("rejects empty text for non-English targets", () => {
        assert.throws(
            () => translateRecognizedText("", "Urdu"),
            (error) =>
                error instanceof AppError &&
                error.code === "TRANSLATION_EMPTY_TEXT"
        );
    });

    it("normalizes language aliases without mapping pa to ur", () => {
        assert.equal(translateRecognizedText("Help", "ur"), "مدد");
        assert.equal(translateRecognizedText("Pain", "pa"), "دکھ");
        assert.equal(translateRecognizedText("Pain", "punjabi"), "دکھ");
        assert.notEqual(translateRecognizedText("Pain", "pa"), translateRecognizedText("Pain", "ur"));
    });
});
