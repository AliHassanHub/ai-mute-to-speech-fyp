/**
 * React Native BLE layer (react-native-ble-plx).
 *
 * Scans BLE/GATT peripherals only — NOT the Android Classic Bluetooth
 * pairing list. ESP32 firmware uses Nordic UART Service over BLE.
 *
 * Every device in the scan list originates from BleManager.startDeviceScan
 * callbacks. This module does not invent, mock, or simulate peripherals.
 */
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager, ScanMode, State } from 'react-native-ble-plx';
import * as Location from 'expo-location';
import {
  NUS_NOTIFY_UUID,
  NUS_SERVICE_UUID,
  NUS_WRITE_UUID,
  PREFERRED_EMG_DEVICE_NAME,
  bleLog,
  emgLog,
  uuidEquals,
} from '../constants/bleConfig';
import { parseEmgLine } from '../utils/emgSignal';
import {
  CONNECT_FAILURE,
  CONNECT_FAILURE_LABELS,
  DEVICE_RELEVANCE,
  UNNAMED_BLE_LABEL,
  categorizeConnectFailure,
  classifyRelevance,
  describeUnnamedDevice,
  detectEsp32Signals,
  rawScanResultSnapshot,
  summarizeAdvertisement,
} from '../utils/bleAdvertisement';

/**
 * Development-only: dump every field of every scan callback, untransformed.
 *
 * Off by default because a LowLatency scan with duplicates produces a very high
 * callback rate. Enable from a dev console or before a diagnostic scan via
 * setRawScanLogging(true) to hunt for a missing peripheral.
 */
let rawScanLogging = false;

export function setRawScanLogging(enabled) {
  rawScanLogging = Boolean(enabled);
  bleLog('raw scan logging', rawScanLogging ? 'ENABLED' : 'disabled');
}

export function isRawScanLoggingEnabled() {
  return rawScanLogging;
}

const FIRST_EMG_PACKET_TIMEOUT_MS = 10000;

/**
 * Drop a peripheral from the list when it has not re-advertised for this long.
 * BLE peripherals advertise continuously (typically every 20-1280 ms), so an
 * entry that goes quiet for several seconds has either moved out of range or
 * rotated to a new privacy address. Keeping it would inflate the device count
 * with entries the phone can no longer reach.
 */
const DEVICE_STALE_AFTER_MS = 12000;

/** Coalesce scan callbacks so the list re-renders at most this often. */
const SCAN_EMIT_INTERVAL_MS = 500;

/** Remembers why a connection attempt failed, keyed by device id. */
const connectOutcomes = new Map();

export function getDeviceConnectOutcome(deviceId) {
  return connectOutcomes.get(deviceId) || null;
}

export function clearDeviceConnectOutcomes() {
  connectOutcomes.clear();
}

function recordConnectFailure(deviceId, error, summary) {
  const category = categorizeConnectFailure(error, summary);
  connectOutcomes.set(deviceId, {
    status: 'failed',
    category,
    label: CONNECT_FAILURE_LABELS[category] || CONNECT_FAILURE_LABELS.OTHER,
    message: String(error?.message || error || ''),
    at: Date.now(),
  });
  bleLog('Connect failed', deviceId, category);
  return category;
}

let manager = null;
let connectedBleDevice = null;
let connectedDeviceId = null;
let disconnectSubscription = null;
let globalDisconnectSubscription = null;
let connectionPollTimer = null;
let suppressDisconnectEvent = false;
let activeScanStopper = null;
/** @type {string} */
let connectionPhase = 'idle';
const connectionListeners = new Set();

function setConnectionPhase(next) {
  connectionPhase = next;
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    bleLog('phase:', next);
  }
}

export function getBleConnectionPhase() {
  return connectionPhase;
}

function stopEmgStreamSafely() {
  try {
    // Lazy require avoids a circular import with emgStreamService.
    // eslint-disable-next-line global-require
    const { clearLiveEmgState } = require('./emgStreamService');
    clearLiveEmgState();
  } catch {
  }
}

/**
 * Map a real BLE failure to a clear, honest user-facing message.
 *
 * The failure category is derived from the actual Android GATT status /
 * react-native-ble-plx error, optionally combined with what the peripheral's
 * advertisement told us. Nothing here disguises a genuine Android BLE
 * limitation as an application error.
 */
export function mapBleConnectError(error, advertisement = null) {
  const category = categorizeConnectFailure(error, advertisement);

  switch (category) {
    case CONNECT_FAILURE.PERMISSION_DENIED:
      return 'Bluetooth permission was denied. Allow Bluetooth access and try again.';
    case CONNECT_FAILURE.NO_EMG_DATA:
      return 'Connected, but no EMG data received.';
    case CONNECT_FAILURE.NOT_EMG_DEVICE:
      return 'This device is not a compatible EMG device (Nordic UART service not found).';
    case CONNECT_FAILURE.NO_GATT_SERVICE:
      return 'This device did not expose any GATT services.';
    case CONNECT_FAILURE.NON_CONNECTABLE_ADVERTISEMENT:
      return 'This is a broadcast-only BLE beacon. It advertises but does not accept connections, so it cannot be paired. This is normal for phones, watches and trackers nearby.';
    case CONNECT_FAILURE.OUT_OF_RANGE:
      return 'Connection timed out. Keep the ESP32 nearby and powered on, then try again.';
    case CONNECT_FAILURE.DEVICE_DISAPPEARED:
      return 'The device stopped advertising before the connection completed. Scan again.';
    case CONNECT_FAILURE.GATT_CONNECTION_FAILED:
      return 'The device refused the connection (Android GATT error). It may already be connected elsewhere or require bonding.';
    default:
      break;
  }

  const raw = String(error?.message || error || '').toLowerCase();
  if (raw.includes('stream unavailable') || raw.includes('notification') || raw.includes('subscribe')) {
    return 'Connected, but EMG stream unavailable.';
  }

  return error?.message || 'Could not connect to this device.';
}

function notifyConnectionChange(payload) {
  connectionListeners.forEach((listener) => {
    try {
      listener(payload);
    } catch {
    }
  });
}

function clearDisconnectMonitoring() {
  if (disconnectSubscription) {
    disconnectSubscription.remove();
    disconnectSubscription = null;
  }
  if (globalDisconnectSubscription) {
    globalDisconnectSubscription.remove();
    globalDisconnectSubscription = null;
  }
  if (connectionPollTimer) {
    clearInterval(connectionPollTimer);
    connectionPollTimer = null;
  }
}

function handleBleDisconnected(reason = 'disconnected') {
  const device = connectedBleDevice;
  const deviceId = connectedDeviceId;

  if (!device && !deviceId) {
    return;
  }

  stopEmgStreamSafely();
  connectedBleDevice = null;
  connectedDeviceId = null;
  clearDisconnectMonitoring();
  setConnectionPhase('disconnected');

  const shouldNotify = !suppressDisconnectEvent;
  suppressDisconnectEvent = false;

  if (shouldNotify) {
    notifyConnectionChange({
      connected: false,
      device: device || { id: deviceId },
      reason,
      phase: 'disconnected',
    });
  }

  bleLog('Disconnected');
}

/** Guards against overlapping pollers stacking GATT operations on one link. */
let verifyInFlight = null;

function emgStreamIsActive() {
  try {
    // eslint-disable-next-line global-require
    const { isStreamActive } = require('./emgStreamService');
    return isStreamActive();
  } catch {
    return false;
  }
}

async function verifyConnectionAliveInner() {
  const deviceId = connectedDeviceId || connectedBleDevice?.id;
  if (!deviceId) {
    return { connected: false };
  }

  const ble = getBleManager();

  try {
    const isConnected = await ble.isDeviceConnected(deviceId);
    if (!isConnected) {
      handleBleDisconnected('out_of_range');
      return { connected: false };
    }

    if (connectedBleDevice) {
      try {
        const deviceSaysConnected = await connectedBleDevice.isConnected();
        if (!deviceSaysConnected) {
          handleBleDisconnected('link_lost');
          return { connected: false };
        }

        // While EMG notifications are flowing, arriving packets already prove
        // the link is alive. Issuing an extra readRSSI GATT request every few
        // seconds only competes with the 50 Hz notify traffic.
        if (!emgStreamIsActive()) {
          await connectedBleDevice.readRSSI();
        }
      } catch {
        handleBleDisconnected('signal_lost');
        return { connected: false };
      }
    }

    return { connected: true, device: connectedBleDevice };
  } catch {
    handleBleDisconnected('connection_lost');
    return { connected: false };
  }
}

function verifyConnectionAlive() {
  if (verifyInFlight) return verifyInFlight;
  verifyInFlight = verifyConnectionAliveInner().finally(() => {
    verifyInFlight = null;
  });
  return verifyInFlight;
}

function startConnectionPolling() {
  if (connectionPollTimer) {
    clearInterval(connectionPollTimer);
  }

  connectionPollTimer = setInterval(() => {
    verifyConnectionAlive().catch(() => {
      handleBleDisconnected('connection_lost');
    });
  }, 2000);
}

function setupDisconnectMonitoring(device) {
  clearDisconnectMonitoring();
  connectedDeviceId = device.id;

  const ble = getBleManager();

  disconnectSubscription = device.onDisconnected(() => {
    handleBleDisconnected('disconnected');
  });

  globalDisconnectSubscription = ble.onDeviceDisconnected(device.id, () => {
    handleBleDisconnected('disconnected');
  });

  startConnectionPolling();
}

export function onBleConnectionChange(listener) {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

export async function checkBleConnectionState(fallbackDeviceId = null) {
  if (!connectedDeviceId && !connectedBleDevice?.id && fallbackDeviceId) {
    restoreConnectionTracking(fallbackDeviceId);
  }
  return verifyConnectionAlive();
}

export function getConnectedDeviceId() {
  return connectedDeviceId || connectedBleDevice?.id || null;
}

/**
 * Ensure the single internal liveness poller is running (one timer per connection).
 */
export function startConnectionMonitor() {
  if (!connectedDeviceId && !connectedBleDevice) {
    return () => {};
  }

  if (!connectionPollTimer) {
    startConnectionPolling();
  }

  // The poller is owned by the connection lifecycle, not by the caller.
  return () => {};
}

export function restoreConnectionTracking(deviceId) {
  if (!deviceId || connectedBleDevice) {
    return;
  }

  connectedDeviceId = deviceId;
  const ble = getBleManager();

  if (globalDisconnectSubscription) {
    globalDisconnectSubscription.remove();
  }

  globalDisconnectSubscription = ble.onDeviceDisconnected(deviceId, () => {
    handleBleDisconnected('disconnected');
  });

  if (!connectionPollTimer) {
    startConnectionPolling();
  }
}

export function getBleManager() {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
}

export function rssiToStrength(rssi) {
  if (rssi == null) return 0;
  return Math.max(0, Math.min(100, Math.round(2 * (rssi + 100))));
}

/**
 * Best available real name from the advertisement. Never invents a fake device name.
 */
export function getDeviceLabel(device) {
  const name = device?.name?.trim() || device?.localName?.trim();
  return name || UNNAMED_BLE_LABEL;
}

function deviceAdvertisesNus(device) {
  const advertised = device?.serviceUUIDs || device?.serviceUuids || [];
  if (!Array.isArray(advertised) || advertised.length === 0) {
    return false;
  }
  return advertised.some((uuid) => uuidEquals(uuid, NUS_SERVICE_UUID));
}

/**
 * Hint-only classification from advertisement data.
 * Final EMG confirmation requires GATT + a real EMG packet.
 *
 * @returns {'LIKELY_EMG' | 'OTHER_BLE_DEVICE'}
 */
export function identifyEmgDevice(device, summary = null) {
  const label = getDeviceLabel(device).toLowerCase();
  const preferred = PREFERRED_EMG_DEVICE_NAME.toLowerCase();

  // Strongest advertisement hint: NUS UUID in the advertising payload.
  if (deviceAdvertisesNus(device)) {
    return 'LIKELY_EMG';
  }
  if (summary?.advertisedServiceUuids?.some((uuid) => uuidEquals(uuid, NUS_SERVICE_UUID))) {
    return 'LIKELY_EMG';
  }

  if (label === preferred || label.includes('esp32_bt_device')) {
    return 'LIKELY_EMG';
  }
  if (label.includes('esp32') || label.includes('emg')) {
    return 'LIKELY_EMG';
  }
  if (label.includes('mute') || label.includes('silent')) {
    return 'LIKELY_EMG';
  }

  return 'OTHER_BLE_DEVICE';
}

export function isLikelyEmgDevice(device) {
  return identifyEmgDevice(device) === 'LIKELY_EMG';
}

export function isEmgCandidate(device) {
  return isLikelyEmgDevice(device);
}

/**
 * Local UI filter only. Scanning always discovers every BLE peripheral Android
 * reports; this only decides what the list shows.
 *
 * `emgOnly`  — just the likely EMG peripherals.
 * `showAll`  — every raw advertisement, including anonymous background beacons.
 *              Default (both false) hides only unnamed, service-less, rotating
 *              address broadcasters, which cannot be connected or bonded.
 */
export function filterDiscoveredDevices(devices, { emgOnly = false, showAll = false } = {}) {
  const list = Array.isArray(devices) ? devices : [];

  if (emgOnly) {
    return list.filter(
      (item) =>
        item.classification === 'LIKELY_EMG' ||
        item.isLikelyEmgDevice ||
        item.isEmgCandidate
    );
  }

  if (showAll) return list;

  return list.filter((item) => item.relevance !== DEVICE_RELEVANCE.BACKGROUND_BEACON);
}

/** Counts used by the UI to explain exactly what was filtered and why. */
export function summarizeDiscovery(devices) {
  const list = Array.isArray(devices) ? devices : [];
  const counts = {
    total: list.length,
    emgCandidates: 0,
    named: 0,
    identifiable: 0,
    backgroundBeacons: 0,
    rotatingAddresses: 0,
    connectFailures: 0,
  };

  list.forEach((item) => {
    if (item.relevance === DEVICE_RELEVANCE.EMG_CANDIDATE) counts.emgCandidates += 1;
    else if (item.relevance === DEVICE_RELEVANCE.NAMED_PERIPHERAL) counts.named += 1;
    else if (item.relevance === DEVICE_RELEVANCE.IDENTIFIABLE_PERIPHERAL) counts.identifiable += 1;
    else counts.backgroundBeacons += 1;

    if (item.advertisement?.address?.rotating) counts.rotatingAddresses += 1;
    if (item.connectOutcome?.status === 'failed') counts.connectFailures += 1;
  });

  return counts;
}

const RELEVANCE_RANK = {
  [DEVICE_RELEVANCE.EMG_CANDIDATE]: 3,
  [DEVICE_RELEVANCE.NAMED_PERIPHERAL]: 2,
  [DEVICE_RELEVANCE.IDENTIFIABLE_PERIPHERAL]: 1,
  [DEVICE_RELEVANCE.BACKGROUND_BEACON]: 0,
};

function sortDiscoveredDevices(devices) {
  const preferred = PREFERRED_EMG_DEVICE_NAME.toLowerCase();
  return [...devices].sort((a, b) => {
    const aPreferred = String(a.name || '').toLowerCase() === preferred ? 1 : 0;
    const bPreferred = String(b.name || '').toLowerCase() === preferred ? 1 : 0;
    if (aPreferred !== bPreferred) return bPreferred - aPreferred;

    const aRank = RELEVANCE_RANK[a.relevance] ?? 0;
    const bRank = RELEVANCE_RANK[b.relevance] ?? 0;
    if (aRank !== bRank) return bRank - aRank;

    return (b.rssi ?? -100) - (a.rssi ?? -100);
  });
}

function decodeBase64(value) {
  if (!value) return '';
  try {
    if (typeof globalThis.atob === 'function') {
      return globalThis.atob(value);
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * Temporary notify subscription until one valid EMG:<n> POT:<n> line arrives.
 * Does not fabricate packets. Removes the subscription afterward.
 */
function waitForFirstValidEmgPacket(device, timeoutMs = FIRST_EMG_PACKET_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let lineBuf = '';
    let settled = false;
    let subscription = null;

    emgLog('Waiting for first packet');

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        subscription?.remove();
      } catch {
      }
      fn(arg);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Connected, but no EMG data received.'));
    }, timeoutMs);

    try {
      setConnectionPhase('subscribing');
      subscription = device.monitorCharacteristicForService(
        NUS_SERVICE_UUID,
        NUS_NOTIFY_UUID,
        (error, characteristic) => {
          if (settled) return;
          if (error) {
            finish(
              reject,
              new Error(error.message || 'Connected, but EMG stream unavailable.')
            );
            return;
          }
          if (!characteristic?.value) return;

          lineBuf += decodeBase64(characteristic.value);
          const lines = lineBuf.split(/\r?\n/);
          lineBuf = lines.pop() ?? '';

          for (const line of lines) {
            const sample = parseEmgLine(line);
            if (sample) {
              emgLog('First packet received', `EMG:${sample[0]} POT:${sample[1]}`);
              finish(resolve, sample);
              return;
            }
          }
        }
      );
      bleLog('Notification subscribed');
      setConnectionPhase('waitingForData');
    } catch (error) {
      finish(
        reject,
        new Error(error?.message || 'Connected, but EMG stream unavailable.')
      );
    }
  });
}

export async function requestBlePermissions() {
  if (Platform.OS === 'android') {
    if (Platform.Version >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(result).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
    }

    const location = await Location.requestForegroundPermissionsAsync();
    const legacy = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return (
      location.status === 'granted' &&
      legacy === PermissionsAndroid.RESULTS.GRANTED
    );
  }

  const location = await Location.requestForegroundPermissionsAsync();
  return location.status === 'granted';
}

export async function ensureBluetoothReady() {
  const ble = getBleManager();
  const state = await ble.state();

  if (state === State.PoweredOn) {
    return { ready: true };
  }

  if (state === State.PoweredOff) {
    return {
      ready: false,
      message: 'Bluetooth is turned off. Please enable Bluetooth and try again.',
    };
  }

  if (state === State.Unauthorized) {
    return {
      ready: false,
      message: 'Bluetooth permission was denied. Allow Bluetooth access in settings.',
    };
  }

  if (state === State.Unsupported) {
    return {
      ready: false,
      message:
        'Bluetooth is not available on this device. Use a physical phone with Bluetooth to connect your EMG sensor.',
    };
  }

  return new Promise((resolve) => {
    const subscription = ble.onStateChange((nextState) => {
      if (nextState === State.PoweredOn) {
        subscription.remove();
        resolve({ ready: true });
      } else if (
        nextState === State.PoweredOff ||
        nextState === State.Unauthorized ||
        nextState === State.Unsupported
      ) {
        subscription.remove();
        resolve({
          ready: false,
          message: 'Bluetooth is not available. Enable Bluetooth and try again.',
        });
      }
    }, true);

    setTimeout(() => {
      subscription.remove();
      resolve({
        ready: false,
        message: 'Bluetooth took too long to respond. Please try again.',
      });
    }, 8000);
  });
}

/**
 * Scan ALL nearby BLE peripherals from Android.
 *
 * Source of truth: the BleManager.startDeviceScan callback only. Every entry in
 * the emitted list came from a real Android ScanResult with a real device.id.
 *
 * Behaviour notes:
 *  - SCAN_MODE_LOW_LATENCY. react-native-ble-plx defaults to LowPower, which
 *    only listens ~10% of the time and makes the ESP32 slow/unreliable to find
 *    in a foreground device picker.
 *  - allowDuplicates stays on so RSSI stays fresh and a name arriving in a
 *    later scan response is picked up, but emissions are coalesced so the list
 *    does not re-render on every advertising packet.
 *  - Entries that stop advertising for DEVICE_STALE_AFTER_MS are evicted.
 */
export function startBleScan(onDeviceFound, onError) {
  if (activeScanStopper) {
    activeScanStopper();
    activeScanStopper = null;
  }

  const ble = getBleManager();
  const devicesMap = new Map();
  let emitTimer = null;
  let stopped = false;

  const buildList = () => {
    const cutoff = Date.now() - DEVICE_STALE_AFTER_MS;
    let evicted = 0;

    devicesMap.forEach((entry, id) => {
      if (entry.lastSeen < cutoff) {
        devicesMap.delete(id);
        evicted += 1;
      }
    });

    if (evicted > 0) {
      bleLog('Evicted stale advertisers:', evicted);
    }

    return sortDiscoveredDevices(Array.from(devicesMap.values()));
  };

  const scheduleEmit = () => {
    if (emitTimer || stopped) return;
    emitTimer = setTimeout(() => {
      emitTimer = null;
      if (stopped) return;
      onDeviceFound?.(buildList());
    }, SCAN_EMIT_INTERVAL_MS);
  };

  setConnectionPhase('scanning');
  bleLog('Scan started (mode=LowLatency, legacy=true, duplicates=on)');

  ble.startDeviceScan(
    null,
    { allowDuplicates: true, scanMode: ScanMode.LowLatency, legacyScan: true },
    (error, device) => {
      if (error) {
        bleLog('Scan error', error.message || String(error));
        onError?.(error);
        return;
      }

      // Real ScanResult only — never fabricate devices.
      if (!device?.id) return;

      // Always announce a hit on the target peripheral, on every advertisement,
      // regardless of filters, classification or the raw-logging switch. If the
      // ESP32 advertisement ever reaches Android, this line must appear.
      const esp32Signals = detectEsp32Signals(device, PREFERRED_EMG_DEVICE_NAME);
      if (esp32Signals) {
        bleLog('*** ESP32 SIGNAL DETECTED ***', device.id);
        esp32Signals.forEach((hit) => bleLog('    hit:', hit));
        bleLog('    raw:', JSON.stringify(rawScanResultSnapshot(device)));
      }

      if (rawScanLogging) {
        bleLog('raw scan result:', JSON.stringify(rawScanResultSnapshot(device)));
      }

      const now = Date.now();
      const existing = devicesMap.get(device.id);
      const advertisementsSeen = (existing?.advertisementsSeen ?? 0) + 1;

      const summary = summarizeAdvertisement(device, { advertisementsSeen });
      const rssi = device.rssi ?? null;
      const classification = identifyEmgDevice(device, summary);
      const likely = classification === 'LIKELY_EMG';

      // Never overwrite a real name with the placeholder: the name often only
      // arrives in a later scan response (the ESP32 is exactly this case,
      // because a 128-bit service UUID leaves no room for the name in the
      // 31-byte advertising payload).
      const nextName = summary.hasName
        ? summary.name
        : existing?.name && existing.name !== UNNAMED_BLE_LABEL
          ? existing.name
          : UNNAMED_BLE_LABEL;

      const hasRealName = nextName !== UNNAMED_BLE_LABEL;
      const nextRssi = rssi != null ? rssi : existing?.rssi ?? -100;
      const serviceUUIDs = summary.advertisedServiceUuids.length
        ? summary.advertisedServiceUuids
        : existing?.serviceUUIDs ?? [];

      const relevance = classifyRelevance(
        { ...summary, hasName: hasRealName, hasGattIdentity: summary.hasGattIdentity || serviceUUIDs.length > 0 },
        { isEmgCandidate: likely }
      );

      const entry = {
        id: device.id,
        name: nextName,
        hasRealName,
        localName: device.localName || existing?.localName || null,
        rssi: nextRssi,
        signalStrength: rssiToStrength(nextRssi),
        classification,
        isLikelyEmgDevice: likely,
        isEmgCandidate: likely,
        serviceUUIDs,
        relevance,
        advertisement: summary,
        detail: describeUnnamedDevice({ ...summary, hasName: hasRealName }),
        connectOutcome: connectOutcomes.get(device.id) || null,
        advertisementsSeen,
        firstSeen: existing?.firstSeen ?? now,
        lastSeen: now,
        // Keep a reference for connect; still originated from this scan callback.
        device,
      };

      devicesMap.set(device.id, entry);

      if (!existing) {
        bleLog('Device discovered');
        bleLog('  name:', nextName, summary.nameSource ? `(from ${summary.nameSource})` : '(no name advertised)');
        bleLog('  id:', device.id);
        bleLog('  address type:', summary.address.label, summary.address.rotating ? '[rotating]' : '');
        bleLog('  rssi:', nextRssi);
        bleLog('  advertised 128-bit service UUIDs:', serviceUUIDs.length ? serviceUUIDs.join(', ') : 'none');
        bleLog(
          '  advertised 16-bit service UUIDs:',
          summary.shortServiceUuids.length
            ? summary.shortServiceUuids
                .map((u) => `0x${u.toString(16).padStart(4, '0')}`)
                .join(', ') +
                (summary.shortServiceLabels.length
                  ? ` (${summary.shortServiceLabels.join(', ')})`
                  : '')
            : 'none'
        );
        bleLog(
          '  service data keys:',
          summary.serviceDataUuids.length ? summary.serviceDataUuids.join(', ') : 'none'
        );
        bleLog('  vendor (company id):', summary.vendorLabel || 'not advertised');
        bleLog('  tx power:', summary.txPowerLevel ?? 'not advertised');
        bleLog('  raw scan record bytes:', summary.rawScanRecordBytes);
        bleLog(
          '  connectable (Android ScanResult):',
          summary.connectabilityKnown ? summary.isConnectable : 'unknown'
        );
        bleLog('  classification:', classification, '| relevance:', relevance);
      }

      scheduleEmit();
    }
  );

  const stop = () => {
    stopped = true;
    if (emitTimer) {
      clearTimeout(emitTimer);
      emitTimer = null;
    }
    ble.stopDeviceScan().catch(() => {});
    if (activeScanStopper === stop) {
      activeScanStopper = null;
    }
    if (connectionPhase === 'scanning') {
      setConnectionPhase('idle');
    }
    bleLog('Scan stopped');
  };

  activeScanStopper = stop;
  return stop;
}

/**
 * Confirm the connected GATT peripheral exposes Nordic UART EMG characteristics.
 */
export async function validateEmgBleService(device) {
  if (!device) {
    return {
      valid: false,
      reason: 'No BLE device is available for validation.',
    };
  }

  setConnectionPhase('validating');
  bleLog('GATT validation started', device.id);

  try {
    const services = await device.services();
    bleLog('GATT services discovered', (services || []).length);

    const service = (services || []).find((item) => uuidEquals(item.uuid, NUS_SERVICE_UUID));

    if (!service) {
      bleLog('Non-EMG BLE device (NUS missing)', device.id);
      return {
        valid: false,
        reason: 'This device is not a compatible EMG device.',
      };
    }

    bleLog('NUS service found', service.uuid);

    const characteristics = await device.characteristicsForService(service.uuid);
    const notifyCharacteristic = (characteristics || []).find((item) =>
      uuidEquals(item.uuid, NUS_NOTIFY_UUID)
    );
    const writeCharacteristic = (characteristics || []).find((item) =>
      uuidEquals(item.uuid, NUS_WRITE_UUID)
    );

    if (!notifyCharacteristic) {
      bleLog('Notify characteristic missing', device.id);
      return {
        valid: false,
        reason: 'This device is not a compatible EMG device.',
      };
    }

    bleLog('Notify characteristic found', notifyCharacteristic.uuid);

    if (!writeCharacteristic) {
      bleLog('Write characteristic missing', device.id);
      return {
        valid: false,
        reason: 'This device is not a compatible EMG device.',
      };
    }

    bleLog('Write characteristic found', writeCharacteristic.uuid);
    bleLog('GATT validated');

    return {
      valid: true,
      serviceUuid: service.uuid,
      notifyCharacteristicUuid: notifyCharacteristic.uuid,
      writeCharacteristicUuid: writeCharacteristic.uuid,
    };
  } catch (error) {
    bleLog('GATT validation failed', error?.message || String(error));
    return {
      valid: false,
      reason: error?.message || 'Could not validate EMG BLE services.',
    };
  }
}

function stopActiveScan() {
  if (activeScanStopper) {
    activeScanStopper();
    activeScanStopper = null;
  } else {
    getBleManager().stopDeviceScan().catch(() => {});
  }
}

/**
 * Full real-hardware connect path:
 * stop scan → connect → isConnected → discover → NUS validate →
 * subscribe → wait for first real EMG packet → EMG READY.
 *
 * Does NOT call the backend. Caller should POST metadata only after success.
 */
export async function connectAndPrepareEmgDevice(deviceId, options = {}) {
  const ble = getBleManager();
  const advertisement = options.advertisement ?? null;
  stopActiveScan();

  connectOutcomes.delete(deviceId);
  setConnectionPhase('connecting');
  bleLog('Connecting', deviceId);

  const fail = (error) => {
    recordConnectFailure(deviceId, error, advertisement);
    return error;
  };

  try {
    if (connectedBleDevice && connectedBleDevice.id !== deviceId) {
      await connectedBleDevice.cancelConnection().catch(() => {});
      connectedBleDevice = null;
      connectedDeviceId = null;
    }

    let device = connectedBleDevice?.id === deviceId ? connectedBleDevice : null;

    if (!device) {
      device = await ble.connectToDevice(deviceId, { timeout: 15000 });
    }

    const linked = await device.isConnected();
    if (!linked) {
      setConnectionPhase('error');
      await device.cancelConnection().catch(() => {});
      throw new Error('Bluetooth link was not established (isConnected=false).');
    }

    // Report the real advertised name only. Never substitute the expected ESP32
    // name for a peripheral that did not advertise one.
    bleLog('Connected', device.id, device.name || device.localName || UNNAMED_BLE_LABEL);

    setConnectionPhase('discovering');
    await device.discoverAllServicesAndCharacteristics();

    const validation = await validateEmgBleService(device);
    if (!validation.valid) {
      setConnectionPhase('error');
      await device.cancelConnection().catch(() => {});
      throw new Error(validation.reason || 'This device is not a compatible EMG device.');
    }

    // Keep device tracked before waiting for data so disconnect cleanup works.
    connectedBleDevice = device;
    setupDisconnectMonitoring(device);

    try {
      const firstSample = await waitForFirstValidEmgPacket(device, FIRST_EMG_PACKET_TIMEOUT_MS);
      setConnectionPhase('ready');
      bleLog('EMG READY — real packet verified');

      connectOutcomes.set(deviceId, {
        status: 'connected',
        category: null,
        label: 'Connected',
        at: Date.now(),
      });

      notifyConnectionChange({
        connected: true,
        device,
        reason: 'connected',
        phase: 'ready',
        emgReady: true,
        firstSample,
      });

      return {
        device,
        validation,
        firstSample,
        phase: 'ready',
        emgReady: true,
      };
    } catch (error) {
      setConnectionPhase('error');
      await disconnectBleDevice().catch(() => {});
      throw error;
    }
  } catch (error) {
    throw fail(error);
  }
}

/**
 * Legacy connect helper: GATT validation only (no first-packet wait).
 * Prefer connectAndPrepareEmgDevice for EMG hardware pairing.
 */
export async function connectBleDevice(deviceId, options = {}) {
  const { requireEmgService = true, requireFirstPacket = false } = options;

  if (requireFirstPacket || requireEmgService) {
    if (requireFirstPacket) {
      const result = await connectAndPrepareEmgDevice(deviceId);
      return result.device;
    }
  }

  stopActiveScan();
  setConnectionPhase('connecting');
  bleLog('Connecting', deviceId);

  if (connectedBleDevice?.id === deviceId) {
    if (requireEmgService) {
      const validation = await validateEmgBleService(connectedBleDevice);
      if (!validation.valid) {
        await disconnectBleDevice().catch(() => {});
        throw new Error(validation.reason || 'This device is not a compatible EMG device.');
      }
    }
    return connectedBleDevice;
  }

  if (connectedBleDevice) {
    await connectedBleDevice.cancelConnection().catch(() => {});
    connectedBleDevice = null;
    connectedDeviceId = null;
  }

  const device = await getBleManager().connectToDevice(deviceId, { timeout: 15000 });
  const linked = await device.isConnected();
  if (!linked) {
    await device.cancelConnection().catch(() => {});
    throw new Error('Bluetooth link was not established (isConnected=false).');
  }

  setConnectionPhase('discovering');
  await device.discoverAllServicesAndCharacteristics();
  bleLog('Connected', device.id, device.name || device.localName || '');

  if (requireEmgService) {
    const validation = await validateEmgBleService(device);
    if (!validation.valid) {
      bleLog('Non-EMG BLE device', validation.reason);
      await device.cancelConnection().catch(() => {});
      throw new Error(validation.reason || 'This device is not a compatible EMG device.');
    }
  }

  connectedBleDevice = device;
  setupDisconnectMonitoring(device);
  setConnectionPhase('connected');
  notifyConnectionChange({
    connected: true,
    device,
    reason: 'connected',
    phase: 'connected',
    emgReady: false,
  });
  return device;
}

function emitIntentionalDisconnectEvent(device, deviceId) {
  if (!device && !deviceId) {
    return;
  }

  notifyConnectionChange({
    connected: false,
    device: device || { id: deviceId },
    reason: 'user_disconnect',
    phase: 'disconnected',
  });
}

export async function disconnectBleDevice({ intentional = false } = {}) {
  suppressDisconnectEvent = true;
  setConnectionPhase('disconnecting');
  clearDisconnectMonitoring();
  stopEmgStreamSafely();

  const device = connectedBleDevice;
  const deviceId = connectedDeviceId || device?.id;
  const hadConnection = Boolean(device || deviceId);

  if (!device) {
    connectedDeviceId = null;
    suppressDisconnectEvent = false;
    setConnectionPhase('disconnected');
    if (intentional && hadConnection) {
      emitIntentionalDisconnectEvent(device, deviceId);
    }
    bleLog('Disconnected');
    return;
  }

  try {
    await device.cancelConnection();
  } catch {
  } finally {
    connectedBleDevice = null;
    connectedDeviceId = null;
    suppressDisconnectEvent = false;
    setConnectionPhase('disconnected');
    if (intentional && hadConnection) {
      emitIntentionalDisconnectEvent(device, deviceId);
    }
    bleLog('Disconnected');
  }
}

export function getConnectedBleDevice() {
  return connectedBleDevice;
}

export async function isLiveBleConnected() {
  if (!connectedBleDevice) return false;
  try {
    return await connectedBleDevice.isConnected();
  } catch {
    return false;
  }
}

export function destroyBleManager() {
  clearDisconnectMonitoring();
  connectedDeviceId = null;
  setConnectionPhase('idle');
  if (manager) {
    manager.destroy();
    manager = null;
    connectedBleDevice = null;
  }
}
