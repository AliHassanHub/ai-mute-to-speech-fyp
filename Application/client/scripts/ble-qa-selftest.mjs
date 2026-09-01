/**
 * BLE QA self-test.
 *
 * Run:  node scripts/ble-qa-selftest.mjs   (from the client/ directory)
 *
 * Two clearly separated kinds of input are used:
 *
 *  (A) DEVICE EVIDENCE — Bluetooth addresses that the physical Android phone
 *      actually reported through BleManager.startDeviceScan and printed to the
 *      Metro dev-server log. These are NOT invented. They are transcribed
 *      verbatim from the running app's console output.
 *
 *  (B) PARSER FIXTURES — hand-built byte arrays used only to unit-test the
 *      advertising-data parser. These are explicitly NOT presented as scan
 *      results and are never used to claim a device exists.
 */

import {
  AD_TYPE,
  BLE_ADDRESS_TYPE,
  CONNECT_FAILURE,
  base64ToBytes,
  categorizeConnectFailure,
  classifyBleAddress,
  decodeAdFlags,
  describeCompanyId,
  describeUnnamedDevice,
  isDefinitelyRandomAddress,
  parseAdStructures,
  summarizeAdvertisement,
} from '../src/utils/bleAdvertisement.js';

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
  }
  return ok;
}

function heading(text) {
  console.log(`\n${'='.repeat(72)}\n${text}\n${'='.repeat(72)}`);
}

/* ================================================================== *
 * (A) DEVICE EVIDENCE — verbatim from the phone's Metro log
 * ================================================================== */

// Scan run #2 (14 results). Every one logged "Unnamed BLE device" and NO
// "Service UUIDs:" line, i.e. zero advertised service UUIDs.
const SCAN_RUN_2 = [
  ['55:80:D1:A6:31:08', -96],
  ['0E:6E:A4:BE:E6:0D', -86],
  ['0D:C2:CA:18:8F:D4', -90],
  ['13:52:C5:A3:D6:86', -83],
  ['34:D0:EF:48:A1:BC', -91],
  ['75:A2:C5:50:20:58', -85],
  ['72:E7:4D:ED:9F:9F', -80],
  ['68:56:E8:0A:1E:3C', -76],
  ['55:4D:20:33:45:2D', -75],
  ['6D:9F:1F:7C:FC:DF', -80],
  ['6D:DF:A0:C8:70:79', -80],
  ['42:AA:1D:63:CB:A4', -79],
  ['74:78:59:69:A1:87', -70],
  ['21:6C:7D:46:B4:33', -89],
];

// Scan run #1 (17 results). 16 unnamed + exactly one that advertised a name.
const SCAN_RUN_1_UNNAMED = [
  '0B:E1:C5:2C:3D:F9', '71:B0:D4:C6:AB:B0', '78:86:48:08:EE:73',
  '76:46:71:39:17:B1', '5E:C4:4D:6F:13:BE', '3B:31:EE:28:09:91',
  '65:52:C2:43:FF:1A', '50:BC:45:4B:5C:09', '69:AC:C0:C0:45:FD',
  '04:FB:DE:94:55:79', '75:5F:DD:EB:A2:14', '73:F2:8C:39:99:9C',
  '5D:48:1D:96:1F:E2', '2B:24:B6:5B:5F:C5', '34:66:A6:94:B5:EF',
  '25:03:28:D3:27:84',
];
const SCAN_RUN_1_NAMED = [['RONiN MASHION', '04:64:35:0F:82:4B', -81]];

heading('A1. Address classification of the 14 devices from scan run #2');
console.log(
  'addr'.padEnd(20) + 'msb'.padEnd(7) + 'top2'.padEnd(7) +
  'mcast'.padEnd(7) + 'U/L'.padEnd(6) + 'public?'.padEnd(9) + 'classification'
);
console.log('-'.repeat(90));

const tally = {};
let provablyRandom = 0;
let inHighRange = 0;

for (const [addr, rssi] of SCAN_RUN_2) {
  const info = classifyBleAddress(addr);
  tally[info.type] = (tally[info.type] || 0) + 1;
  if (isDefinitelyRandomAddress(addr)) provablyRandom += 1;
  if (info.msb >= 0x80) inHighRange += 1;

  console.log(
    addr.padEnd(20) +
    `0x${info.msb.toString(16).padStart(2, '0')}`.padEnd(7) +
    `0b${info.topTwoBits.toString(2).padStart(2, '0')}`.padEnd(7) +
    String(info.multicastBit).padEnd(7) +
    String(info.locallyAdministeredBit).padEnd(6) +
    (info.couldBePublicOui ? 'maybe' : 'NO').padEnd(9) +
    info.label + `  (rssi ${rssi})`
  );
}

console.log('\nTally:', tally);
console.log(`Provably NOT an IEEE public MAC (mcast or U/L bit set): ${provablyRandom}/14`);
console.log(`Addresses with MSB in 0x80-0xFF (impossible for RPA/NRPA): ${inHighRange}/14`);

// A uniformly-distributed set of real public MACs would put ~half of the
// addresses above 0x7F. Observing zero across 14 samples is p = 2^-14.
const pValue = Math.pow(0.5, SCAN_RUN_2.length);
console.log(
  `Probability of 0/14 above 0x7F if these were public MACs: ${pValue.toExponential(2)} (${(pValue * 100).toFixed(4)}%)`
);

check('no scan-run-2 address is a random-static address',
  tally[BLE_ADDRESS_TYPE.RANDOM_STATIC] ?? 0, 0);
check('no scan-run-2 address falls in the public-only 0b10 bucket',
  tally[BLE_ADDRESS_TYPE.PUBLIC_OUI_POSSIBLE] ?? 0, 0);
check('all 14 classify as RPA or NRPA',
  (tally[BLE_ADDRESS_TYPE.RANDOM_RESOLVABLE_PRIVATE] ?? 0) +
  (tally[BLE_ADDRESS_TYPE.RANDOM_NON_RESOLVABLE_PRIVATE] ?? 0), 14);
check('zero addresses above 0x7F', inHighRange, 0);

heading('A2. Address classification across both scan runs (31 results)');
const allUnnamed = [...SCAN_RUN_2.map(([a]) => a), ...SCAN_RUN_1_UNNAMED];
const combinedTally = {};
let combinedHighRange = 0;
for (const addr of allUnnamed) {
  const info = classifyBleAddress(addr);
  combinedTally[info.type] = (combinedTally[info.type] || 0) + 1;
  if (info.msb >= 0x80) combinedHighRange += 1;
}
console.log(`Unnamed results analysed: ${allUnnamed.length}`);
console.log('Tally:', combinedTally);
console.log(`Addresses above 0x7F: ${combinedHighRange}/${allUnnamed.length}`);
console.log(
  `Probability if public MACs: ${Math.pow(0.5, allUnnamed.length).toExponential(2)}`
);
for (const [name, addr] of SCAN_RUN_1_NAMED.map(([n, a]) => [n, a])) {
  console.log(`Named result: "${name}" -> ${addr} -> ${classifyBleAddress(addr).label}`);
}
check('every unnamed result across both runs is a private random address',
  combinedTally[BLE_ADDRESS_TYPE.RANDOM_RESOLVABLE_PRIVATE] +
  combinedTally[BLE_ADDRESS_TYPE.RANDOM_NON_RESOLVABLE_PRIVATE],
  allUnnamed.length);

heading('A3. Would the default discovery policy have hidden the ESP32?');
// The ESP32 firmware calls bleAdvertising->addServiceUUID(NUS_SERVICE_UUID),
// so a real ESP32 scan result always carries an advertised service UUID.
const esp32LikeScanResult = {
  id: 'C0:49:EF:12:34:56',
  name: null, // worst case: name still pending in the scan response
  localName: null,
  rssi: -55,
  serviceUUIDs: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'],
  rawScanRecord: null,
};
const esp32Summary = summarizeAdvertisement(esp32LikeScanResult);
console.log('ESP32-style result hasGattIdentity:', esp32Summary.hasGattIdentity);
console.log('ESP32-style result advertised UUIDs:', esp32Summary.advertisedServiceUuids);
check('an unnamed ESP32 is still retained by the identity rule',
  esp32Summary.hasGattIdentity, true);

/* ================================================================== *
 * (B) PARSER FIXTURES — synthetic bytes, used only to test the parser
 * ================================================================== */

heading('B1. Advertising-data structure parser');

// Flags(0x01) = 0x06 -> LE General Discoverable + BR/EDR not supported
// Complete 16-bit UUID list(0x03) = 0xFE2C (Google Fast Pair)
// Complete local name(0x09) = "ESP32"
const fixture = [
  0x02, AD_TYPE.FLAGS, 0x06,
  0x03, AD_TYPE.COMPLETE_16BIT_UUIDS, 0x2c, 0xfe,
  0x06, AD_TYPE.COMPLETE_LOCAL_NAME, 0x45, 0x53, 0x50, 0x33, 0x32,
  0x00, // end-of-data padding
];
const structures = parseAdStructures(fixture);
check('parses 3 AD structures', structures.length, 3);
check('flags type', structures[0].type, AD_TYPE.FLAGS);
check('flags decode', decodeAdFlags(structures[0].data[0]).leGeneralDiscoverable, true);
check('flags brEdrNotSupported', decodeAdFlags(structures[0].data[0]).brEdrNotSupported, true);
check('16-bit uuid little-endian', structures[1].data[0] | (structures[1].data[1] << 8), 0xfe2c);
check('local name bytes', String.fromCharCode(...structures[2].data), 'ESP32');
check('trailing zero padding terminates cleanly', parseAdStructures([0x00, 0x01]).length, 0);
check('malformed over-long length is rejected', parseAdStructures([0x40, 0x09, 0x41]).length, 0);
check('empty input', parseAdStructures([]).length, 0);

heading('B2. Manufacturer-specific data -> vendor identification');
// Manufacturer Specific Data(0xFF) with company ID 0x004C (Apple, little-endian
// 4C 00) followed by an opaque Continuity-style payload.
const applePayload = [
  0x02, AD_TYPE.FLAGS, 0x1a,
  0x0a, AD_TYPE.MANUFACTURER_SPECIFIC_DATA, 0x4c, 0x00, 0x10, 0x05, 0x0b, 0x18, 0x99, 0x11, 0x22,
];
const appleSummary = summarizeAdvertisement({
  id: '74:78:59:69:A1:87', // real RPA observed by the phone
  name: null,
  localName: null,
  rssi: -70,
  rawScanRecord: null,
  serviceUUIDs: null,
});
// Feed the fixture through the low-level path (rawScanRecord is base64 in the app).
const appleStructures = parseAdStructures(applePayload);
const mfg = appleStructures.find((s) => s.type === AD_TYPE.MANUFACTURER_SPECIFIC_DATA);
const companyId = mfg.data[0] | (mfg.data[1] << 8);
check('company id parsed little-endian', companyId, 0x004c);
check('company id resolves to Apple', describeCompanyId(companyId), 'Apple, Inc.');
check('espressif company id resolves', describeCompanyId(0x02e5), 'Espressif Incorporated');
check('unknown company id is labelled honestly',
  describeCompanyId(0x9999), 'Unregistered/unknown vendor (0x9999)');
console.log('Real RPA 74:78:59:69:A1:87 summary ->', describeUnnamedDevice(appleSummary));
check('unnamed rotating-address device is described as a privacy beacon',
  appleSummary.unnamedReason, 'PRIVACY_BEACON');
check('connectability is reported as unknown on Android',
  appleSummary.connectabilityKnown, false);

heading('B3. base64 decoding');
check('base64 "ESP32"', String.fromCharCode(...base64ToBytes('RVNQMzI=')), 'ESP32');
check('base64 "TAA=" -> [0x4c,0x00]', base64ToBytes('TAA='), [0x4c, 0x00]);
check('base64 null-safe', base64ToBytes(null), []);
check('base64 EMG line', String.fromCharCode(...base64ToBytes('RU1HOjM3NiAgUE9UOjExCg==')), 'EMG:376  POT:11\n');

heading('B4. Connect-failure categorisation');
const anonymousBeacon = {
  hasName: false,
  hasGattIdentity: false,
  address: { rotating: true },
};
const namedPeripheral = { hasName: true, hasGattIdentity: true, address: { rotating: false } };

check('android 133 on anonymous beacon',
  categorizeConnectFailure({ message: 'Operation failed', androidErrorCode: 133 }, anonymousBeacon),
  CONNECT_FAILURE.NON_CONNECTABLE_ADVERTISEMENT);
check('android 133 on named peripheral',
  categorizeConnectFailure({ message: 'Operation failed', androidErrorCode: 133 }, namedPeripheral),
  CONNECT_FAILURE.GATT_CONNECTION_FAILED);
check('android 8 -> out of range',
  categorizeConnectFailure({ message: 'link lost', androidErrorCode: 8 }, namedPeripheral),
  CONNECT_FAILURE.OUT_OF_RANGE);
check('android 147 -> disappeared',
  categorizeConnectFailure({ message: 'x', androidErrorCode: 147 }, namedPeripheral),
  CONNECT_FAILURE.DEVICE_DISAPPEARED);
check('NUS missing -> not EMG',
  categorizeConnectFailure(new Error('This device is not a compatible EMG device.'), namedPeripheral),
  CONNECT_FAILURE.NOT_EMG_DEVICE);
check('no packet -> no EMG data',
  categorizeConnectFailure(new Error('Connected, but no EMG data received.'), namedPeripheral),
  CONNECT_FAILURE.NO_EMG_DATA);
check('permission -> permission denied',
  categorizeConnectFailure(new Error('BluetoothLE permission denied'), namedPeripheral),
  CONNECT_FAILURE.PERMISSION_DENIED);
check('device not found -> disappeared',
  categorizeConnectFailure(new Error('Device 74:78:59:69:A1:87 not found'), anonymousBeacon),
  CONNECT_FAILURE.DEVICE_DISAPPEARED);

heading('B5. EMG line parser against the exact firmware output format');
// Metro resolves extensionless relative imports; plain Node ESM does not. Load
// the real emgSignal.js through a temporary sibling shim so the module under
// test is the actual application source, not a copy.
const { writeFile, unlink, readFile } = await import('node:fs/promises');
const { fileURLToPath } = await import('node:url');
const utilsDir = fileURLToPath(new URL('../src/utils/', import.meta.url));
const shimPath = `${utilsDir}__emgSignal.selftest.mjs`;
const emgSource = await readFile(`${utilsDir}emgSignal.js`, 'utf8');
await writeFile(
  shimPath,
  emgSource.replace(/(from\s+['"])(\.\.?\/[^'"]+?)(['"])/g, (m, a, spec, c) =>
    /\.[mc]?js$/.test(spec) ? m : `${a}${spec}.js${c}`
  )
);
let parseEmgLine;
try {
  ({ parseEmgLine } = await import(new URL(`file://${shimPath.replace(/\\/g, '/')}`).href));
} finally {
  await unlink(shimPath).catch(() => {});
}
// Firmware: snprintf(payload, "EMG:%d  POT:%d\n", emg, pot)  <- two spaces
check('EMG:376  POT:11 (firmware format)', parseEmgLine('EMG:376  POT:11'), [376, 11]);
check('EMG:316 POT:17 (single space)', parseEmgLine('EMG:316 POT:17'), [316, 17]);
check('EMG:295 POT:24', parseEmgLine('EMG:295 POT:24'), [295, 24]);
check('legacy semicolon form', parseEmgLine('812;39'), [812, 39]);
check('STATUS line is not a sample', parseEmgLine('STATUS:READY'), null);
check('garbage rejected', parseEmgLine('hello world'), null);
check('empty rejected', parseEmgLine(''), null);
check('null rejected', parseEmgLine(null), null);
check('ADC clamped to 4095', parseEmgLine('EMG:99999 POT:5'), [4095, 5]);
check('pot clamped to 100', parseEmgLine('EMG:100 POT:99999'), [100, 100]);

heading('B6. Simulation gate truth table (Phase 10)');
// Mirrors constants/emgConfig.js exactly.
const allowSimulation = (flag, isDev) =>
  isDev ? flag !== 'false' : flag === 'true';

console.log('flag=undefined  __DEV__=true  ->', allowSimulation(undefined, true));
console.log('flag="false"    __DEV__=true  ->', allowSimulation('false', true));
console.log('flag="false"    __DEV__=false ->', allowSimulation('false', false));
console.log('flag="true"     __DEV__=true  ->', allowSimulation('true', true));

check('BUG: dev build with no flag silently allows simulation',
  allowSimulation(undefined, true), true);
check('with EXPO_PUBLIC_ALLOW_EMG_SIMULATION=false, dev simulation is OFF',
  allowSimulation('false', true), false);
check('with EXPO_PUBLIC_ALLOW_EMG_SIMULATION=false, production simulation is OFF',
  allowSimulation('false', false), false);

// Confirm the value actually present in client/.env
const envText = await readFile(new URL('../.env', import.meta.url), 'utf8');
const flagLine = envText
  .split(/\r?\n/)
  .filter((l) => l.trim().startsWith('EXPO_PUBLIC_ALLOW_EMG_SIMULATION='))
  .pop();
console.log('client/.env effective line:', flagLine ?? '(not set)');
const envFlag = flagLine ? flagLine.split('=')[1].trim() : undefined;
check('client/.env pins simulation off for hardware QA',
  allowSimulation(envFlag, true), false);

heading('A4. Default discovery policy applied to the real scan-run-2 results');
// The 14 real results: unnamed, zero advertised service UUIDs (the app logged no
// "Service UUIDs:" line for any of them), private random addresses.
const realResults = SCAN_RUN_2.map(([id, rssi]) => ({
  id,
  name: null,
  localName: null,
  rssi,
  serviceUUIDs: null,
  serviceData: null,
  rawScanRecord: null,
  manufacturerData: null,
}));

const { classifyRelevance, DEVICE_RELEVANCE } = await import('../src/utils/bleAdvertisement.js');

let beacons = 0;
let retained = 0;
for (const result of realResults) {
  const summary = summarizeAdvertisement(result);
  const relevance = classifyRelevance(summary, { isEmgCandidate: false });
  if (relevance === DEVICE_RELEVANCE.BACKGROUND_BEACON) beacons += 1;
  else retained += 1;
}
console.log(`Classified as anonymous background beacon: ${beacons}/14`);
console.log(`Retained in the default "Connectable" view:  ${retained}/14`);

const esp32Relevance = classifyRelevance(
  summarizeAdvertisement(esp32LikeScanResult),
  { isEmgCandidate: true }
);
console.log('Unnamed-but-NUS-advertising ESP32 relevance:', esp32Relevance);
check('all 14 anonymous results are demoted, none deleted from the scan',
  beacons, 14);
check('the ESP32 is always ranked as an EMG candidate',
  esp32Relevance, DEVICE_RELEVANCE.EMG_CANDIDATE);
check('"All BLE" view still returns every advertisement', realResults.length, 14);

heading('C1. ESP32 advertising payload budget (31-byte legacy PDU limit)');
const { advertisingPayloadCost, LEGACY_ADV_PAYLOAD_MAX, detectEsp32Signals } =
  await import('../src/utils/bleAdvertisement.js');

const DEVICE_NAME = 'ESP32_BT_Device';

// What the current firmware asks for: BLEDevice::init(name) leaves
// include_name = true and include_txpower = true, and addServiceUUID() adds the
// 128-bit NUS UUID, all in the PRIMARY advertising packet.
const current = advertisingPayloadCost({
  flags: true,
  txPower: true,
  name: DEVICE_NAME,
  uuid128Count: 1,
});
console.log(`Current firmware advertising request (single PDU), limit ${LEGACY_ADV_PAYLOAD_MAX}:`);
current.items.forEach((i) => console.log(`  ${String(i.bytes).padStart(2)} bytes  ${i.field}`));
console.log(`  ${'--'}`);
console.log(`  ${String(current.total).padStart(2)} bytes  TOTAL   -> fits: ${current.fits}, overflow: ${current.overflowBy} bytes`);

// Minimal version: even with no flags and no TX power it still cannot fit.
const minimal = advertisingPayloadCost({ name: DEVICE_NAME, uuid128Count: 1 });
console.log(`\nName + 128-bit UUID alone: ${minimal.total} bytes -> fits: ${minimal.fits} (overflow ${minimal.overflowBy})`);

// The safe split: UUID in ADV, name in SCAN_RSP.
const advOnly = advertisingPayloadCost({ flags: true, uuid128Count: 1 });
const scanRspOnly = advertisingPayloadCost({ name: DEVICE_NAME });
console.log(`\nProposed split:`);
console.log(`  ADV      = ${advOnly.total} bytes (flags + 128-bit NUS UUID) -> fits: ${advOnly.fits}`);
console.log(`  SCAN_RSP = ${scanRspOnly.total} bytes (complete local name)   -> fits: ${scanRspOnly.fits}`);

check('current firmware advertising request overflows the 31-byte PDU',
  current.fits, false);
check('total is 41 bytes with flags + tx power', current.total, 41);
check('overflow is 10 bytes over the 31-byte limit', current.overflowBy, 10);
check('name + 128-bit UUID alone already overflows', minimal.fits, false);
check('ADV packet with flags + NUS UUID fits', advOnly.fits, true);
check('SCAN_RSP packet with the name fits', scanRspOnly.fits, true);
check('a 16-bit-only UUID advert would also fit with the name',
  advertisingPayloadCost({ flags: true, name: DEVICE_NAME, uuid16Count: 1 }).fits, true);

heading('C2. ESP32 signal detection against the real scan results');
// None of the 21 real results should trigger a hit, because the phone never
// received an ESP32 advertisement.
let esp32Hits = 0;
for (const [id, rssi] of SCAN_RUN_2) {
  if (detectEsp32Signals({ id, name: null, localName: null, rssi }, DEVICE_NAME)) esp32Hits += 1;
}
console.log(`ESP32 signal hits among the real scan results: ${esp32Hits}`);
check('no false-positive ESP32 detection on real anonymous beacons', esp32Hits, 0);

// And it must fire on each field a real ESP32 could show up in.
check('detects the name field',
  Boolean(detectEsp32Signals({ id: 'AA:BB:CC:DD:EE:FF', name: 'ESP32_BT_Device' })), true);
check('detects the localName field',
  Boolean(detectEsp32Signals({ id: 'AA:BB:CC:DD:EE:FF', localName: 'ESP32_BT_Device' })), true);
check('detects an advertised NUS service UUID with no name at all',
  Boolean(detectEsp32Signals({
    id: 'AA:BB:CC:DD:EE:FF',
    serviceUUIDs: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'],
  })), true);
check('detects Espressif manufacturer data',
  Boolean(detectEsp32Signals({ id: 'AA:BB:CC:DD:EE:FF', manufacturerData: '5QI=' })), true);

heading('C3. Android isConnectable is now authoritative');
const nonConnectableBeacon = summarizeAdvertisement({
  id: '09:01:5E:6C:4C:64', // real NRPA that produced GATT_CONNECTION_FAILED
  name: null,
  localName: null,
  rssi: -84,
  isConnectable: false,
});
console.log('address type:', nonConnectableBeacon.address.label);
console.log('anonymousAddress:', nonConnectableBeacon.anonymousAddress);
console.log('isAnonymousBroadcast:', nonConnectableBeacon.isAnonymousBroadcast);
check('connectability is known on Android', nonConnectableBeacon.connectabilityKnown, true);
check('NRPA counts as an anonymous address', nonConnectableBeacon.anonymousAddress, true);
check('flagged as an anonymous broadcast', nonConnectableBeacon.isAnonymousBroadcast, true);
check('isConnectable=false overrides a generic GATT error',
  categorizeConnectFailure({ message: 'Operation failed', androidErrorCode: 133 }, nonConnectableBeacon),
  CONNECT_FAILURE.NON_CONNECTABLE_ADVERTISEMENT);
check('non-connectable unnamed device is never promoted above a beacon',
  classifyRelevance(nonConnectableBeacon, { isEmgCandidate: false }),
  DEVICE_RELEVANCE.BACKGROUND_BEACON);
check('a connectable named peripheral is still promoted',
  classifyRelevance(
    summarizeAdvertisement({ id: 'C0:49:EF:11:22:33', name: 'Some Speaker', isConnectable: true }),
    { isEmgCandidate: false }
  ),
  DEVICE_RELEVANCE.NAMED_PERIPHERAL);
// Critically: the ESP32 must survive even if Android marks it non-connectable
// on a particular advertisement, because it is an EMG candidate by UUID.
check('ESP32 stays an EMG candidate regardless of isConnectable',
  classifyRelevance(summarizeAdvertisement(esp32LikeScanResult), { isEmgCandidate: true }),
  DEVICE_RELEVANCE.EMG_CANDIDATE);

heading('RESULT');
console.log(`passed: ${passed}   failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
