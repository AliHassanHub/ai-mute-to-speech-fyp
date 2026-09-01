/**
 * Gurmukhi Punjabi phrases used ONLY for native Android/iOS TTS output.
 *
 * Display, translation, and database persistence continue to use Shahmukhi
 * phrases from phraseTranslations.js. This file exists because standard
 * pa-IN device voices speak Gurmukhi script, not Shahmukhi.
 */

import { normalizeVocabularyKey } from '../constants/phraseTranslations';

export const PUNJABI_TTS_PHRASES = {
  help: 'ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ।',
  no: 'ਨਹੀਂ, ਕਿਰਪਾ ਕਰਕੇ।',
  pain: 'ਮੈਨੂੰ ਦਰਦ ਹੋ ਰਿਹਾ ਹੈ।',
  stop: 'ਕਿਰਪਾ ਕਰਕੇ ਰੁਕੋ।',
  assistance: 'ਮੈਨੂੰ ਸਹਾਇਤਾ ਚਾਹੀਦੀ ਹੈ।',
  medical: 'ਮੈਨੂੰ ਡਾਕਟਰੀ ਮਦਦ ਚਾਹੀਦੀ ਹੈ।',
  pick: 'ਕਿਰਪਾ ਕਰਕੇ ਇਹ ਚੁੱਕੋ।',
  land: 'ਕਿਰਪਾ ਕਰਕੇ ਮੈਨੂੰ ਸੁਰੱਖਿਅਤ ਢੰਗ ਨਾਲ ਉਤਾਰਨ ਵਿੱਚ ਮਦਦ ਕਰੋ।',
  up: 'ਕਿਰਪਾ ਕਰਕੇ ਮੈਨੂੰ ਉੱਪਰ ਲੈ ਜਾਓ।',
};

export function getPunjabiTtsPhraseForWord(word) {
  const key = normalizeVocabularyKey(word);
  if (!key) {
    return null;
  }
  return PUNJABI_TTS_PHRASES[key] ?? null;
}
