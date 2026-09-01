/** Nordic UART Service UUIDs expected by ESP32_BT_Device firmware. */
export const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_WRITE_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_NOTIFY_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export const PREFERRED_EMG_DEVICE_NAME = 'ESP32_BT_Device';

export function normalizeUuid(uuid) {
  return String(uuid || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '');
}

export function uuidEquals(a, b) {
  return normalizeUuid(a) === normalizeUuid(b);
}

export function bleLog(...args) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[BLE]', ...args);
  }
}

export function emgLog(...args) {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log('[EMG]', ...args);
  }
}
