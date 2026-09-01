/**
 * Punjabi TTS speech-path tests.
 */

import { PHRASE_TRANSLATIONS } from '../constants/phraseTranslations';
import { PUNJABI_TTS_PHRASES } from '../constants/punjabiTtsPhrases';
import {
  isShahmukhiText,
  isGurmukhiText,
  isGurmukhiPunjabiLocale,
  resolvePunjabiEngineText,
} from '../utils/punjabiSpeech';

const PAIN = PHRASE_TRANSLATIONS.pain;

describe('punjabiSpeech script detection', () => {
  it('detects Shahmukhi display phrases', () => {
    expect(isShahmukhiText(PAIN.pa)).toBe(true);
    expect(isGurmukhiText(PAIN.pa)).toBe(false);
  });

  it('detects Gurmukhi TTS phrases', () => {
    expect(isGurmukhiText(PUNJABI_TTS_PHRASES.pain)).toBe(true);
    expect(isShahmukhiText(PUNJABI_TTS_PHRASES.pain)).toBe(false);
  });

  it('treats pa-IN as Gurmukhi Punjabi locale', () => {
    expect(isGurmukhiPunjabiLocale('pa-IN')).toBe(true);
    expect(isGurmukhiPunjabiLocale('ur-PK')).toBe(false);
  });
});

describe('resolvePunjabiEngineText', () => {
  it('maps Shahmukhi display phrase to Gurmukhi engine text for pa-IN', () => {
    const engineText = resolvePunjabiEngineText({
      recognizedText: 'Pain',
      displayPhrase: PAIN.pa,
      locale: 'pa-IN',
    });

    expect(engineText).toBe(PUNJABI_TTS_PHRASES.pain);
    expect(engineText).not.toBe(PAIN.pa);
    expect(engineText).not.toBe(PAIN.ur);
  });

  it('returns Gurmukhi text unchanged when already Gurmukhi', () => {
    expect(
      resolvePunjabiEngineText({
        recognizedText: 'Pain',
        displayPhrase: PUNJABI_TTS_PHRASES.pain,
        locale: 'pa-IN',
      })
    ).toBe(PUNJABI_TTS_PHRASES.pain);
  });

  it('returns null for unknown words with Shahmukhi display text on Gurmukhi voice', () => {
    expect(
      resolvePunjabiEngineText({
        recognizedText: 'Unknown',
        displayPhrase: 'Phrase unavailable',
        locale: 'pa-IN',
      })
    ).toBeNull();
  });
});

describe('all active vocabulary Gurmukhi TTS phrases', () => {
  const words = Object.keys(PHRASE_TRANSLATIONS);

  for (const word of words) {
    it(`provides Gurmukhi TTS phrase for ${word}`, () => {
      const display = PHRASE_TRANSLATIONS[word].pa;
      const engine = resolvePunjabiEngineText({
        recognizedText: word,
        displayPhrase: display,
        locale: 'pa-IN',
      });

      expect(engine).toBe(PUNJABI_TTS_PHRASES[word]);
      expect(isGurmukhiText(engine)).toBe(true);
    });
  }
});
