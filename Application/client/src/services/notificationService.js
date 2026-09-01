import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPES,
  buildNotificationState,
  formatDisplayWord,
  resolveDeviceLabel,
  shouldNotify,
} from '../constants/notifications';

const DEDUPE_TTL_MS = 15000;
const TOAST_ONLY_TYPES = new Set([NOTIFICATION_TYPES.CALIBRATION_REQUIRED]);

export const ANDROID_NOTIFICATION_CHANNEL_ID = 'ai-mute-to-speech';
export const ANDROID_NOTIFICATION_CHANNEL_NAME = 'AI Mute-to-Speech';

let cachedState = {
  notificationsEnabled: true,
  preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
};
let permissionStatus = 'undetermined';
let configured = false;
let toastHandler = null;

const recentEvents = new Map();
const calibrationRequiredNotified = new Set();

function pruneRecentEvents(now = Date.now()) {
  for (const [key, timestamp] of recentEvents.entries()) {
    if (now - timestamp > DEDUPE_TTL_MS) {
      recentEvents.delete(key);
    }
  }
}

function hasRecentEvent(eventKey) {
  pruneRecentEvents();
  return recentEvents.has(eventKey);
}

function markRecentEvent(eventKey) {
  pruneRecentEvents();
  recentEvents.set(eventKey, Date.now());
}

export function setNotificationToastHandler(handler) {
  toastHandler = typeof handler === 'function' ? handler : null;
}

export function getNotificationPreferences() {
  return {
    notificationsEnabled: cachedState.notificationsEnabled,
    preferences: { ...cachedState.preferences },
  };
}

export function setNotificationPreferences(state) {
  cachedState = {
    notificationsEnabled: Boolean(state?.notificationsEnabled ?? true),
    preferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...(state?.preferences ?? {}),
    },
  };
}

export function syncNotificationPreferencesFromUser(user) {
  if (!user) {
    return;
  }

  setNotificationPreferences(buildNotificationState(user));
}

export function resetNotificationSessionState() {
  recentEvents.clear();
  calibrationRequiredNotified.clear();
}

export function getNotificationPermissionStatus() {
  return permissionStatus;
}

export function shouldNotifyType(type, state = cachedState) {
  return shouldNotify(type, state);
}

async function ensureAndroidNotificationChannel() {
  await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNEL_ID, {
    name: ANDROID_NOTIFICATION_CHANNEL_NAME,
    importance: Notifications.AndroidImportance.HIGH,
    enableVibrate: true,
    vibrationPattern: [0, 250, 250, 250],
    showBadge: true,
  });
}

function buildNotificationContent({ title, body }) {
  if (Platform.OS === 'android') {
    return {
      title,
      body,
      channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
    };
  }

  return {
    title,
    body,
    sound: true,
  };
}

export async function configureNotifications() {
  if (configured) {
    return permissionStatus;
  }

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await ensureAndroidNotificationChannel();
    }
  } catch {
    // Notification setup must never break the app.
  } finally {
    configured = true;
  }

  return permissionStatus;
}

export async function requestNotificationPermission() {
  await configureNotifications();

  try {
    const current = await Notifications.getPermissionsAsync();
    let finalStatus = current?.status ?? 'undetermined';

    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested?.status ?? finalStatus;
    }

    permissionStatus = finalStatus;
    return finalStatus;
  } catch {
    permissionStatus = 'denied';
    return 'denied';
  }
}

async function ensurePermissionLoaded() {
  if (permissionStatus === 'granted' || permissionStatus === 'denied') {
    return permissionStatus;
  }

  try {
    const current = await Notifications.getPermissionsAsync();
    permissionStatus = current?.status ?? 'undetermined';
  } catch {
    permissionStatus = 'denied';
  }

  return permissionStatus;
}

async function presentLocalNotification({ title, body }) {
  await configureNotifications();
  const status = await ensurePermissionLoaded();

  if (status !== 'granted') {
    return false;
  }

  await Notifications.scheduleNotificationAsync({
    content: buildNotificationContent({ title, body }),
    trigger: null,
  });

  return true;
}

function showFallbackToast(message) {
  try {
    toastHandler?.(message);
  } catch {
  }
}

async function deliverNotification({
  type,
  eventKey,
  title,
  body,
  preferToast = false,
}) {
  if (!shouldNotifyType(type)) {
    return { delivered: false, reason: 'disabled' };
  }

  if (hasRecentEvent(eventKey)) {
    return { delivered: false, reason: 'duplicate' };
  }

  markRecentEvent(eventKey);

  try {
    if (preferToast || TOAST_ONLY_TYPES.has(type)) {
      showFallbackToast(body);
      return { delivered: true, channel: 'toast' };
    }

    const shown = await presentLocalNotification({ title, body });
    if (shown) {
      return { delivered: true, channel: 'local' };
    }

    showFallbackToast(body);
    return { delivered: true, channel: 'toast-fallback' };
  } catch {
    showFallbackToast(body);
    return { delivered: true, channel: 'toast-fallback' };
  }
}

export async function notifyDeviceConnected({ deviceId, deviceName } = {}) {
  const label = resolveDeviceLabel(deviceName);
  const eventKey = `device-connected:${deviceId || label}`;

  return deliverNotification({
    type: NOTIFICATION_TYPES.DEVICE_CONNECTED,
    eventKey,
    title: 'Device Connected',
    body: `${label} connected`,
  });
}

export async function notifyDeviceDisconnected({ deviceId, reason } = {}) {
  const eventKey = `device-disconnected:${deviceId || 'default'}:${reason || 'default'}`;

  return deliverNotification({
    type: NOTIFICATION_TYPES.DEVICE_DISCONNECTED,
    eventKey,
    title: 'Device Disconnected',
    body: 'ESP32 disconnected',
  });
}

export async function notifyCalibrationComplete({ word, calibrationId } = {}) {
  const displayWord = formatDisplayWord(word);
  const eventKey = `calibration-complete:${calibrationId || displayWord.toLowerCase()}`;

  return deliverNotification({
    type: NOTIFICATION_TYPES.CALIBRATION_COMPLETE,
    eventKey,
    title: 'Calibration Complete',
    body: `Calibration complete: ${displayWord}`,
  });
}

export async function notifyCalibrationRequired({ word } = {}) {
  const normalizedWord = String(word || '').trim().toLowerCase();
  if (!normalizedWord) {
    return { delivered: false, reason: 'missing-word' };
  }

  if (calibrationRequiredNotified.has(normalizedWord)) {
    return { delivered: false, reason: 'duplicate' };
  }

  calibrationRequiredNotified.add(normalizedWord);
  const displayWord = formatDisplayWord(word);
  const eventKey = `calibration-required:${normalizedWord}`;

  return deliverNotification({
    type: NOTIFICATION_TYPES.CALIBRATION_REQUIRED,
    eventKey,
    title: 'Calibration Required',
    body: `Calibration required for ${displayWord}.`,
    preferToast: true,
  });
}

export async function notifyPredictionResult({ label, windowKey } = {}) {
  if (!label) {
    return { delivered: false, reason: 'missing-label' };
  }

  const displayWord = formatDisplayWord(label);
  const eventKey = `prediction-result:${windowKey || displayWord.toLowerCase()}`;

  return deliverNotification({
    type: NOTIFICATION_TYPES.PREDICTION_RESULT,
    eventKey,
    title: 'Prediction Result',
    body: `Predicted: ${displayWord}`,
  });
}

export function __resetNotificationServiceForTests() {
  cachedState = {
    notificationsEnabled: true,
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
  };
  permissionStatus = 'undetermined';
  configured = false;
  toastHandler = null;
  recentEvents.clear();
  calibrationRequiredNotified.clear();
}
