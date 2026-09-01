/**
 * Client phrase generation tests.
 */

import {
  getPhraseForWord,
  getTranslatedPhraseForWord,
  getActiveVocabularyWords,
  buildPhraseBundleForWord,
} from '../services/phraseService';
import {
  PHRASE_TRANSLATIONS,
  PHRASE_UNAVAILABLE,
} from '../constants/phraseTranslations';
import { enrichResultWithPhrases } from '../utils/phraseResult';
import { buildResultViewModel } from '../utils/aiPrediction';
import { resolveSpeechText } from '../utils/language';

const ACTIVE_WORDS = [
  'help',
  'no',
  'pain',
  'stop',
  'Assistance',
  'Medical',
  'Pick',
  'Land',
  'Up',
];

describe('phraseService', () => {
  it('returns configured English phrases for all active words', () => {
    expect(getActiveVocabularyWords()).toHaveLength(9);
    for (const word of ACTIVE_WORDS) {
      const result = getPhraseForWord(word);
      expect(result.available).toBe(true);
      expect(result.phrase).toBe(PHRASE_TRANSLATIONS[word.toLowerCase()].en);
    }
  });

  it('normalizes Pain/PAIN to the same phrase', () => {
    expect(getPhraseForWord('Pain').phrase).toBe('I am feeling pain.');
    expect(getPhraseForWord('PAIN').phrase).toBe('I am feeling pain.');
  });

  it('handles unknown words without crashing', () => {
    const result = getPhraseForWord('Uncertain prediction');
    expect(result.available).toBe(false);
    expect(result.phrase).toBe(PHRASE_UNAVAILABLE);
  });

  it('returns distinct Urdu and Punjabi phrase translations for pain', () => {
    const urdu = getTranslatedPhraseForWord('pain', 'ur');
    const punjabi = getTranslatedPhraseForWord('pain', 'pa');
    expect(urdu).toBe(PHRASE_TRANSLATIONS.pain.ur);
    expect(punjabi).toBe(PHRASE_TRANSLATIONS.pain.pa);
    expect(urdu).not.toBe(punjabi);
  });

  it('returns curated phrase translations for every active vocabulary word', () => {
    for (const word of ACTIVE_WORDS) {
      const key = word.toLowerCase();
      expect(getTranslatedPhraseForWord(word, 'en')).toBe(PHRASE_TRANSLATIONS[key].en);
      expect(getTranslatedPhraseForWord(word, 'ur')).toBe(PHRASE_TRANSLATIONS[key].ur);
      expect(getTranslatedPhraseForWord(word, 'pa')).toBe(PHRASE_TRANSLATIONS[key].pa);
      expect(getTranslatedPhraseForWord(word, 'ur')).not.toBe(
        getTranslatedPhraseForWord(word, 'pa')
      );
    }
  });
});

describe('enrichResultWithPhrases', () => {
  it('adds English and translated phrases to a result', () => {
    const enriched = enrichResultWithPhrases(
      { recognizedText: 'Pain' },
      'Urdu'
    );

    expect(enriched.englishPhrase).toBe('I am feeling pain.');
    expect(enriched.translatedPhrase).toBe(PHRASE_TRANSLATIONS.pain.ur);
    expect(enriched.translatedText).toBe(PHRASE_TRANSLATIONS.pain.ur);
  });

  it('adds phraseTranslations for all supported languages', () => {
    const enriched = enrichResultWithPhrases(
      { recognizedText: 'Pain' },
      'Urdu'
    );

    expect(enriched.phraseTranslations).toEqual(PHRASE_TRANSLATIONS.pain);
  });
});

describe('buildResultViewModel phrase output', () => {
  it('shows predicted word and both phrases', () => {
    const view = buildResultViewModel(
      {
        recognizedText: 'Pain',
        accepted: true,
        prediction: { label: 'pain', accepted: true, confidence: 0.9 },
      },
      'Punjabi'
    );

    expect(view.predictedLabel).toBe('Pain');
    expect(view.englishPhrase).toBe('I am feeling pain.');
    expect(view.translatedPhrase).toBe(PHRASE_TRANSLATIONS.pain.pa);
    expect(view.phraseTranslations).toEqual(PHRASE_TRANSLATIONS.pain);
  });
});

describe('resolveSpeechText phrase behavior', () => {
  it('speaks the English phrase when speech is English', () => {
    expect(
      resolveSpeechText({
        recognizedText: 'Pain',
        englishPhrase: PHRASE_TRANSLATIONS.pain.en,
        phraseTranslations: PHRASE_TRANSLATIONS.pain,
        speechLanguage: 'en',
      })
    ).toBe(PHRASE_TRANSLATIONS.pain.en);
  });

  it('speaks the Punjabi phrase when speech is Punjabi', () => {
    expect(
      resolveSpeechText({
        recognizedText: 'Pain',
        englishPhrase: PHRASE_TRANSLATIONS.pain.en,
        phraseTranslations: PHRASE_TRANSLATIONS.pain,
        speechLanguage: 'pa',
      })
    ).toBe(PHRASE_TRANSLATIONS.pain.pa);
  });
});
