export const NOTIFICATION_TYPES = {
  DEVICE_CONNECTED: 'deviceConnected',
  DEVICE_DISCONNECTED: 'deviceDisconnected',
  CALIBRATION_COMPLETE: 'calibrationComplete',
  CALIBRATION_REQUIRED: 'calibrationRequired',
  PREDICTION_RESULT: 'predictionResult',
};

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  deviceConnected: true,
  deviceDisconnected: true,
  calibrationComplete: true,
  calibrationRequired: true,
  predictionResult: true,
};

export const NOTIFICATION_PREFERENCE_KEYS = Object.keys(
  DEFAULT_NOTIFICATION_PREFERENCES
);

export const NOTIFICATION_UI_LABELS = {
  deviceConnected: 'Device Connected',
  deviceDisconnected: 'Device Disconnected',
  calibrationComplete: 'Calibration Complete',
  calibrationRequired: 'Calibration Required',
  predictionResult: 'Prediction Result',
};

export function parseNotificationPreferences(raw) {
  let parsed = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  const result = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    if (typeof parsed[key] === 'boolean') {
      result[key] = parsed[key];
    }
  }

  return result;
}

export function buildNotificationState(user) {
  return {
    notificationsEnabled: Boolean(user?.notifications_enabled ?? true),
    preferences: parseNotificationPreferences(user?.notification_preferences),
  };
}

export function shouldNotify(type, state) {
  if (!state?.notificationsEnabled) {
    return false;
  }

  const preferences = parseNotificationPreferences(state?.preferences);
  return Boolean(preferences[type]);
}

export function formatDisplayWord(word) {
  const value = String(word || '').trim();
  if (!value) {
    return '';
  }

  return value.replace(/^\w/, (character) => character.toUpperCase());
}

export function resolveDeviceLabel(deviceName) {
  const label = String(deviceName || '').trim();
  return label || 'ESP32';
}
