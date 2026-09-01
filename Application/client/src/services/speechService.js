import * as Speech from 'expo-speech';
import {
  resolveSpeechText,
  normalizeLanguageCode,
  languageCodeToName,
  SPEECH_TEXT_UNAVAILABLE,
} from '../utils/language';
import {
  resolveSpeechLocale,
  buildVoiceUnavailableMessage,
  diagnoseSpeechVoices,
  loadAvailableVoices,
  filterVoicesForLanguage,
} from '../utils/speechLocale';
import {
  resolvePunjabiEngineText,
  buildPunjabiScriptIncompatibleMessage,
} from '../utils/punjabiSpeech';

export class SpeechServiceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SpeechServiceError';
    this.code = code;
  }
}

export const SPEECH_UI_STATE = {
  IDLE: 'idle',
  STARTING: 'starting',
  SPEAKING: 'speaking',
  STOPPING: 'stopping',
};

const SPEECH_START_TIMEOUT_MS = 12000;

let speaking = false;
let speechUiState = SPEECH_UI_STATE.IDLE;
let activeUtteranceId = 0;
let cancelActiveUtterance = null;
let cachedVoices = null;
let voicesPromise = null;

function setSpeechUiState(nextState, utteranceId, expectedUtteranceId) {
  if (expectedUtteranceId != null && utteranceId !== expectedUtteranceId) {
    return;
  }
  speechUiState = nextState;
}

export function getSpeechUiState() {
  return speechUiState;
}

async function fetchVoicesFromDevice() {
  if (!Speech.getAvailableVoicesAsync) {
    return [];
  }
  return Speech.getAvailableVoicesAsync();
}

export async function getAvailableVoices({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedVoices) {
    return cachedVoices;
  }

  if (!forceRefresh && voicesPromise) {
    return voicesPromise;
  }

  voicesPromise = loadAvailableVoices(fetchVoicesFromDevice)
    .then((voices) => {
      cachedVoices = voices;
      voicesPromise = null;
      return voices;
    })
    .catch((error) => {
      voicesPromise = null;
      throw error;
    });

  return voicesPromise;
}

export async function getSpeechVoiceDiagnostic({ forceRefresh = false } = {}) {
  const voices = await getAvailableVoices({ forceRefresh });
  return diagnoseSpeechVoices(voices);
}

export function isSpeaking() {
  return speaking;
}

export async function stopSpeech() {
  speechUiState = SPEECH_UI_STATE.STOPPING;
  const cancel = cancelActiveUtterance;
  cancelActiveUtterance = null;
  speaking = false;
  cancel?.();
  activeUtteranceId += 1;
  if (Speech.stop) {
    await Speech.stop();
  }
  speechUiState = SPEECH_UI_STATE.IDLE;
}

function ensureSpeechText(text) {
  const value = String(text ?? '').trim();
  if (!value) {
    throw new SpeechServiceError('Nothing to speak.', 'SPEECH_EMPTY_TEXT');
  }
  return value;
}

async function resolveVoiceForSpeech(speechLanguage) {
  const speechCode = normalizeLanguageCode(speechLanguage);
  const voices = await getAvailableVoices();
  const resolution = resolveSpeechLocale(speechCode, voices);

  if (!resolution.available) {
    throw new SpeechServiceError(
      buildVoiceUnavailableMessage(speechCode),
      'SPEECH_VOICE_UNAVAILABLE'
    );
  }

  return resolution;
}

function prepareEngineSpeechText({
  speechCode,
  recognizedText,
  phraseText,
  voice,
}) {
  if (speechCode !== 'pa') {
    return phraseText;
  }

  const engineText = resolvePunjabiEngineText({
    recognizedText,
    displayPhrase: phraseText,
    locale: voice.locale,
  });

  if (!engineText) {
    throw new SpeechServiceError(
      buildPunjabiScriptIncompatibleMessage(),
      'SPEECH_SCRIPT_INCOMPATIBLE'
    );
  }

  return engineText;
}

function speakWithNativeEngine(text, options) {
  return new Promise((resolve, reject) => {
    const utteranceId = activeUtteranceId + 1;
    activeUtteranceId = utteranceId;
    let hasCompleted = false;
    let hasStarted = false;
    let startTimer = null;

    const clearStartTimer = () => {
      if (startTimer != null) {
        clearTimeout(startTimer);
        startTimer = null;
      }
    };

    const isStale = () => utteranceId !== activeUtteranceId || hasCompleted;

    const finish = (result) => {
      if (isStale()) {
        return;
      }
      hasCompleted = true;
      clearStartTimer();
      speaking = false;
      if (cancelActiveUtterance && utteranceId === activeUtteranceId) {
        cancelActiveUtterance = null;
      }
      setSpeechUiState(SPEECH_UI_STATE.IDLE, utteranceId, utteranceId);
      options.onStateChange?.(SPEECH_UI_STATE.IDLE);
      resolve(result);
    };

    const fail = (error) => {
      if (isStale()) {
        return;
      }
      hasCompleted = true;
      clearStartTimer();
      speaking = false;
      if (cancelActiveUtterance && utteranceId === activeUtteranceId) {
        cancelActiveUtterance = null;
      }
      setSpeechUiState(SPEECH_UI_STATE.IDLE, utteranceId, utteranceId);
      options.onStateChange?.(SPEECH_UI_STATE.IDLE);
      reject(error);
    };

    speaking = true;
    setSpeechUiState(SPEECH_UI_STATE.STARTING, utteranceId, utteranceId);
    options.onStateChange?.(SPEECH_UI_STATE.STARTING);

    cancelActiveUtterance = () => {
      if (hasCompleted) {
        return;
      }
      hasCompleted = true;
      clearStartTimer();
      speaking = false;
      setSpeechUiState(SPEECH_UI_STATE.IDLE, utteranceId, utteranceId);
      options.onStateChange?.(SPEECH_UI_STATE.IDLE);
      resolve({
        stopped: true,
        superseded: true,
      });
    };

    startTimer = setTimeout(() => {
      if (isStale() || hasStarted || hasCompleted) {
        return;
      }
      fail(
        new SpeechServiceError(
          'Speech could not be started. Please try again.',
          'SPEECH_START_TIMEOUT'
        )
      );
    }, SPEECH_START_TIMEOUT_MS);
    startTimer.unref?.();

    Speech.speak(text, {
      language: options.locale,
      voice: options.voiceId ?? undefined,
      pitch: 1,
      rate: 0.95,
      onStart: () => {
        if (isStale()) {
          return;
        }
        hasStarted = true;
        clearStartTimer();
        setSpeechUiState(SPEECH_UI_STATE.SPEAKING, utteranceId, utteranceId);
        options.onStateChange?.(SPEECH_UI_STATE.SPEAKING);
      },
      onDone: () => {
        if (isStale()) {
          return;
        }
        clearStartTimer();
        finish({
          stopped: false,
          startedWithoutCallback: !hasStarted,
        });
      },
      onStopped: () => {
        finish({
          stopped: true,
        });
      },
      onError: (event) => {
        const languageName = languageCodeToName(options.languageCode);
        fail(
          new SpeechServiceError(
            event?.message ||
              `${languageName} speech failed on this device. Please check Android Text-to-Speech settings.`,
            'SPEECH_ENGINE_ERROR'
          )
        );
      },
    });
  });
}

/**
 * Speak the prepared result text using the user's speech output language.
 */
export async function speakResult({
  recognizedText,
  englishPhrase,
  phraseTranslations,
  speechLanguage,
  targetLanguage,
  onStateChange,
}) {
  await stopSpeech();

  const speechCode = normalizeLanguageCode(speechLanguage ?? targetLanguage);
  const resolvedText = resolveSpeechText({
    recognizedText,
    englishPhrase,
    phraseTranslations,
    speechLanguage: speechCode,
  });

  if (!String(resolvedText ?? '').trim()) {
    throw new SpeechServiceError(SPEECH_TEXT_UNAVAILABLE, 'SPEECH_TEXT_UNAVAILABLE');
  }

  const voice = await resolveVoiceForSpeech(speechCode);
  const speechText = ensureSpeechText(
    prepareEngineSpeechText({
      speechCode,
      recognizedText,
      phraseText: resolvedText,
      voice,
    })
  );

  speaking = true;

  try {
    return await speakWithNativeEngine(speechText, {
      locale: voice.locale,
      voiceId: voice.voiceId,
      languageCode: speechCode,
      requestedDisplayText: resolvedText,
      engineText: speechText,
      onStateChange,
    });
  } catch (error) {
    speaking = false;
    speechUiState = SPEECH_UI_STATE.IDLE;
    onStateChange?.(SPEECH_UI_STATE.IDLE);
    if (error instanceof SpeechServiceError) {
      throw error;
    }
    throw new SpeechServiceError(
      buildVoiceUnavailableMessage(speechCode),
      'SPEECH_VOICE_UNAVAILABLE'
    );
  }
}

/**
 * Diagnostic helper for comparing English/Urdu/Punjabi voice resolution on device.
 */
export async function runSpeechDiagnostic({
  recognizedText = 'Pain',
  phraseTranslations,
} = {}) {
  const voices = await getAvailableVoices({ forceRefresh: true });
  const languages = ['en', 'ur', 'pa'];
  const results = {};

  for (const code of languages) {
    const voice = resolveSpeechLocale(code, voices);
    const phraseText = resolveSpeechText({
      recognizedText,
      englishPhrase: phraseTranslations?.en,
      phraseTranslations,
      speechLanguage: code,
    });
    let engineText = phraseText;
    let engineError = null;

    if (code === 'pa') {
      try {
        engineText = resolvePunjabiEngineText({
          recognizedText,
          displayPhrase: phraseText,
          locale: voice.locale,
        });
      } catch (error) {
        engineError = error?.message ?? String(error);
      }
      if (!engineText && !engineError) {
        engineError = buildPunjabiScriptIncompatibleMessage();
      }
    }

    results[code] = {
      phraseText,
      engineText,
      voiceAvailable: voice.available,
      locale: voice.locale,
      voiceId: voice.voiceId,
      matchingVoices: filterVoicesForLanguage(voices, code).map((entry) => ({
        identifier: entry.identifier ?? entry.id ?? null,
        language: entry.language ?? entry.locale ?? null,
        name: entry.name ?? null,
      })),
      engineError,
    };
  }

  return {
    voiceCount: voices.length,
    voices: voices.map((voice) => ({
      identifier: voice.identifier ?? voice.id ?? null,
      language: voice.language ?? voice.locale ?? null,
      name: voice.name ?? null,
    })),
    languages: results,
  };
}

/** Backward-compatible alias used by ResultScreen and HistoryScreen. */
export async function playResultSpeech(params) {
  return speakResult(params);
}

export function resetSpeechServiceForTests() {
  speaking = false;
  speechUiState = SPEECH_UI_STATE.IDLE;
  activeUtteranceId = 0;
  cancelActiveUtterance = null;
  cachedVoices = null;
  voicesPromise = null;
}
