import { getApiBaseUrl, getApiBaseUrlSync } from './apiConfig';

export { getApiBaseUrl, getBuiltInServerUrl, setApiBaseUrl, initApiConfig } from './apiConfig';

export function getUploadBaseUrl() {
  return getApiBaseUrlSync().replace(/\/api\/?$/, '');
}

export class ApiError extends Error {
  constructor(message, status = 0, errors = null, code = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
    this.code = code;
  }
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function buildErrorMessage(data, status) {
  if (data?.message) {
    return data.message;
  }
  if (data?.errors?.length) {
    return data.errors.map((e) => e.msg).join(' ');
  }
  return 'Something went wrong. Please try again.';
}

export function resolveUploadUrl(path) {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const uploadBase = getUploadBaseUrl();
  const clean = path.replace(/^\/+/, '');
  if (clean.startsWith('uploads/')) {
    return `${uploadBase}/${clean}`;
  }
  return `${uploadBase}/uploads/${clean}`;
}

export async function request(endpoint, { method = 'GET', body, token, headers = {} } = {}) {
  const apiBaseUrl = await getApiBaseUrl();
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new ApiError(
      `Cannot connect to ${apiBaseUrl.replace(/\/api\/?$/, '')}. Your browser can open this URL, but the app needs an updated build that allows HTTP traffic. Rebuild with: npx eas build --platform android --profile preview`,
      0
    );
  }

  const data = await parseJson(response);

  if (!response.ok) {
    throw new ApiError(
      buildErrorMessage(data, response.status),
      response.status,
      data?.errors,
      data?.code ?? null
    );
  }

  if (data.success === false) {
    throw new ApiError(
      data.message || 'Request failed.',
      response.status,
      data?.errors,
      data?.code ?? null
    );
  }

  return data;
}

export async function uploadRequest(endpoint, formData, token) {
  const apiBaseUrl = await getApiBaseUrl();
  let response;
  try {
    response = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
  } catch (error) {
    const apiBaseUrl = await getApiBaseUrl();
    throw new ApiError(
      `Cannot connect to ${apiBaseUrl.replace(/\/api\/?$/, '')}. Rebuild the app after the latest network fix.`,
      0
    );
  }

  const data = await parseJson(response);

  if (!response.ok || data.success === false) {
    throw new ApiError(buildErrorMessage(data, response.status), response.status, data?.errors);
  }

  return data;
}

export const authApi = {
  signup: (name, email, password, confirmPassword) =>
    request('/auth/signup', { method: 'POST', body: { name, email, password, confirmPassword } }),

  verifyEmail: (email, otp) =>
    request('/auth/verify-email', { method: 'POST', body: { email, otp } }),

  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: { email, password } }),

  forgotPassword: (email) =>
    request('/auth/forgot-password', { method: 'POST', body: { email } }),

  verifyResetOtp: (email, otp) =>
    request('/auth/verify-reset-otp', { method: 'POST', body: { email, otp } }),

  resetPassword: (email, newPassword, confirmPassword) =>
    request('/auth/reset-password', { method: 'PUT', body: { email, newPassword, confirmPassword } }),

  me: (token) => request('/auth/me', { token }),
};

export const profileApi = {
  get: (token) => request('/profile', { token }),

  update: (name, token) =>
    request('/profile', { method: 'PUT', body: { name }, token }),

  uploadImage: (uri, token) => {
    const formData = new FormData();
    const filename = uri.split('/').pop() ?? 'profile.jpg';
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    formData.append('profileImage', { uri, name: filename, type: mimeType });
    return uploadRequest('/profile/image', formData, token);
  },

  changePassword: (currentPassword, newPassword, confirmPassword, token) =>
    request('/profile/change-password', {
      method: 'PUT',
      body: { currentPassword, newPassword, confirmPassword },
      token,
    }),

  updateNotifications: (notificationsEnabled, token) =>
    request('/profile/notifications', {
      method: 'PUT',
      body: { notificationsEnabled },
      token,
    }),

  getNotifications: (token) => request('/profile/notifications', { token }),

  updateNotificationSettings: ({ notificationsEnabled, preferences }, token) =>
    request('/profile/notifications', {
      method: 'PUT',
      body: { notificationsEnabled, preferences },
      token,
    }),

  getLanguage: (token) => request('/profile/language', { token }),

  updateLanguage: (translationLanguage, speechLanguage, token) =>
    request('/profile/language', {
      method: 'PUT',
      body: { translationLanguage, speechLanguage },
      token,
    }),

  deleteAccount: (token) => request('/profile', { method: 'DELETE', token }),

  logout: (token) => request('/profile/logout', { method: 'POST', token }),
};

export const sessionApi = {
  getCurrent: (token) => request('/sessions/current', { token }),

  start: (deviceName, token) =>
    request('/sessions/start', { method: 'POST', body: { deviceName }, token }),

  complete: (sessionId, wordCount, averageConfidence, token) =>
    request(`/sessions/${sessionId}/complete`, {
      method: 'PUT',
      body: { wordCount, averageConfidence },
      token,
    }),
};

export const bluetoothApi = {
  connect: (deviceName, deviceMac, token) =>
    request('/bluetooth/connect', { method: 'POST', body: { deviceName, deviceMac }, token }),

  status: (token) => request('/bluetooth/status', { token }),

  disconnect: (token) => request('/bluetooth/disconnect', { method: 'POST', token }),
};

export const calibrationApi = {
  get: (token) => request('/calibration', { token }),

  save: (baselineValue, thresholdLevel, calibrationData, token) =>
    request('/calibration', {
      method: 'POST',
      body: { baselineValue, thresholdLevel, calibrationData },
      token,
    }),

  status: (token) => request('/calibration/status', { token }),

  getProfile: (token) => request('/calibration/profile', { token }),

  /**
   * Calibrate one word from multiple real hardware captures (Phase 2B).
   */
  calibrateWord: (word, captures, token, idempotencyKey = null) =>
    request('/calibration/word', {
      method: 'POST',
      body: { word, captures, ...(idempotencyKey ? { idempotencyKey } : {}) },
      token,
    }),

  saveNeutral: (captures, token) =>
    request('/calibration/neutral', {
      method: 'POST',
      body: { captures },
      token,
    }),
};

export const inferenceApi = {
  inferRecording: (recordingId, { targetLanguage, minConfidence } = {}, token) =>
    request(`/inference/recordings/${recordingId}/infer`, {
      method: 'POST',
      body: { targetLanguage, minConfidence },
      token,
    }),

  /**
   * Predict a word from a complete sample window.
   *
   * `rows` must be [{ emg, pot, timestamp }]. The backend enforces the 768
   * sample minimum and answers { ready: false, ... } below it, which is a
   * buffering state and not an error. The user identity comes from the token;
   * no userId is sent.
   */
  predictWord: (rows, { minConfidence, sessionId } = {}, token) =>
    request('/inference/word', {
      method: 'POST',
      body: {
        signal: { format: 'samples', rows },
        ...(minConfidence != null ? { minConfidence } : {}),
        ...(sessionId ? { sessionId } : {}),
      },
      token,
    }),

  persistWord: (
    rows,
    { minConfidence, targetLanguage, durationMs, signalLabel, textId, deviceName } = {},
    token
  ) =>
    request('/inference/word/persist', {
      method: 'POST',
      body: {
        signal: { format: 'samples', rows },
        ...(minConfidence != null ? { minConfidence } : {}),
        ...(targetLanguage ? { targetLanguage } : {}),
        ...(durationMs != null ? { durationMs } : {}),
        ...(signalLabel ? { signalLabel } : {}),
        ...(textId != null ? { textId } : {}),
        ...(deviceName ? { deviceName } : {}),
      },
      token,
    }),

  /** AI service availability, without exposing Python internals. */
  aiHealth: (token) => request('/inference/health', { token }),

  /** Optional session adaptation. Not required for the verified path. */
  createAiSession: (rows, token) =>
    request('/inference/sessions', {
      method: 'POST',
      body: { signal: { format: 'samples', rows } },
      token,
    }),

  getAiSession: (token) => request('/inference/sessions/current', { token }),

  clearAiSession: (token) =>
    request('/inference/sessions/current', { method: 'DELETE', token }),
};

export const recordingApi = {
  save: (payload, token) => request('/recordings', { method: 'POST', body: payload, token }),
};

export const historyApi = {
  list: (page = 1, limit = 20, token) =>
    request(`/history?page=${page}&limit=${limit}`, { token }),

  delete: (textId, token) => request(`/history/${textId}`, { method: 'DELETE', token }),
};
