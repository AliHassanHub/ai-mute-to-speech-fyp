/**
 * Speech locale resolution tests.
 */

import {
  resolveSpeechLocale,
  diagnoseSpeechVoices,
  buildVoiceUnavailableMessage,
  PREFERRED_LOCALE_CANDIDATES,
} from '../utils/speechLocale';

const SAMPLE_VOICES = [
  { identifier: 'en-us', language: 'en-US', name: 'English US' },
  { identifier: 'en-gb', language: 'en-GB', name: 'English UK' },
  { identifier: 'ur-pk', language: 'ur-PK', name: 'Urdu Pakistan' },
  { identifier: 'pa-in', language: 'pa-IN', name: 'Punjabi India' },
];

describe('speechLocale', () => {
  it('maps English to an installed English locale', () => {
    const result = resolveSpeechLocale('en', SAMPLE_VOICES);
    expect(result.available).toBe(true);
    expect(result.locale).toBe('en-US');
    expect(result.languageCode).toBe('en');
  });

  it('maps Urdu to ur-PK when available', () => {
    const result = resolveSpeechLocale('ur', SAMPLE_VOICES);
    expect(result.available).toBe(true);
    expect(result.locale).toBe('ur-PK');
    expect(result.voiceId).toBe('ur-pk');
  });

  it('maps Punjabi to pa-IN when available', () => {
    const result = resolveSpeechLocale('pa', SAMPLE_VOICES);
    expect(result.available).toBe(true);
    expect(result.locale).toBe('pa-IN');
    expect(result.voiceId).toBe('pa-in');
  });

  it('never maps Punjabi to an Urdu voice', () => {
    const voices = [
      { identifier: 'ur-pk', language: 'ur-PK', name: 'Urdu Pakistan' },
      { identifier: 'en-us', language: 'en-US', name: 'English US' },
    ];

    const result = resolveSpeechLocale('pa', voices);
    expect(result.available).toBe(false);
    expect(result.locale).toBe(PREFERRED_LOCALE_CANDIDATES.pa[0]);
  });

  it('never maps Urdu to a Punjabi voice', () => {
    const voices = [
      { identifier: 'pa-in', language: 'pa-IN', name: 'Punjabi India' },
      { identifier: 'en-us', language: 'en-US', name: 'English US' },
    ];

    const result = resolveSpeechLocale('ur', voices);
    expect(result.available).toBe(false);
  });

  it('normalizes language aliases', () => {
    const result = resolveSpeechLocale('Punjabi', SAMPLE_VOICES);
    expect(result.available).toBe(true);
    expect(result.languageCode).toBe('pa');
  });

  it('builds a device voice install message', () => {
    expect(buildVoiceUnavailableMessage('pa')).toMatch(/Punjabi speech is not available/i);
  });

  it('diagnoses all supported languages', () => {
    const diagnostic = diagnoseSpeechVoices(SAMPLE_VOICES);
    expect(diagnostic.voices).toHaveLength(4);
    expect(diagnostic.languages.en.available).toBe(true);
    expect(diagnostic.languages.ur.available).toBe(true);
    expect(diagnostic.languages.pa.available).toBe(true);
  });
});
