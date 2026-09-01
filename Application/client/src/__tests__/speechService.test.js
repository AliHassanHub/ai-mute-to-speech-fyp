/**
 * Native speech service tests (expo-speech mocked).
 */

jest.mock('expo-speech', () => {
  const speak = jest.fn();
  const stop = jest.fn(() => Promise.resolve());
  const getAvailableVoicesAsync = jest.fn();

  return {
    speak,
    stop,
    getAvailableVoicesAsync,
    __mock: {
      speak,
      stop,
      getAvailableVoicesAsync,
    },
  };
});

import * as Speech from 'expo-speech';
import { PHRASE_TRANSLATIONS } from '../constants/phraseTranslations';
import { PUNJABI_TTS_PHRASES } from '../constants/punjabiTtsPhrases';
import {
  speakResult,
  stopSpeech,
  isSpeaking,
  getAvailableVoices,
  getSpeechVoiceDiagnostic,
  getSpeechUiState,
  resetSpeechServiceForTests,
  SpeechServiceError,
  SPEECH_UI_STATE,
} from '../services/speechService';

const { speak, stop, getAvailableVoicesAsync } = Speech.__mock;
const PAIN_PHRASES = PHRASE_TRANSLATIONS.pain;

const SAMPLE_VOICES = [
  { identifier: 'en-us', language: 'en-US', name: 'English US' },
  { identifier: 'ur-pk', language: 'ur-PK', name: 'Urdu Pakistan' },
  { identifier: 'pa-in', language: 'pa-IN', name: 'Punjabi India' },
];

function mockSpeakSuccess() {
  speak.mockImplementation((text, options) => {
    options?.onStart?.();
    options?.onDone?.();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetSpeechServiceForTests();
  getAvailableVoicesAsync.mockResolvedValue(SAMPLE_VOICES);
  mockSpeakSuccess();
});

describe('speechService', () => {
  it('speaks English phrase with an English locale', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'en',
    });

    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][0]).toBe(PAIN_PHRASES.en);
    expect(speak.mock.calls[0][1].language).toBe('en-US');
  });

  it('speaks Urdu phrase with an Urdu locale', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'ur',
    });

    expect(speak.mock.calls[0][0]).toBe(PAIN_PHRASES.ur);
    expect(speak.mock.calls[0][1].language).toBe('ur-PK');
  });

  it('speaks Punjabi phrase with a Punjabi locale using Gurmukhi engine text', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'pa',
    });

    expect(speak.mock.calls[0][0]).toBe(PUNJABI_TTS_PHRASES.pain);
    expect(speak.mock.calls[0][0]).not.toBe(PAIN_PHRASES.pa);
    expect(speak.mock.calls[0][1].language).toBe('pa-IN');
    expect(speak.mock.calls[0][1].language).not.toBe('ur-PK');
  });

  it('speaks Gurmukhi Punjabi when translation is Urdu and speech is Punjabi', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'pa',
    });

    expect(speak.mock.calls[0][0]).toBe(PUNJABI_TTS_PHRASES.pain);
    expect(speak.mock.calls[0][0]).not.toBe(PAIN_PHRASES.ur);
    expect(speak.mock.calls[0][1].language).toBe('pa-IN');
  });

  it('speaks Urdu when translation is Punjabi and speech is Urdu', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'ur',
    });

    expect(speak.mock.calls[0][0]).toBe(PAIN_PHRASES.ur);
    expect(speak.mock.calls[0][0]).not.toBe(PAIN_PHRASES.pa);
    expect(speak.mock.calls[0][1].language).toBe('ur-PK');
  });

  it('rejects empty speech text', async () => {
    await expect(
      speakResult({
        recognizedText: '   ',
        speechLanguage: 'en',
      })
    ).rejects.toMatchObject({ code: 'SPEECH_TEXT_UNAVAILABLE' });
  });

  it('rejects Punjabi speech when no Punjabi voice is installed', async () => {
    getAvailableVoicesAsync.mockResolvedValue([
      { identifier: 'ur-pk', language: 'ur-PK', name: 'Urdu Pakistan' },
      { identifier: 'en-us', language: 'en-US', name: 'English US' },
    ]);
    resetSpeechServiceForTests();

    await expect(
      speakResult({
        recognizedText: 'Pain',
        englishPhrase: PAIN_PHRASES.en,
        phraseTranslations: PAIN_PHRASES,
        speechLanguage: 'pa',
      })
    ).rejects.toMatchObject({ code: 'SPEECH_VOICE_UNAVAILABLE' });

    expect(speak).not.toHaveBeenCalled();
  });

  it('stops active speech', async () => {
    speak.mockImplementation(() => {});

    speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'en',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await stopSpeech();

    expect(stop).toHaveBeenCalled();
    expect(isSpeaking()).toBe(false);
  });

  it('prevents duplicate simultaneous speech by replacing the active utterance', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'en',
    });

    await speakResult({
      recognizedText: 'Help',
      englishPhrase: PHRASE_TRANSLATIONS.help.en,
      phraseTranslations: PHRASE_TRANSLATIONS.help,
      speechLanguage: 'en',
    });

    expect(stop).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak.mock.calls[1][0]).toBe(PHRASE_TRANSLATIONS.help.en);
  });

  it('supports replay after completion', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'en',
    });

    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'en',
    });

    expect(speak).toHaveBeenCalledTimes(2);
  });

  it('exposes installed voice diagnostics', async () => {
    const diagnostic = await getSpeechVoiceDiagnostic();
    expect(diagnostic.languages.en.available).toBe(true);
    expect(diagnostic.languages.ur.available).toBe(true);
    expect(diagnostic.languages.pa.available).toBe(true);
    await expect(getAvailableVoices()).resolves.toEqual(SAMPLE_VOICES);
  });

  it('maps speech engine failures to a speech service error', async () => {
    speak.mockImplementation((text, options) => {
      options?.onError?.({ message: 'TTS engine unavailable' });
    });

    await expect(
      speakResult({
        recognizedText: 'Pain',
        englishPhrase: PAIN_PHRASES.en,
        phraseTranslations: PAIN_PHRASES,
        speechLanguage: 'en',
      })
    ).rejects.toBeInstanceOf(SpeechServiceError);
  });

  it('starts in idle state', () => {
    expect(getSpeechUiState()).toBe(SPEECH_UI_STATE.IDLE);
  });

  it('reports starting then speaking through onStateChange', async () => {
    const states = [];
    speak.mockImplementation((text, options) => {
      options?.onStart?.();
      options?.onDone?.();
    });

    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'en',
      onStateChange: (state) => states.push(state),
    });

    expect(states).toEqual([
      SPEECH_UI_STATE.STARTING,
      SPEECH_UI_STATE.SPEAKING,
      SPEECH_UI_STATE.IDLE,
    ]);
    expect(getSpeechUiState()).toBe(SPEECH_UI_STATE.IDLE);
  });

  it('treats onDone without onStart as successful playback', async () => {
    speak.mockImplementation((text, options) => {
      options?.onDone?.();
    });

    await expect(
      speakResult({
        recognizedText: 'Pain',
        englishPhrase: PAIN_PHRASES.en,
        phraseTranslations: PAIN_PHRASES,
        speechLanguage: 'pa',
      })
    ).resolves.toMatchObject({ startedWithoutCallback: true });

    expect(speak.mock.calls[0][1].language).toBe('pa-IN');
  });

  it('allows delayed onStart during startup', async () => {
    jest.useFakeTimers();
    speak.mockImplementation((text, options) => {
      setTimeout(() => {
        options?.onStart?.();
        options?.onDone?.();
      }, 1500);
    });

    const promise = speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'pa',
    });

    await jest.advanceTimersByTimeAsync(1500);
    await expect(promise).resolves.toMatchObject({ stopped: false });
    jest.useRealTimers();
  });

  it('does not fail before the conservative startup timeout expires', async () => {
    jest.useFakeTimers();
    speak.mockImplementation(() => {});

    const promise = speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'pa',
    });

    await jest.advanceTimersByTimeAsync(2500);
    await expect(Promise.race([promise, Promise.resolve('pending')])).resolves.toBe('pending');

    speak.mock.calls[0][1].onStart?.();
    speak.mock.calls[0][1].onDone?.();
    await expect(promise).resolves.toMatchObject({ stopped: false });
    jest.useRealTimers();
  });

  it('fails only after the conservative startup timeout with no callbacks', async () => {
    jest.useFakeTimers();
    speak.mockImplementation(() => {});

    const promise = speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'pa',
    });
    const expectation = expect(promise).rejects.toMatchObject({
      code: 'SPEECH_START_TIMEOUT',
    });

    await jest.advanceTimersByTimeAsync(12000);
    await expectation;
    jest.useRealTimers();
  });

  it('ignores stale callbacks from a replaced utterance', async () => {
    const states = [];
    let firstCallbacks = null;

    speak.mockImplementation((text, options) => {
      if (!firstCallbacks) {
        firstCallbacks = options;
        return;
      }
      options?.onStart?.();
      options?.onDone?.();
    });

    const first = speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'en',
      onStateChange: (state) => states.push(`first:${state}`),
    });

    while (!firstCallbacks) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    await speakResult({
      recognizedText: 'Help',
      englishPhrase: PHRASE_TRANSLATIONS.help.en,
      phraseTranslations: PHRASE_TRANSLATIONS.help,
      speechLanguage: 'en',
      onStateChange: (state) => states.push(`second:${state}`),
    });

    firstCallbacks.onError?.({ message: 'stale failure' });
    await expect(first).resolves.toMatchObject({ superseded: true });
    expect(states.filter((entry) => entry.includes('stale'))).toHaveLength(0);
  });

  it('supports stop without surfacing an error', async () => {
    speak.mockImplementation((text, options) => {
      options?.onStart?.();
    });

    const promise = speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'ur',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    speak.mock.calls[0][1].onStopped?.();
    await expect(promise).resolves.toMatchObject({ stopped: true });
    expect(getSpeechUiState()).toBe(SPEECH_UI_STATE.IDLE);
  });

  it('speaks English on first press path', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'English',
    });

    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak.mock.calls[0][1].language).toBe('en-US');
  });

  it('speaks Urdu on first press path', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'Urdu',
    });

    expect(speak.mock.calls[0][1].language).toBe('ur-PK');
  });

  it('speaks Punjabi on first press path without false timeout errors', async () => {
    speak.mockImplementation((text, options) => {
      setTimeout(() => options?.onDone?.(), 800);
    });

    await expect(
      speakResult({
        recognizedText: 'Pain',
        englishPhrase: PAIN_PHRASES.en,
        phraseTranslations: PAIN_PHRASES,
        speechLanguage: 'Punjabi',
      })
    ).resolves.toMatchObject({ startedWithoutCallback: true });

    expect(speak.mock.calls[0][0]).toBe(PUNJABI_TTS_PHRASES.pain);
    expect(speak.mock.calls[0][1].language).toBe('pa-IN');
  });

  it('keeps mixed translation and speech language independent', async () => {
    await speakResult({
      recognizedText: 'Pain',
      englishPhrase: PAIN_PHRASES.en,
      phraseTranslations: PAIN_PHRASES,
      speechLanguage: 'pa',
    });

    expect(speak.mock.calls[0][0]).toBe(PUNJABI_TTS_PHRASES.pain);
    expect(speak.mock.calls[0][0]).not.toBe(PAIN_PHRASES.ur);
  });
});
