/**
 * Client language preference helpers.
 */

import {
  getTranslationLanguageFromUser,
  getSpeechLanguageFromUser,
  normalizeLanguageCode,
  parseStoredLanguagePreference,
  resolveSpeechText,
  resolveDisplayPhrase,
} from '../utils/language';
import { getSupportedLanguages } from '../constants/languages';
import { PHRASE_TRANSLATIONS } from '../constants/phraseTranslations';

const PAIN_PHRASES = PHRASE_TRANSLATIONS.pain;

describe('supported languages', () => {
  it('returns English, Urdu, and Punjabi', () => {
    const languages = getSupportedLanguages();
    expect(languages).toHaveLength(3);
    expect(languages.map((entry) => entry.code)).toEqual(['en', 'ur', 'pa']);
  });
});

describe('parseStoredLanguagePreference', () => {
  it('parses composite translation:speech values', () => {
    const parsed = parseStoredLanguagePreference('ur:pa');
    expect(parsed.translationLanguage).toBe('ur');
    expect(parsed.speechLanguage).toBe('pa');
  });

  it('defaults legacy English users to en/en', () => {
    const parsed = parseStoredLanguagePreference('English');
    expect(parsed.translationLanguage).toBe('en');
    expect(parsed.speechLanguage).toBe('en');
  });

  it('handles missing legacy speech language', () => {
    const parsed = parseStoredLanguagePreference('Urdu');
    expect(parsed.translationLanguage).toBe('ur');
    expect(parsed.speechLanguage).toBe('ur');
  });
});

describe('user language getters', () => {
  it('reads independent translation and speech values from user profile', () => {
    const user = {
      translationLanguage: 'ur',
      speechLanguage: 'en',
    };

    expect(getTranslationLanguageFromUser(user)).toBe('Urdu');
    expect(getSpeechLanguageFromUser(user)).toBe('English');
  });

  it('supports Punjabi selections', () => {
    const user = {
      language: 'pa:pa',
    };

    expect(getTranslationLanguageFromUser(user)).toBe('Punjabi');
    expect(getSpeechLanguageFromUser(user)).toBe('Punjabi');
  });
});

describe('normalizeLanguageCode', () => {
  it('normalizes English, Urdu, and Punjabi inputs', () => {
    expect(normalizeLanguageCode('English')).toBe('en');
    expect(normalizeLanguageCode('ur')).toBe('ur');
    expect(normalizeLanguageCode('Punjabi')).toBe('pa');
  });
});

describe('resolveDisplayPhrase', () => {
  it('uses translationLanguage only for displayed text', () => {
    expect(
      resolveDisplayPhrase({
        phraseTranslations: PAIN_PHRASES,
        translationLanguage: 'ur',
        englishPhrase: PAIN_PHRASES.en,
      })
    ).toBe(PAIN_PHRASES.ur);
  });
});

describe('resolveSpeechText', () => {
  it('uses English phrase when speech output is English', () => {
    expect(
      resolveSpeechText({
        recognizedText: 'Pain',
        englishPhrase: PAIN_PHRASES.en,
        phraseTranslations: PAIN_PHRASES,
        speechLanguage: 'en',
      })
    ).toBe(PAIN_PHRASES.en);
  });

  it('uses Urdu phrase when speech output is Urdu', () => {
    expect(
      resolveSpeechText({
        recognizedText: 'Pain',
        englishPhrase: PAIN_PHRASES.en,
        phraseTranslations: PAIN_PHRASES,
        speechLanguage: 'ur',
      })
    ).toBe(PAIN_PHRASES.ur);
  });

  it('uses Punjabi phrase when speech output is Punjabi', () => {
    expect(
      resolveSpeechText({
        recognizedText: 'Pain',
        englishPhrase: PAIN_PHRASES.en,
        phraseTranslations: PAIN_PHRASES,
        speechLanguage: 'pa',
      })
    ).toBe(PAIN_PHRASES.pa);
  });

  it('speaks Punjabi when translation is Urdu and speech is Punjabi', () => {
    const speech = resolveSpeechText({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'pa',
    });

    expect(speech).toBe(PAIN_PHRASES.pa);
    expect(speech).not.toBe(PAIN_PHRASES.ur);
  });

  it('speaks Urdu when translation is Punjabi and speech is Urdu', () => {
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
