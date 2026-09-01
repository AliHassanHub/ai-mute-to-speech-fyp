jest.mock('react-native', () => ({
  Platform: { OS: 'android' },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ status: 'granted' })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('notification-id')),
  AndroidImportance: { DEFAULT: 5, HIGH: 6 },
}));

import * as Notifications from 'expo-notifications';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_TYPES,
  shouldNotify,
} from '../constants/notifications';
import {
  __resetNotificationServiceForTests,
  ANDROID_NOTIFICATION_CHANNEL_ID,
  ANDROID_NOTIFICATION_CHANNEL_NAME,
  configureNotifications,
  getNotificationPermissionStatus,
  notifyCalibrationComplete,
  notifyCalibrationRequired,
  notifyDeviceConnected,
  notifyDeviceDisconnected,
  notifyPredictionResult,
  requestNotificationPermission,
  setNotificationPreferences,
  setNotificationToastHandler,
  shouldNotifyType,
} from '../services/notificationService';

describe('notification preferences', () => {
  beforeEach(() => {
    __resetNotificationServiceForTests();
    jest.clearAllMocks();
    setNotificationToastHandler(jest.fn());
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.scheduleNotificationAsync.mockResolvedValue('notification-id');
    setNotificationPreferences({
      notificationsEnabled: true,
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    });
  });

  it('master ON allows enabled categories', () => {
    expect(shouldNotifyType(NOTIFICATION_TYPES.DEVICE_CONNECTED)).toBe(true);
  });

  it('master OFF blocks all categories', () => {
    setNotificationPreferences({
      notificationsEnabled: false,
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    });

    expect(shouldNotifyType(NOTIFICATION_TYPES.DEVICE_CONNECTED)).toBe(false);
    expect(shouldNotifyType(NOTIFICATION_TYPES.PREDICTION_RESULT)).toBe(false);
  });

  it('Device Connected ON delivers one notification', async () => {
    const first = await notifyDeviceConnected({ deviceId: 'abc', deviceName: 'ESP32_BT_Device' });
    const second = await notifyDeviceConnected({ deviceId: 'abc', deviceName: 'ESP32_BT_Device' });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('Device Connected OFF suppresses notification', async () => {
    setNotificationPreferences({
      notificationsEnabled: true,
      preferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        deviceConnected: false,
      },
    });

    const result = await notifyDeviceConnected({ deviceId: 'abc' });
    expect(result.delivered).toBe(false);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('Device Disconnected ON delivers one notification', async () => {
    const first = await notifyDeviceDisconnected({ deviceId: 'abc', reason: 'lost' });
    const second = await notifyDeviceDisconnected({ deviceId: 'abc', reason: 'lost' });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('Device Disconnected OFF suppresses notification', async () => {
    setNotificationPreferences({
      notificationsEnabled: true,
      preferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        deviceDisconnected: false,
      },
    });

    const result = await notifyDeviceDisconnected({ deviceId: 'abc' });
    expect(result.delivered).toBe(false);
  });

  it('Calibration Complete ON delivers one notification', async () => {
    const first = await notifyCalibrationComplete({ word: 'pain', calibrationId: 12 });
    const second = await notifyCalibrationComplete({ word: 'pain', calibrationId: 12 });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('Calibration Complete OFF suppresses notification', async () => {
    setNotificationPreferences({
      notificationsEnabled: true,
      preferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        calibrationComplete: false,
      },
    });

    const result = await notifyCalibrationComplete({ word: 'help' });
    expect(result.delivered).toBe(false);
  });

  it('Calibration Required ON delivers one notification per word', async () => {
    const toast = jest.fn();
    setNotificationToastHandler(toast);

    const first = await notifyCalibrationRequired({ word: 'Up' });
    const second = await notifyCalibrationRequired({ word: 'Up' });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(toast).toHaveBeenCalledWith('Calibration required for Up.');
  });

  it('Calibration Required OFF suppresses notification', async () => {
    const toast = jest.fn();
    setNotificationToastHandler(toast);
    setNotificationPreferences({
      notificationsEnabled: true,
      preferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        calibrationRequired: false,
      },
    });

    const result = await notifyCalibrationRequired({ word: 'Up' });
    expect(result.delivered).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('Prediction Result ON delivers one notification', async () => {
    const first = await notifyPredictionResult({ label: 'pain', windowKey: 'window-1' });
    const second = await notifyPredictionResult({ label: 'pain', windowKey: 'window-1' });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('Prediction Result OFF suppresses notification', async () => {
    setNotificationPreferences({
      notificationsEnabled: true,
      preferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        predictionResult: false,
      },
    });

    const result = await notifyPredictionResult({ label: 'help', windowKey: 'window-2' });
    expect(result.delivered).toBe(false);
  });

  it('falls back to toast when permission is denied', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const toast = jest.fn();
    setNotificationToastHandler(toast);

    await requestNotificationPermission();
    const result = await notifyDeviceConnected({ deviceId: 'abc', deviceName: 'ESP32' });

    expect(getNotificationPermissionStatus()).toBe('denied');
    expect(result.delivered).toBe(true);
    expect(result.channel).toBe('toast-fallback');
    expect(toast).toHaveBeenCalledWith('ESP32 connected');
  });

  it('persists preference state in memory for runtime checks', () => {
    setNotificationPreferences({
      notificationsEnabled: true,
      preferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        predictionResult: false,
      },
    });

    expect(shouldNotify(NOTIFICATION_TYPES.PREDICTION_RESULT, {
      notificationsEnabled: true,
      preferences: {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        predictionResult: false,
      },
    })).toBe(false);
    expect(shouldNotifyType(NOTIFICATION_TYPES.CALIBRATION_COMPLETE)).toBe(true);
  });

  it('does not throw when notification delivery fails', async () => {
    Notifications.scheduleNotificationAsync.mockRejectedValue(new Error('native failure'));
    const toast = jest.fn();
    setNotificationToastHandler(toast);

    await expect(
      notifyPredictionResult({ label: 'help', windowKey: 'window-3' })
    ).resolves.toMatchObject({ delivered: true, channel: 'toast-fallback' });
  });
});

describe('notification channel sound', () => {
  beforeEach(() => {
    __resetNotificationServiceForTests();
    jest.clearAllMocks();
    setNotificationToastHandler(jest.fn());
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Notifications.scheduleNotificationAsync.mockResolvedValue('notification-id');
    setNotificationPreferences({
      notificationsEnabled: true,
      preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES },
    });
  });

  it('creates the production Android channel without a custom sound asset', async () => {
    await configureNotifications();

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      ANDROID_NOTIFICATION_CHANNEL_ID,
      expect.objectContaining({
        name: ANDROID_NOTIFICATION_CHANNEL_NAME,
        importance: Notifications.AndroidImportance.HIGH,
        enableVibrate: true,
      })
    );

    const channelConfig = Notifications.setNotificationChannelAsync.mock.calls[0][1];
    expect(channelConfig.sound).toBeUndefined();
  });

  it('enables foreground notification sound in the handler', async () => {
    await configureNotifications();

    expect(Notifications.setNotificationHandler).toHaveBeenCalled();
    const handler = Notifications.setNotificationHandler.mock.calls[0][0];
    await expect(handler.handleNotification()).resolves.toMatchObject({
      shouldPlaySound: true,
    });
  });

  it('schedules Android notifications on the shared channel without sound string', async () => {
    await notifyPredictionResult({ label: 'Help', windowKey: 'window-sound' });

    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: {
        title: 'Prediction Result',
        body: 'Predicted: Help',
        channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
      },
      trigger: null,
    });
  });

  it('does not pass sound: "default" as a custom bundled filename', async () => {
    await notifyDeviceConnected({ deviceId: 'abc', deviceName: 'ESP32' });

    const payload = Notifications.scheduleNotificationAsync.mock.calls[0][0];
    expect(payload.content.sound).toBeUndefined();
    expect(payload.content.channelId).toBe(ANDROID_NOTIFICATION_CHANNEL_ID);
  });

  const channelNotificationCases = [
    ['Device Connected', () => notifyDeviceConnected({ deviceId: 'abc' })],
    ['Device Disconnected', () => notifyDeviceDisconnected({ deviceId: 'abc' })],
    ['Calibration Complete', () => notifyCalibrationComplete({ word: 'help' })],
    [
      'Prediction Result',
      () => notifyPredictionResult({ label: 'help', windowKey: 'window-all' }),
    ],
  ];

  it.each(channelNotificationCases)(
    '%s uses the shared Android notification channel',
    async (_, triggerNotification) => {
      await triggerNotification();

      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.objectContaining({
            channelId: ANDROID_NOTIFICATION_CHANNEL_ID,
          }),
        })
      );

      const payload = Notifications.scheduleNotificationAsync.mock.calls.at(-1)[0];
      expect(payload.content.sound).toBeUndefined();
    }
  );

  it('keeps duplicate protection unchanged for sounded notifications', async () => {
    const first = await notifyDeviceDisconnected({ deviceId: 'abc', reason: 'lost' });
    const second = await notifyDeviceDisconnected({ deviceId: 'abc', reason: 'lost' });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('does not change permission handling when sound is enabled', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await requestNotificationPermission();

    expect(getNotificationPermissionStatus()).toBe('denied');
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
