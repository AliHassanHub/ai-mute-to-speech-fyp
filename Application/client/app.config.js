/**
 * Expo Go requires runtimeVersion policy "sdkVersion" (not a fixed "1.0.0").
 * Custom updates config can make Expo Go try to fetch OTA bundles and fail.
 * EAS builds: set EAS_BUILD=true so runtimeVersion is pinned for releases.
 */
const appJson = require('./app.json');

const isEasBuild = process.env.EAS_BUILD === 'true';
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:5000/api';

module.exports = {
  expo: {
    ...appJson.expo,
    extra: {
      ...appJson.expo.extra,
      apiUrl,
    },
    plugins: [
      ...(appJson.expo.plugins ?? []),
      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: true,
          },
        },
      ],
      './plugins/withAndroidNetworkSecurity.js',
      'expo-secure-store',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow AI Mute-to-Speech to use your location to scan for nearby Bluetooth devices.',
        },
      ],
      [
        'react-native-ble-plx',
        {
          isBackgroundEnabled: false,
          modes: ['peripheral', 'central'],
          bluetoothAlwaysPermission:
            'Allow AI Mute-to-Speech to connect to your EMG Bluetooth sensor.',
        },
      ],
    ],
    runtimeVersion: isEasBuild
      ? { policy: 'appVersion' }
      : { policy: 'sdkVersion' },
    ...(isEasBuild
      ? {
          updates: {
            enabled: false,
            checkAutomatically: 'NEVER',
            fallbackToCacheTimeout: 0,
          },
        }
      : {}),
  },
};
