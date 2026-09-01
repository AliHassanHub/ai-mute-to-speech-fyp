import { normalizeLanguageCode, languageCodeToName } from './language';

/**
 * Preferred Android/iOS locale tags per app language code.
 * The first entry that matches an installed voice wins.
 */
export const PREFERRED_LOCALE_CANDIDATES = {
  en: ['en-US', 'en-GB', 'en-IN', 'en-AU', 'en'],
  ur: ['ur-PK', 'ur-IN', 'ur'],
  pa: ['pa-IN', 'pa-PK', 'pa'],
};

const VOICE_QUERY_RETRIES = 10;
const VOICE_QUERY_DELAY_MS = 500;

function normalizeLocaleTag(value) {
  return String(value ?? '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase();
}

function localeMatchesLanguage(localeTag, languageCode) {
  const locale = normalizeLocaleTag(localeTag);
  const code = normalizeLanguageCode(languageCode);
  if (!locale || !code) {
    return false;
  }
  if (locale === code) {
    return true;
  }
  return locale.startsWith(`${code}-`);
}

function scoreVoiceMatch(voiceLocale, candidates) {
  const normalized = normalizeLocaleTag(voiceLocale);
  const index = candidates.findIndex(
    (candidate) => normalizeLocaleTag(candidate) === normalized
  );
  if (index >= 0) {
    return index;
  }

  const languageCode = candidates[0]?.split('-')[0];
  if (languageCode && localeMatchesLanguage(normalized, languageCode)) {
    return candidates.length;
  }

  return -1;
}

/**
 * Resolve the best installed voice for a language code.
 * Never maps pa → ur or ur → pa.
 */
export function resolveSpeechLocale(languageCode, voices = []) {
  const code = normalizeLanguageCode(languageCode);
  const candidates = PREFERRED_LOCALE_CANDIDATES[code] ?? [];

  let bestMatch = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const voice of voices) {
    const voiceLocale = voice?.language ?? voice?.locale;
    if (!voiceLocale) {
      continue;
    }

    if (code === 'pa' && localeMatchesLanguage(voiceLocale, 'ur')) {
      continue;
    }
    if (code === 'ur' && localeMatchesLanguage(voiceLocale, 'pa')) {
      continue;
    }

    const score = scoreVoiceMatch(voiceLocale, candidates);
    if (score >= 0 && score < bestScore) {
      bestScore = score;
      bestMatch = {
        available: true,
        languageCode: code,
        languageName: languageCodeToName(code),
        locale: voiceLocale,
        voiceId: voice.identifier ?? voice.id ?? null,
        voice,
      };
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  return {
    available: false,
    languageCode: code,
    languageName: languageCodeToName(code),
    locale: candidates[0] ?? null,
    voiceId: null,
    voice: null,
  };
}

export function buildVoiceUnavailableMessage(languageCode) {
  const name = languageCodeToName(languageCode);
  return `${name} speech is not available on this device. Please install a ${name} voice in Android Settings → System → Languages & input → Text-to-speech output → Install voice data.`;
}

export function filterVoicesForLanguage(voices = [], languageCode) {
  const code = normalizeLanguageCode(languageCode);
  return voices.filter((voice) => {
    const voiceLocale = voice?.language ?? voice?.locale;
    if (!voiceLocale) {
      return false;
    }
    if (code === 'pa' && localeMatchesLanguage(voiceLocale, 'ur')) {
      return false;
    }
    if (code === 'ur' && localeMatchesLanguage(voiceLocale, 'pa')) {
      return false;
    }
    return localeMatchesLanguage(voiceLocale, code);
  });
}

export function diagnoseSpeechVoices(voices = []) {
  return {
    voices: voices.map((voice) => ({
      identifier: voice.identifier ?? voice.id ?? null,
      language: voice.language ?? voice.locale ?? null,
      name: voice.name ?? null,
      quality: voice.quality ?? null,
    })),
    languages: {
      en: resolveSpeechLocale('en', voices),
      ur: resolveSpeechLocale('ur', voices),
      pa: resolveSpeechLocale('pa', voices),
    },
  };
}

export async function loadAvailableVoices(fetchVoices, {
  retries = VOICE_QUERY_RETRIES,
  delayMs = VOICE_QUERY_DELAY_MS,
} = {}) {
  let voices = await fetchVoices();
  if (Array.isArray(voices) && voices.length > 0) {
    return voices;
  }

  for (let attempt = 0; attempt < retries; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    voices = await fetchVoices();
    if (Array.isArray(voices) && voices.length > 0) {
      return voices;
    }
  }

  return Array.isArray(voices) ? voices : [];
}
