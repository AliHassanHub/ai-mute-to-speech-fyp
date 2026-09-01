/**
 * Independent translation + speech language tests.
 */

import { PHRASE_TRANSLATIONS } from '../constants/phraseTranslations';
import {
  resolveDisplayPhrase,
  resolveSpeechText,
} from '../utils/language';

const PAIN_PHRASES = PHRASE_TRANSLATIONS.pain;

const MIXED_CASES = [
  {
    name: 'translation=en / speech=en',
    translationLanguage: 'en',
    speechLanguage: 'en',
    display: PAIN_PHRASES.en,
    speech: PAIN_PHRASES.en,
  },
  {
    name: 'translation=ur / speech=ur',
    translationLanguage: 'ur',
    speechLanguage: 'ur',
    display: PAIN_PHRASES.ur,
    speech: PAIN_PHRASES.ur,
  },
  {
    name: 'translation=pa / speech=pa',
    translationLanguage: 'pa',
    speechLanguage: 'pa',
    display: PAIN_PHRASES.pa,
    speech: PAIN_PHRASES.pa,
  },
  {
    name: 'translation=ur / speech=en',
    translationLanguage: 'ur',
    speechLanguage: 'en',
    display: PAIN_PHRASES.ur,
    speech: PAIN_PHRASES.en,
  },
  {
    name: 'translation=pa / speech=en',
    translationLanguage: 'pa',
    speechLanguage: 'en',
    display: PAIN_PHRASES.pa,
    speech: PAIN_PHRASES.en,
  },
  {
    name: 'translation=en / speech=ur',
    translationLanguage: 'en',
    speechLanguage: 'ur',
    display: PAIN_PHRASES.en,
    speech: PAIN_PHRASES.ur,
  },
  {
    name: 'translation=en / speech=pa',
    translationLanguage: 'en',
    speechLanguage: 'pa',
    display: PAIN_PHRASES.en,
    speech: PAIN_PHRASES.pa,
  },
  {
    name: 'translation=ur / speech=pa',
    translationLanguage: 'ur',
    speechLanguage: 'pa',
    display: PAIN_PHRASES.ur,
    speech: PAIN_PHRASES.pa,
  },
  {
    name: 'translation=pa / speech=ur',
    translationLanguage: 'pa',
    speechLanguage: 'ur',
    display: PAIN_PHRASES.pa,
    speech: PAIN_PHRASES.ur,
  },
];

describe('independent translation and speech selection', () => {
  const phraseTranslations = PAIN_PHRASES;
  const englishPhrase = PAIN_PHRASES.en;

  for (const testCase of MIXED_CASES) {
    it(testCase.name, () => {
      const display = resolveDisplayPhrase({
        phraseTranslations,
        translationLanguage: testCase.translationLanguage,
        englishPhrase,
      });
      const speech = resolveSpeechText({
        recognizedText: 'Pain',
        englishPhrase,
        phraseTranslations,
        speechLanguage: testCase.speechLanguage,
      });

      expect(display).toBe(testCase.display);
      expect(speech).toBe(testCase.speech);
    });
  }

  it('never uses Urdu phrase when speechLanguage is Punjabi', () => {
    const speech = resolveSpeechText({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'pa',
    });

    expect(speech).toBe(PAIN_PHRASES.pa);
    expect(speech).not.toBe(PAIN_PHRASES.ur);
  });

  it('never uses Punjabi phrase when speechLanguage is Urdu', () => {
    const speech = resolveSpeechText({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'ur',
    });

    expect(speech).toBe(PAIN_PHRASES.ur);
    expect(speech).not.toBe(PAIN_PHRASES.pa);
  });
});

describe('all active vocabulary phrase translations', () => {
  const words = Object.keys(PHRASE_TRANSLATIONS);

  for (const word of words) {
    it(`provides en/ur/pa phrases for ${word}`, () => {
      const entry = PHRASE_TRANSLATIONS[word];
      expect(entry.en).toBeTruthy();
      expect(entry.ur).toBeTruthy();
      expect(entry.pa).toBeTruthy();
      expect(entry.ur).not.toBe(entry.pa);
    });
  }
});
