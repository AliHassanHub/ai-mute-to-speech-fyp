import { getPunjabiTtsPhraseForWord } from '../constants/punjabiTtsPhrases';

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const GURMUKHI_SCRIPT_RE = /[\u0A00-\u0A7F]/;

export const PUNJABI_SCRIPT_INCOMPATIBLE_MESSAGE =
  'Punjabi speech is not available for the current phrase script on this device. The app displays Shahmukhi Punjabi, but installed Punjabi voices require Gurmukhi speech data.';

/**
 * True when text uses Arabic-derived Shahmukhi / Nastaliq characters.
 */
export function isShahmukhiText(text) {
  return ARABIC_SCRIPT_RE.test(String(text ?? ''));
}

/**
 * True when text uses Gurmukhi script.
 */
export function isGurmukhiText(text) {
  return GURMUKHI_SCRIPT_RE.test(String(text ?? ''));
}

/**
 * Android/Google pa-IN voices are Gurmukhi-based.
 */
export function isGurmukhiPunjabiLocale(locale) {
  const normalized = String(locale ?? '')
    .trim()
    .replace(/_/g, '-')
    .toLowerCase();
  if (!normalized.startsWith('pa')) {
    return false;
  }
  // pa-PK may still be Shahmukhi-oriented on some engines, but pa-IN is Gurmukhi.
  return normalized === 'pa' || normalized === 'pa-in' || normalized.startsWith('pa-in-');
}

/**
 * Resolve the exact text that should be sent to the native TTS engine for Punjabi.
 * Display text remains Shahmukhi; this is speech-only.
 */
export function resolvePunjabiEngineText({ recognizedText, displayPhrase, locale }) {
  const phrase = String(displayPhrase ?? '').trim();
  if (!phrase) {
    return null;
  }

  if (isGurmukhiText(phrase)) {
    return phrase;
  }

  const gurmukhiPhrase = getPunjabiTtsPhraseForWord(recognizedText);
  if (gurmukhiPhrase && isGurmukhiPunjabiLocale(locale)) {
    return gurmukhiPhrase;
  }

  if (isGurmukhiPunjabiLocale(locale)) {
    return null;
  }

  return phrase;
}

export function buildPunjabiScriptIncompatibleMessage() {
  return PUNJABI_SCRIPT_INCOMPATIBLE_MESSAGE;
}
