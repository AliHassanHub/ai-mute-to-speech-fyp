import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const STORAGE_KEY = 'api_base_url';

function getBuiltInApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }
  const fromExtra = Constants.expoConfig?.extra?.apiUrl;
  if (fromExtra) {
    return fromExtra;
  }
  return 'http://localhost:5000/api';
}

let cachedUrl = null;

export function normalizeApiUrl(input) {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new Error('Server URL is required.');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('Server URL must start with http:// or https://');
  }
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

export function getBuiltInServerUrl() {
  return getBuiltInApiUrl();
}

export function getApiBaseUrlSync() {
  return cachedUrl || getBuiltInApiUrl();
}

export async function initApiConfig() {
  if (cachedUrl) {
    return cachedUrl;
  }
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    cachedUrl = stored ? normalizeApiUrl(stored) : getBuiltInApiUrl();
  } catch {
    cachedUrl = getBuiltInApiUrl();
  }
  return cachedUrl;
}

export async function getApiBaseUrl() {
  if (!cachedUrl) {
    await initApiConfig();
  }
  return cachedUrl;
}

export async function setApiBaseUrl(input) {
  const normalized = normalizeApiUrl(input);
  cachedUrl = normalized;
  await SecureStore.setItemAsync(STORAGE_KEY, normalized);
  return normalized;
}

export function getServerHostLabel() {
  const url = getApiBaseUrlSync();
  return url.replace(/\/api\/?$/, '');
}
