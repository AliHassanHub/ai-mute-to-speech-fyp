import { buildPhraseBundleForWord } from '../services/phraseService';
import { normalizeTargetLanguage } from './language';

/**
 * Attach phrase presentation fields to a session/result object.
 */
export function enrichResultWithPhrases(result = {}, translationLanguage) {
  const resolvedTranslationLanguage =
    translationLanguage ??
    result.translationLanguage ??
    result.targetLanguage ??
    'English';

  const bundle = buildPhraseBundleForWord(
    result.recognizedText,
    resolvedTranslationLanguage
  );

  return {
    ...result,
    englishPhrase: bundle.englishPhrase,
    translatedPhrase: bundle.translatedPhrase,
    phraseTranslations: bundle.phraseTranslations,
    phraseAvailable: bundle.available,
    translationLanguage: normalizeTargetLanguage(resolvedTranslationLanguage),
    translatedText: bundle.translatedPhrase,
  };
}

/**
 * Build phrase fields for history items without overwriting legacy translated text.
 */
export function enrichHistoryItemWithPhrases(item = {}) {
  const bundle = buildPhraseBundleForWord(item.recognizedText, item.targetLanguage);
  const storedText = String(item.translatedText ?? '').trim();
  const looksLikePhrase =
    storedText.includes('.') ||
    storedText.includes('۔') ||
    storedText.includes('?') ||
    storedText.length > 24;

  return {
    ...item,
    englishPhrase: bundle.available ? bundle.englishPhrase : null,
    translatedPhrase:
      storedText && (looksLikePhrase || !bundle.available)
        ? storedText
        : bundle.translatedPhrase,
    phraseTranslations: bundle.phraseTranslations ?? null,
    phraseAvailable: bundle.available,
  };
}
