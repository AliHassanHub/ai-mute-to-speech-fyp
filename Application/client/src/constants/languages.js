export const SOURCE_LANGUAGE = 'English';
export const SOURCE_LANGUAGE_CODE = 'en';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ur', name: 'Urdu' },
  { code: 'pa', name: 'Punjabi' },
];

export const TARGET_LANGUAGES = SUPPORTED_LANGUAGES.map((entry) => entry.name);

export const LANGUAGE_ALIASES = {
  en: 'English',
  english: 'English',
  ur: 'Urdu',
  urdu: 'Urdu',
  pa: 'Punjabi',
  punjabi: 'Punjabi',
};

export const LANGUAGE_CODES = {
  English: 'en',
  Urdu: 'ur',
  Punjabi: 'pa',
};

export function getSupportedLanguages() {
  return SUPPORTED_LANGUAGES.map((entry) => ({ ...entry }));
}
