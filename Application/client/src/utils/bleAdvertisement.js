/**
 * Real BLE advertisement analysis helpers.
 *
 * Pure functions over data that Android actually delivered in a ScanResult.
 * Nothing here invents devices, names, vendors or packets: every value is
 * either decoded from the advertising payload or derived arithmetically from
 * the peripheral's Bluetooth address.
 *
 * Deliberately dependency-free (no react-native imports) so it can be executed
 * and unit-tested under plain Node during QA.
 */

/* ------------------------------------------------------------------ *
 * Base64 → bytes (works in Hermes, JSC and Node without Buffer)
 * ------------------------------------------------------------------ */

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * @param {string | null | undefined} value base64 string from react-native-ble-plx
 * @returns {number[]} raw bytes (empty array when input is absent/invalid)
 */
export function base64ToBytes(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return [];
  }

  const clean = value.replace(/[^A-Za-z0-9+/=]/g, '');
  const bytes = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    if (char === '=') break;
    const index = B64_ALPHABET.indexOf(char);
    if (index < 0) continue;

    buffer = (buffer << 6) | index;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return bytes;
}

function toHex(byte) {
  return byte.toString(16).padStart(2, '0');
}

/* ------------------------------------------------------------------ *
 * Bluetooth address classification
 * Core Spec v5.3, Vol 6, Part B, §1.3.2 (random device addresses)
 * ------------------------------------------------------------------ */

export const BLE_ADDRESS_TYPE = {
  PUBLIC_OUI_POSSIBLE: 'PUBLIC_OUI_POSSIBLE',
  RANDOM_STATIC: 'RANDOM_STATIC',
  RANDOM_RESOLVABLE_PRIVATE: 'RANDOM_RESOLVABLE_PRIVATE',
  RANDOM_NON_RESOLVABLE_PRIVATE: 'RANDOM_NON_RESOLVABLE_PRIVATE',
  UNKNOWN: 'UNKNOWN',
};

const ADDRESS_LABELS = {
  [BLE_ADDRESS_TYPE.PUBLIC_OUI_POSSIBLE]: 'Public address',
  [BLE_ADDRESS_TYPE.RANDOM_STATIC]: 'Random static address',
  [BLE_ADDRESS_TYPE.RANDOM_RESOLVABLE_PRIVATE]: 'Private (rotating) address',
  [BLE_ADDRESS_TYPE.RANDOM_NON_RESOLVABLE_PRIVATE]: 'Private (anonymous) address',
  [BLE_ADDRESS_TYPE.UNKNOWN]: 'Unknown address format',
};

/**
 * Classify a BLE peripheral address string (`AA:BB:CC:DD:EE:FF`).
 *
 * Android reports privacy-enabled peripherals under randomised addresses that
 * rotate (typically every ~15 minutes). Such a device can never be identified
 * or bonded from the address alone, which is why it also tends to have no name.
 *
 * The two most significant bits of the most significant octet encode the random
 * address sub-type. A genuine IEEE/OUI public address must additionally have the
 * multicast bit (0x01) clear and the locally-administered bit (0x02) clear.
 */
export function classifyBleAddress(id) {
  const parts = String(id || '')
    .trim()
    .split(/[:-]/);

  if (parts.length !== 6 || parts.some((part) => !/^[0-9a-fA-F]{2}$/.test(part))) {
    return {
      type: BLE_ADDRESS_TYPE.UNKNOWN,
      label: ADDRESS_LABELS[BLE_ADDRESS_TYPE.UNKNOWN],
      msb: null,
      topTwoBits: null,
      multicastBit: null,
      locallyAdministeredBit: null,
      couldBePublicOui: false,
      rotating: false,
    };
  }

  const msb = parseInt(parts[0], 16);
  const topTwoBits = (msb >> 6) & 0b11;
  const multicastBit = msb & 0x01;
  const locallyAdministeredBit = (msb & 0x02) >> 1;

  // A routable, IEEE-assigned unicast MAC has both low bits of octet 0 clear.
  const couldBePublicOui = multicastBit === 0 && locallyAdministeredBit === 0;

  let type;
  if (topTwoBits === 0b01) {
    type = BLE_ADDRESS_TYPE.RANDOM_RESOLVABLE_PRIVATE;
  } else if (topTwoBits === 0b00) {
    type = BLE_ADDRESS_TYPE.RANDOM_NON_RESOLVABLE_PRIVATE;
  } else if (topTwoBits === 0b11) {
    type = BLE_ADDRESS_TYPE.RANDOM_STATIC;
  } else {
    // 0b10 is reserved for random addresses, so this is a public address.
    type = BLE_ADDRESS_TYPE.PUBLIC_OUI_POSSIBLE;
  }

  return {
    type,
    label: ADDRESS_LABELS[type],
    msb,
    topTwoBits,
    multicastBit,
    locallyAdministeredBit,
    couldBePublicOui,
    rotating: type === BLE_ADDRESS_TYPE.RANDOM_RESOLVABLE_PRIVATE,
  };
}

/**
 * True when the address cannot possibly be an IEEE-assigned public MAC,
 * i.e. Android is definitely reporting a randomised privacy address.
 */
export function isDefinitelyRandomAddress(id) {
  const info = classifyBleAddress(id);
  if (info.type === BLE_ADDRESS_TYPE.UNKNOWN) return false;
  if (info.type === BLE_ADDRESS_TYPE.PUBLIC_OUI_POSSIBLE) return false;
  return !info.couldBePublicOui;
}

/* ------------------------------------------------------------------ *
 * Advertising Data (AD) structure parsing — Core Spec Vol 3, Part C, §11
 * ------------------------------------------------------------------ */

export const AD_TYPE = {
  FLAGS: 0x01,
  INCOMPLETE_16BIT_UUIDS: 0x02,
  COMPLETE_16BIT_UUIDS: 0x03,
  INCOMPLETE_32BIT_UUIDS: 0x04,
  COMPLETE_32BIT_UUIDS: 0x05,
  INCOMPLETE_128BIT_UUIDS: 0x06,
  COMPLETE_128BIT_UUIDS: 0x07,
  SHORTENED_LOCAL_NAME: 0x08,
  COMPLETE_LOCAL_NAME: 0x09,
  TX_POWER_LEVEL: 0x0a,
  SERVICE_DATA_16BIT: 0x16,
  SERVICE_DATA_32BIT: 0x20,
  SERVICE_DATA_128BIT: 0x21,
  APPEARANCE: 0x19,
  MANUFACTURER_SPECIFIC_DATA: 0xff,
};

/**
 * Split a raw advertising payload into length-type-value structures.
 *
 * @param {number[]} bytes
 * @returns {{ type: number, data: number[] }[]}
 */
export function parseAdStructures(bytes) {
  const structures = [];
  if (!Array.isArray(bytes)) return structures;

  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes[offset];

    // Length 0 is the standard "end of significant data" padding marker.
    if (!length) break;
    if (offset + length >= bytes.length + 1) break;

    const type = bytes[offset + 1];
    if (type === undefined) break;

    structures.push({
      type,
      data: bytes.slice(offset + 2, offset + 1 + length),
    });

    offset += length + 1;
  }

  return structures;
}

/** GAP flags bitfield (AD type 0x01). */
export function decodeAdFlags(byte) {
  if (typeof byte !== 'number') return null;
  return {
    raw: byte,
    leLimitedDiscoverable: Boolean(byte & 0x01),
    leGeneralDiscoverable: Boolean(byte & 0x02),
    brEdrNotSupported: Boolean(byte & 0x04),
    simultaneousLeBrEdrController: Boolean(byte & 0x08),
    simultaneousLeBrEdrHost: Boolean(byte & 0x10),
  };
}

/* ------------------------------------------------------------------ *
 * Bluetooth SIG assigned numbers (only high-confidence entries)
 * ------------------------------------------------------------------ */

/** Company Identifiers seen in Manufacturer Specific Data (AD type 0xFF). */
export const COMPANY_IDS = {
  0x0006: 'Microsoft',
  0x000d: 'Texas Instruments',
  0x000f: 'Broadcom',
  0x0030: 'STMicroelectronics',
  0x004c: 'Apple, Inc.',
  0x0059: 'Nordic Semiconductor',
  0x0075: 'Samsung Electronics',
  0x0087: 'Garmin International',
  0x00e0: 'Google',
  0x0131: 'Cypress Semiconductor',
  0x0157: 'Anhui Huami (Xiaomi wearables)',
  0x0171: 'Amazon',
  0x027d: 'Huawei Technologies',
  0x02e5: 'Espressif Incorporated',
  0x038f: 'Xiaomi Inc.',
};

/** 16-bit service UUIDs commonly used by phone/OS background beacons. */
export const WELL_KNOWN_16BIT_SERVICES = {
  0x180a: 'Device Information',
  0xfd6f: 'Exposure Notification beacon',
  0xfe2c: 'Google Fast Pair',
  0xfe59: 'Nordic DFU',
  0xfeec: 'Tile tracker',
  0xfeed: 'Tile tracker',
  0xfef3: 'Google',
};

export function describeCompanyId(companyId) {
  if (typeof companyId !== 'number') return null;
  return (
    COMPANY_IDS[companyId] ||
    `Unregistered/unknown vendor (0x${companyId.toString(16).padStart(4, '0')})`
  );
}

/* ------------------------------------------------------------------ *
 * Advertisement summary
 * ------------------------------------------------------------------ */

export const UNNAMED_BLE_LABEL = 'Unnamed BLE device';

/**
 * Why a discovered peripheral has no human-readable name.
 */
export const UNNAMED_REASON = {
  NAMED: 'NAMED',
  NO_NAME_IN_ADVERTISEMENT: 'NO_NAME_IN_ADVERTISEMENT',
  PRIVACY_BEACON: 'PRIVACY_BEACON',
  NAME_PENDING_SCAN_RESPONSE: 'NAME_PENDING_SCAN_RESPONSE',
};

/**
 * Build a factual description of one scan result.
 *
 * @param {object} device react-native-ble-plx Device from a scan callback
 * @param {{ advertisementsSeen?: number }} [context]
 */
export function summarizeAdvertisement(device, context = {}) {
  const advertisementsSeen = context.advertisementsSeen ?? 1;

  const rawBytes = base64ToBytes(device?.rawScanRecord);
  const structures = parseAdStructures(rawBytes);

  const flagsStructure = structures.find((s) => s.type === AD_TYPE.FLAGS);
  const flags = flagsStructure ? decodeAdFlags(flagsStructure.data[0]) : null;

  // Manufacturer Specific Data: first two octets are the SIG company ID (LE).
  const companyIds = [];
  const manufacturerStructures = structures.filter(
    (s) => s.type === AD_TYPE.MANUFACTURER_SPECIFIC_DATA
  );
  manufacturerStructures.forEach((s) => {
    if (s.data.length >= 2) {
      companyIds.push(s.data[0] | (s.data[1] << 8));
    }
  });

  // Fall back to the library's pre-extracted manufacturerData when the raw
  // scan record is unavailable (older Android paths / iOS).
  if (companyIds.length === 0 && device?.manufacturerData) {
    const mfgBytes = base64ToBytes(device.manufacturerData);
    if (mfgBytes.length >= 2) {
      companyIds.push(mfgBytes[0] | (mfgBytes[1] << 8));
    }
  }

  const vendors = companyIds.map(describeCompanyId).filter(Boolean);

  // 16-bit service UUIDs from the raw payload (useful beacon fingerprints).
  const shortServiceUuids = [];
  structures
    .filter(
      (s) =>
        s.type === AD_TYPE.COMPLETE_16BIT_UUIDS ||
        s.type === AD_TYPE.INCOMPLETE_16BIT_UUIDS
    )
    .forEach((s) => {
      for (let i = 0; i + 1 < s.data.length; i += 2) {
        shortServiceUuids.push(s.data[i] | (s.data[i + 1] << 8));
      }
    });

  const serviceDataUuids = Object.keys(device?.serviceData || {});
  const advertisedServiceUuids = Array.isArray(device?.serviceUUIDs)
    ? device.serviceUUIDs
    : [];

  const nameFromAd = structures.find(
    (s) =>
      s.type === AD_TYPE.COMPLETE_LOCAL_NAME || s.type === AD_TYPE.SHORTENED_LOCAL_NAME
  );

  const advertisedName =
    (typeof device?.name === 'string' && device.name.trim()) ||
    (typeof device?.localName === 'string' && device.localName.trim()) ||
    '';

  const address = classifyBleAddress(device?.id);

  let nameSource = null;
  if (advertisedName) {
    nameSource =
      nameFromAd?.type === AD_TYPE.COMPLETE_LOCAL_NAME
        ? 'advertisement'
        : nameFromAd?.type === AD_TYPE.SHORTENED_LOCAL_NAME
          ? 'advertisement (shortened)'
          : 'scan response';
  }

  let unnamedReason = UNNAMED_REASON.NAMED;
  if (!advertisedName) {
    if (address.rotating || isDefinitelyRandomAddress(device?.id)) {
      unnamedReason = UNNAMED_REASON.PRIVACY_BEACON;
    } else if (advertisementsSeen <= 1) {
      unnamedReason = UNNAMED_REASON.NAME_PENDING_SCAN_RESPONSE;
    } else {
      unnamedReason = UNNAMED_REASON.NO_NAME_IN_ADVERTISEMENT;
    }
  }

  const hasGattIdentity =
    advertisedServiceUuids.length > 0 ||
    shortServiceUuids.length > 0 ||
    serviceDataUuids.length > 0;

  // react-native-ble-plx DOES populate isConnectable on Android (the "[iOS only]"
  // note in its Device docs is stale): the native mapper sets it from
  // rxScanResult.isConnectable() == CONNECTABLE, which comes from
  // android.bluetooth.le.ScanResult#isConnectable() (API 26+). When present it is
  // the authoritative statement of whether the advertising PDU is connectable.
  const connectabilityKnown = typeof device?.isConnectable === 'boolean';
  const isConnectable = connectabilityKnown ? device.isConnectable : null;

  // Any random private address (resolvable or non-resolvable) is anonymous.
  const anonymousAddress =
    address.type === BLE_ADDRESS_TYPE.RANDOM_RESOLVABLE_PRIVATE ||
    address.type === BLE_ADDRESS_TYPE.RANDOM_NON_RESOLVABLE_PRIVATE;

  const isAnonymousBroadcast =
    isConnectable === false ||
    (!advertisedName && !hasGattIdentity && anonymousAddress);

  return {
    hasName: Boolean(advertisedName),
    name: advertisedName || UNNAMED_BLE_LABEL,
    nameSource,
    unnamedReason,
    address,
    anonymousAddress,
    isAnonymousBroadcast,
    flags,
    connectabilityKnown,
    isConnectable,
    companyIds,
    vendors,
    vendorLabel: vendors[0] || null,
    shortServiceUuids,
    shortServiceLabels: shortServiceUuids
      .map((uuid) => WELL_KNOWN_16BIT_SERVICES[uuid])
      .filter(Boolean),
    advertisedServiceUuids,
    serviceDataUuids,
    hasGattIdentity,
    rawScanRecordBytes: rawBytes.length,
    rawScanRecordHex: rawBytes.map(toHex).join(' '),
    txPowerLevel: typeof device?.txPowerLevel === 'number' ? device.txPowerLevel : null,
    advertisementsSeen,
  };
}

/**
 * Human-readable, evidence-based explanation of what a peripheral looks like.
 * Used by the UI so unnamed rows never look like fabricated entries.
 */
export function describeUnnamedDevice(summary) {
  if (!summary) return '';

  if (summary.hasName) {
    return summary.nameSource ? `Name from ${summary.nameSource}` : '';
  }

  const vendor = summary.vendorLabel;
  const beacon = summary.shortServiceLabels[0];

  if (beacon) {
    return `No name advertised — ${beacon}`;
  }
  if (vendor && summary.address.rotating) {
    return `No name advertised — ${vendor} privacy beacon (rotating address)`;
  }
  if (vendor) {
    return `No name advertised — vendor data from ${vendor}`;
  }
  if (summary.unnamedReason === UNNAMED_REASON.PRIVACY_BEACON) {
    return 'No name advertised — privacy-randomised address';
  }
  if (summary.unnamedReason === UNNAMED_REASON.NAME_PENDING_SCAN_RESPONSE) {
    return 'No name yet — waiting for scan response';
  }
  return 'No name in advertisement';
}

/* ------------------------------------------------------------------ *
 * ESP32 / NUS signal detection (diagnostic)
 * ------------------------------------------------------------------ */

const NUS_SERVICE_UUID_16_PREFIX = '6e400001';

/**
 * Look for any trace of the target ESP32 in one raw scan result, without
 * assuming which field it will show up in.
 *
 * Checks the name, the local name, advertised service UUIDs, service-data keys,
 * the raw scan record bytes (as text and as hex), and the Espressif company ID.
 * Returns null when there is no trace at all.
 */
export function detectEsp32Signals(device, expectedName = 'ESP32_BT_Device') {
  const hits = [];

  const name = typeof device?.name === 'string' ? device.name : '';
  const localName = typeof device?.localName === 'string' ? device.localName : '';
  const wantedName = expectedName.toLowerCase();

  if (name.toLowerCase().includes(wantedName)) hits.push(`name="${name}"`);
  if (localName.toLowerCase().includes(wantedName)) hits.push(`localName="${localName}"`);
  if (/esp32/i.test(name) || /esp32/i.test(localName)) {
    hits.push(`esp32-like name="${name || localName}"`);
  }

  const uuids = Array.isArray(device?.serviceUUIDs) ? device.serviceUUIDs : [];
  uuids.forEach((uuid) => {
    if (String(uuid).toLowerCase().startsWith(NUS_SERVICE_UUID_16_PREFIX)) {
      hits.push(`advertised NUS serviceUUID=${uuid}`);
    }
  });

  Object.keys(device?.serviceData || {}).forEach((uuid) => {
    if (String(uuid).toLowerCase().startsWith(NUS_SERVICE_UUID_16_PREFIX)) {
      hits.push(`NUS in serviceData=${uuid}`);
    }
  });

  const rawBytes = base64ToBytes(device?.rawScanRecord);
  if (rawBytes.length) {
    const asText = rawBytes
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('');
    if (asText.toLowerCase().includes(wantedName)) {
      hits.push('expected name present in raw scan record');
    }

    // NUS UUID appears little-endian (reversed) in the AD structure.
    const hex = rawBytes.map(toHex).join('');
    if (hex.includes('9ecadc240ee5a9e093f3a3b501004' + '06e')) {
      hits.push('NUS UUID bytes present in raw scan record');
    }
  }

  if (Array.isArray(device?.manufacturerData) === false && device?.manufacturerData) {
    const mfg = base64ToBytes(device.manufacturerData);
    if (mfg.length >= 2 && (mfg[0] | (mfg[1] << 8)) === 0x02e5) {
      hits.push('Espressif company ID (0x02E5) in manufacturer data');
    }
  }

  return hits.length ? hits : null;
}

/**
 * Every field react-native-ble-plx gives us for a scan result, untransformed.
 * Intended for development logging only.
 */
export function rawScanResultSnapshot(device) {
  return {
    id: device?.id ?? null,
    name: device?.name ?? null,
    localName: device?.localName ?? null,
    rssi: device?.rssi ?? null,
    mtu: device?.mtu ?? null,
    isConnectable: device?.isConnectable ?? null,
    txPowerLevel: device?.txPowerLevel ?? null,
    serviceUUIDs: device?.serviceUUIDs ?? null,
    solicitedServiceUUIDs: device?.solicitedServiceUUIDs ?? null,
    overflowServiceUUIDs: device?.overflowServiceUUIDs ?? null,
    manufacturerData: device?.manufacturerData ?? null,
    serviceData: device?.serviceData ?? null,
    rawScanRecord: device?.rawScanRecord ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Advertising payload budget (Core Spec Vol 3, Part C, §11)
 * ------------------------------------------------------------------ */

/** Maximum payload of a legacy (non-extended) advertising PDU. */
export const LEGACY_ADV_PAYLOAD_MAX = 31;

/**
 * Compute the byte cost of an advertising payload.
 *
 * Used to check whether a peripheral configuration can physically fit in one
 * legacy advertising PDU. Each AD structure costs 1 length byte + 1 type byte +
 * its data.
 */
export function advertisingPayloadCost({
  flags = false,
  txPower = false,
  name = null,
  uuid128Count = 0,
  uuid16Count = 0,
  manufacturerDataLength = 0,
} = {}) {
  const items = [];

  if (flags) items.push({ field: 'Flags (0x01)', bytes: 3 });
  if (txPower) items.push({ field: 'TX Power Level (0x0A)', bytes: 3 });
  if (uuid128Count > 0) {
    items.push({
      field: `Complete 128-bit Service UUIDs (0x07) x${uuid128Count}`,
      bytes: 2 + 16 * uuid128Count,
    });
  }
  if (uuid16Count > 0) {
    items.push({
      field: `Complete 16-bit Service UUIDs (0x03) x${uuid16Count}`,
      bytes: 2 + 2 * uuid16Count,
    });
  }
  if (name) {
    items.push({ field: `Complete Local Name (0x09) "${name}"`, bytes: 2 + name.length });
  }
  if (manufacturerDataLength > 0) {
    items.push({
      field: 'Manufacturer Specific Data (0xFF)',
      bytes: 2 + manufacturerDataLength,
    });
  }

  const total = items.reduce((sum, item) => sum + item.bytes, 0);

  return {
    items,
    total,
    limit: LEGACY_ADV_PAYLOAD_MAX,
    fits: total <= LEGACY_ADV_PAYLOAD_MAX,
    overflowBy: Math.max(0, total - LEGACY_ADV_PAYLOAD_MAX),
  };
}

/* ------------------------------------------------------------------ *
 * Discovery policy
 * ------------------------------------------------------------------ */

export const DEVICE_RELEVANCE = {
  EMG_CANDIDATE: 'EMG_CANDIDATE',
  NAMED_PERIPHERAL: 'NAMED_PERIPHERAL',
  IDENTIFIABLE_PERIPHERAL: 'IDENTIFIABLE_PERIPHERAL',
  BACKGROUND_BEACON: 'BACKGROUND_BEACON',
};

/** Espressif Systems — the ESP32 vendor. */
export const ESPRESSIF_COMPANY_ID = 0x02e5;

/**
 * Decide whether a scan result is useful in the default device picker.
 *
 * This never removes the ESP32 and never removes named peripherals. It only
 * demotes anonymous OS/phone background beacons (rotating address, no name, no
 * GATT identity) which cannot be bonded and are pure discovery noise.
 *
 * Belt-and-braces for the ESP32: even if its name has not yet arrived in the
 * scan response and its service UUID were somehow absent, Espressif vendor data
 * still keeps it visible.
 */
export function classifyRelevance(summary, { isEmgCandidate = false } = {}) {
  if (isEmgCandidate) return DEVICE_RELEVANCE.EMG_CANDIDATE;
  if (summary?.hasName) return DEVICE_RELEVANCE.NAMED_PERIPHERAL;

  // Android explicitly told us this PDU is non-connectable, and it carries no
  // name. It can never become an EMG device, whatever else it advertises.
  if (summary?.isConnectable === false && !summary?.hasName) {
    return DEVICE_RELEVANCE.BACKGROUND_BEACON;
  }

  if (summary?.hasGattIdentity) return DEVICE_RELEVANCE.IDENTIFIABLE_PERIPHERAL;
  if (summary?.companyIds?.includes(ESPRESSIF_COMPANY_ID)) {
    return DEVICE_RELEVANCE.IDENTIFIABLE_PERIPHERAL;
  }
  return DEVICE_RELEVANCE.BACKGROUND_BEACON;
}

/* ------------------------------------------------------------------ *
 * Connection outcome categories (QA taxonomy)
 * ------------------------------------------------------------------ */

export const CONNECT_FAILURE = {
  NON_CONNECTABLE_ADVERTISEMENT: 'NON_CONNECTABLE_ADVERTISEMENT',
  NO_GATT_SERVICE: 'NO_GATT_SERVICE',
  GATT_CONNECTION_FAILED: 'GATT_CONNECTION_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  DEVICE_DISAPPEARED: 'DEVICE_DISAPPEARED',
  NOT_EMG_DEVICE: 'NOT_EMG_DEVICE',
  NO_EMG_DATA: 'NO_EMG_DATA',
  OTHER: 'OTHER',
};

export const CONNECT_FAILURE_LABELS = {
  [CONNECT_FAILURE.NON_CONNECTABLE_ADVERTISEMENT]: 'Broadcast only — cannot connect',
  [CONNECT_FAILURE.NO_GATT_SERVICE]: 'No GATT services exposed',
  [CONNECT_FAILURE.GATT_CONNECTION_FAILED]: 'Refused the connection',
  [CONNECT_FAILURE.PERMISSION_DENIED]: 'Permission denied',
  [CONNECT_FAILURE.OUT_OF_RANGE]: 'Out of range',
  [CONNECT_FAILURE.DEVICE_DISAPPEARED]: 'Stopped advertising',
  [CONNECT_FAILURE.NOT_EMG_DEVICE]: 'Not an EMG device',
  [CONNECT_FAILURE.NO_EMG_DATA]: 'Connected, no EMG data',
  [CONNECT_FAILURE.OTHER]: 'Connection failed',
};

/**
 * Map a real react-native-ble-plx / Android GATT failure onto a QA category.
 *
 * Android status codes that matter here:
 *   133 (0x85) GATT_ERROR      — generic failure; overwhelmingly what a
 *                                privacy beacon or non-connectable advertiser
 *                                returns when a central tries to connect
 *   8   (0x08) CONN_TIMEOUT    — link supervision timeout / went away
 *   22  (0x16) CONN_TERMINATE_LOCAL_HOST
 *   19  (0x13) REMOTE_USER_TERMINATED
 *   62  (0x3E) CONN_FAIL_ESTABLISH
 *   147            device not found in the scan cache
 */
export function categorizeConnectFailure(error, summary = null) {
  const raw = String(error?.message || error || '');
  const lower = raw.toLowerCase();
  const errorCode = error?.errorCode ?? null;
  const androidCode = error?.androidErrorCode ?? null;

  // Strongest possible evidence: Android told us the advertisement itself was
  // non-connectable. No GATT status can override that.
  if (summary?.isConnectable === false) {
    return CONNECT_FAILURE.NON_CONNECTABLE_ADVERTISEMENT;
  }

  if (lower.includes('permission') || lower.includes('unauthorized')) {
    return CONNECT_FAILURE.PERMISSION_DENIED;
  }
  if (lower.includes('no emg data') || lower.includes('no emg packet')) {
    return CONNECT_FAILURE.NO_EMG_DATA;
  }
  if (
    lower.includes('not a compatible emg') ||
    lower.includes('compatible emg') ||
    lower.includes('notify characteristic') ||
    lower.includes('write characteristic')
  ) {
    return CONNECT_FAILURE.NOT_EMG_DEVICE;
  }
  if (lower.includes('services') && lower.includes('not discovered')) {
    return CONNECT_FAILURE.NO_GATT_SERVICE;
  }
  if (
    lower.includes('not found') ||
    lower.includes('cannot find') ||
    androidCode === 147
  ) {
    return CONNECT_FAILURE.DEVICE_DISAPPEARED;
  }
  if (androidCode === 8 || androidCode === 62 || lower.includes('timeout') || lower.includes('timed out')) {
    return CONNECT_FAILURE.OUT_OF_RANGE;
  }

  // Generic GATT 133 on an anonymous broadcaster is the classic signature of a
  // non-connectable advertisement. Both resolvable and non-resolvable private
  // addresses count as anonymous here.
  const looksAnonymousBeacon = Boolean(
    summary &&
      !summary.hasName &&
      !summary.hasGattIdentity &&
      (summary.isAnonymousBroadcast || summary.anonymousAddress || summary.address?.rotating)
  );

  if (androidCode === 133 || lower.includes('gatt') || errorCode === 201 || errorCode === 300) {
    return looksAnonymousBeacon
      ? CONNECT_FAILURE.NON_CONNECTABLE_ADVERTISEMENT
      : CONNECT_FAILURE.GATT_CONNECTION_FAILED;
  }

  if (lower.includes('disconnect') || lower.includes('was cancelled')) {
    return looksAnonymousBeacon
      ? CONNECT_FAILURE.NON_CONNECTABLE_ADVERTISEMENT
      : CONNECT_FAILURE.GATT_CONNECTION_FAILED;
  }

  return CONNECT_FAILURE.OTHER;
}
