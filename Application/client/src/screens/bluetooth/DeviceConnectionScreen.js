import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, GlassCard, GradientButton, CustomButton } from '../../components';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { bluetoothApi } from '../../services/api';
import {
  connectAndPrepareEmgDevice,
  disconnectBleDevice,
  ensureBluetoothReady,
  requestBlePermissions,
  startBleScan,
  getConnectedBleDevice,
  getDeviceConnectOutcome,
  onBleConnectionChange,
  checkBleConnectionState,
  mapBleConnectError,
  filterDiscoveredDevices,
  summarizeDiscovery,
  getBleConnectionPhase,
  isLiveBleConnected,
} from '../../services/bleService';
import { CONNECT_FAILURE } from '../../utils/bleAdvertisement';
import { stopEmgStream, getEmgStreamMode } from '../../services/emgStreamService';
import { PREFERRED_EMG_DEVICE_NAME } from '../../constants/bleConfig';
import { getErrorMessage } from '../../utils/apiHelpers';
import { safeGoBack } from '../../navigation/navigationRef';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

const SCAN_DURATION_MS = 12000;

const PHASE_LABELS = {
  idle: 'Idle',
  scanning: 'Scanning',
  connecting: 'Connecting',
  discovering: 'Discovering GATT',
  validating: 'Validating NUS',
  connected: 'Link connected',
  subscribing: 'Subscribing',
  waitingForData: 'Waiting for EMG data',
  ready: 'EMG Ready',
  streaming: 'Streaming',
  disconnecting: 'Disconnecting',
  disconnected: 'Disconnected',
  error: 'Error',
};

function SignalBars({ strength }) {
  const level = Math.min(4, Math.floor((strength / 100) * 4));
  return (
    <View style={styles.signalRow}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            styles.signalBar,
            i <= level && styles.signalBarActive,
            { height: 8 + i * 4 },
          ]}
        />
      ))}
    </View>
  );
}

function DeviceRow({ item, isConnected, isConnecting, onConnect }) {
  const likelyEmg = item.classification === 'LIKELY_EMG' || item.isLikelyEmgDevice;
  const outcome = item.connectOutcome;
  const failed = outcome?.status === 'failed';

  // Android's ScanResult.isConnectable() tells us up front whether the
  // advertising PDU is connectable at all. When it says no, offering a Connect
  // button would be misleading. Otherwise a device only becomes known-bad after
  // it has actually refused.
  const androidSaysNotConnectable = item.advertisement?.isConnectable === false;
  const knownUnconnectable =
    androidSaysNotConnectable ||
    (failed && outcome.category === CONNECT_FAILURE.NON_CONNECTABLE_ADVERTISEMENT);

  const availability = isConnected
    ? 'Connected'
    : isConnecting
      ? 'Connecting…'
      : failed
        ? `Connection failed — ${outcome.label}`
        : androidSaysNotConnectable
          ? 'Broadcast only — Android reports not connectable'
          : 'Available to try';

  const availabilityStyle = isConnected
    ? styles.availabilityConnected
    : failed
      ? styles.availabilityFailed
      : androidSaysNotConnectable
        ? styles.availabilityBroadcast
        : null;

  return (
    <View style={styles.deviceItem}>
      <View style={[styles.deviceIconWrap, likelyEmg && styles.deviceIconWrapEmg]}>
        <Ionicons
          name={
            likelyEmg
              ? 'hardware-chip-outline'
              : knownUnconnectable
                ? 'radio-outline'
                : 'bluetooth-outline'
          }
          size={28}
          color={likelyEmg ? colors.primary : colors.textSecondary}
        />
      </View>
      <View style={styles.deviceInfo}>
        <Text
          style={[styles.deviceName, !item.hasRealName && styles.deviceNameUnnamed]}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        <Text style={styles.deviceId} numberOfLines={1}>
          ID: {item.id}
        </Text>
        <Text style={[styles.deviceKind, likelyEmg && styles.deviceKindEmg]}>
          {likelyEmg ? 'Likely EMG device' : 'BLE device'}
          {item.advertisement?.address?.label
            ? ` · ${item.advertisement.address.label}`
            : ''}
        </Text>
        {item.detail ? (
          <Text style={styles.deviceDetail} numberOfLines={2}>
            {item.detail}
          </Text>
        ) : null}
        <Text style={styles.signalLabel}>
          Signal strength
          {item.rssi != null && item.rssi > -200 ? `: ${item.rssi} dBm` : ''}
        </Text>
        <SignalBars strength={item.signalStrength} />
        <Text style={[styles.connectionState, availabilityStyle]}>{availability}</Text>
      </View>
      {isConnecting ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : knownUnconnectable ? (
        <View style={styles.broadcastTag}>
          <Text style={styles.broadcastTagText}>Broadcast{'\n'}only</Text>
        </View>
      ) : (
        <CustomButton
          title={isConnected ? 'Connected' : failed ? 'Retry' : 'Connect'}
          onPress={() => onConnect(item)}
          disabled={isConnected}
          variant={isConnected ? 'secondary' : 'primary'}
          style={styles.connectBtn}
        />
      )}
    </View>
  );
}

export default function DeviceConnectionScreen({ navigation }) {
  const {
    deviceConnected,
    setDeviceConnected,
    bleReady,
    setBleReady,
    connectedDevice,
    setConnectedDevice,
  } = useAppState();
  const { token } = useAuth();
  const dialog = useDialog();
  const { showToast } = useToast();

  const [connectionStatus, setConnectionStatus] = useState(
    deviceConnected ? 'Connected' : 'Disconnected'
  );
  const [phaseLabel, setPhaseLabel] = useState(
    PHASE_LABELS[getBleConnectionPhase()] || 'Idle'
  );
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState(null);
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  /** 'useful' (default) | 'emg' | 'all' */
  const [deviceView, setDeviceView] = useState('useful');
  const [lastError, setLastError] = useState(null);
  const [hasCompletedScan, setHasCompletedScan] = useState(false);
  const [firstSamplePreview, setFirstSamplePreview] = useState(null);

  const stopScanRef = useRef(null);
  const scanTimerRef = useRef(null);
  const devicesCountRef = useRef(0);

  const clearScan = useCallback(() => {
    if (stopScanRef.current) {
      stopScanRef.current();
      stopScanRef.current = null;
    }
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    setScanning(false);
  }, []);

  const clearConnectedState = useCallback(() => {
    setConnectionStatus('Disconnected');
    setDeviceConnected(false);
    setBleReady(false);
    setConnectedDevice(null);
    setFirstSamplePreview(null);
    setPhaseLabel(PHASE_LABELS.disconnected);
  }, [setBleReady, setConnectedDevice, setDeviceConnected]);

  const displayedDevices = useMemo(
    () =>
      filterDiscoveredDevices(discoveredDevices, {
        emgOnly: deviceView === 'emg',
        showAll: deviceView === 'all',
      }),
    [discoveredDevices, deviceView]
  );

  const discovery = useMemo(() => summarizeDiscovery(discoveredDevices), [discoveredDevices]);

  const syncStatus = useCallback(async () => {
    if (!token) return;
    try {
      // Live BLE is authoritative — backend metadata cannot keep UI "Connected".
      const live = await isLiveBleConnected();
      const bleState = await checkBleConnectionState();
      const reallyConnected = Boolean(live && bleState.connected && getConnectedBleDevice());

      if (!reallyConnected) {
        setDeviceConnected(false);
        setBleReady(false);
        setConnectionStatus('Disconnected');
        setConnectedDevice(null);
        const data = await bluetoothApi.status(token).catch(() => null);
        if (data?.isConnected) {
          await bluetoothApi.disconnect(token).catch(() => {});
        }
        return;
      }

      setDeviceConnected(true);
      setBleReady(getBleConnectionPhase() === 'ready');
      setConnectionStatus('Connected');
    } catch {
    }
  }, [token, setDeviceConnected, setConnectedDevice, setBleReady]);

  useEffect(() => {
    syncStatus();

    const unsubscribe = onBleConnectionChange(({ connected, device, phase, emgReady }) => {
      if (connected) {
        setConnectionStatus('Connected');
        setDeviceConnected(true);
        setBleReady(Boolean(emgReady) || phase === 'ready');
        setConnectedDevice({
          id: device?.id ?? '',
          name: device?.name || device?.localName || PREFERRED_EMG_DEVICE_NAME,
        });
        setPhaseLabel(PHASE_LABELS[phase] || PHASE_LABELS.ready);
        setLastError(null);
        return;
      }

      stopEmgStream();
      clearConnectedState();
    });

    return () => {
      clearScan();
      unsubscribe();
    };
  }, [syncStatus, clearScan, clearConnectedState, setConnectedDevice, setDeviceConnected, setBleReady]);

  useEffect(() => {
    if (!deviceConnected) {
      return undefined;
    }

    checkBleConnectionState();
    const interval = setInterval(() => {
      checkBleConnectionState();
    }, 4000);

    return () => clearInterval(interval);
  }, [deviceConnected]);

  const handleScan = async () => {
    if (scanning) return;

    clearScan();
    setDiscoveredDevices([]);
    devicesCountRef.current = 0;
    setLastError(null);
    setHasCompletedScan(false);

    const permitted = await requestBlePermissions();
    if (!permitted) {
      const message =
        'Bluetooth permission was denied. Allow Bluetooth and location access to scan for devices.';
      setLastError(message);
      dialog.show({
        title: 'Permissions Required',
        description: message,
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    const bluetooth = await ensureBluetoothReady();
    if (!bluetooth.ready) {
      setLastError(bluetooth.message);
      dialog.show({
        title: 'Bluetooth Unavailable',
        description: bluetooth.message,
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
      return;
    }

    setScanning(true);
    setConnectionStatus('Scanning');
    setPhaseLabel(PHASE_LABELS.scanning);
    showToast('Scanning for nearby BLE devices...');

    stopScanRef.current = startBleScan(
      (found) => {
        devicesCountRef.current = found.length;
        setDiscoveredDevices(found);
      },
      (error) => {
        clearScan();
        setHasCompletedScan(true);
        setConnectionStatus(deviceConnected ? 'Connected' : 'Disconnected');
        const message = error.message || 'Could not scan for devices.';
        setLastError(message);
        dialog.show({
          title: 'Scan Failed',
          description: message,
          buttons: [{ text: 'OK', onPress: () => {} }],
        });
      }
    );

    scanTimerRef.current = setTimeout(() => {
      clearScan();
      setHasCompletedScan(true);
      setConnectionStatus(deviceConnected ? 'Connected' : 'Disconnected');
      setPhaseLabel(deviceConnected ? PHASE_LABELS.ready : PHASE_LABELS.idle);
      showToast(
        devicesCountRef.current > 0
          ? `Found ${devicesCountRef.current} real BLE device(s).`
          : 'Scan complete. No nearby BLE devices found.'
      );
    }, SCAN_DURATION_MS);
  };

  const handleConnect = async (item) => {
    if (!item?.id || connectingId) return;

    setConnectingId(item.id);
    setConnectionStatus('Connecting');
    setPhaseLabel(PHASE_LABELS.connecting);
    setLastError(null);
    setBleReady(false);
    setFirstSamplePreview(null);
    clearScan();

    try {
      // Prove BLE + GATT + first EMG packet before backend metadata.
      const result = await connectAndPrepareEmgDevice(item.id, {
        advertisement: item.advertisement,
      });
      setPhaseLabel(PHASE_LABELS.ready);

      // Only ever report a name the peripheral actually advertised. Falling back
      // to PREFERRED_EMG_DEVICE_NAME would write a fabricated name into the
      // backend for a device that never advertised one.
      const deviceName =
        result.device?.name?.trim() ||
        result.device?.localName?.trim() ||
        (item.hasRealName ? item.name : null) ||
        `Unnamed EMG peripheral (${item.id})`;

      if (result.firstSample) {
        setFirstSamplePreview(`EMG:${result.firstSample[0]} POT:${result.firstSample[1]}`);
      }

      // Metadata only — after real BLE + GATT + EMG packet proof.
      const data = await bluetoothApi.connect(deviceName, item.id, token);

      const connected = {
        id: item.id,
        name: data.connection?.deviceName ?? deviceName,
      };

      setConnectedDevice(connected);
      setConnectionStatus('Connected');
      setDeviceConnected(true);
      setBleReady(true);
      showToast(`EMG Ready — connected to ${connected.name}`);
    } catch (error) {
      await disconnectBleDevice().catch(() => {});
      clearConnectedState();
      setPhaseLabel(PHASE_LABELS.error);

      const message = mapBleConnectError(error, item.advertisement) || getErrorMessage(error);
      setLastError(message);

      setDiscoveredDevices((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? { ...entry, connectOutcome: getDeviceConnectOutcome(item.id) }
            : entry
        )
      );

      dialog.show({
        title: 'Connection Failed',
        description: message,
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    } finally {
      setConnectingId(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      stopEmgStream();
      await disconnectBleDevice({ intentional: true });
      await bluetoothApi.disconnect(token).catch(() => {});
      clearConnectedState();
      setLastError(null);
      showToast('Device disconnected.');
    } catch (error) {
      clearConnectedState();
      dialog.show({
        title: 'Disconnect Failed',
        description: getErrorMessage(error),
        buttons: [{ text: 'OK', onPress: () => {} }],
      });
    }
  };

  const connectedBle = getConnectedBleDevice();
  const activeConnectedId = connectedDevice?.id ?? connectedBle?.id;
  const emgMode = getEmgStreamMode();
  const bleStatusLabel = !deviceConnected
    ? '—'
    : emgMode === 'streaming'
      ? 'Streaming'
      : bleReady
        ? 'EMG Ready'
        : 'Connected';

  const emptyMessage = (() => {
    if (scanning) {
      return 'Scanning for nearby BLE devices (real Android advertisements only)...';
    }
    if (!hasCompletedScan && discoveredDevices.length === 0) {
      return 'Tap "Scan for devices" to search. Results come only from the phone BLE scanner — nothing is simulated.';
    }
    if (discoveredDevices.length === 0) {
      return 'No nearby BLE devices found.';
    }
    if (deviceView === 'emg') {
      return `No compatible EMG device found yet. ${discoveredDevices.length} other BLE advertisement(s) were seen — switch to "All BLE" to inspect them.`;
    }
    if (deviceView === 'useful') {
      return `All ${discoveredDevices.length} nearby advertisement(s) were anonymous background beacons that cannot accept connections. Switch to "All BLE" to inspect them.`;
    }
    return 'No nearby BLE devices found.';
  })();

  return (
    <View style={styles.container}>
      <AppHeader
        title="Connect EMG Device"
        subtitle="Real BLE hardware only"
        showBack
        onBackPress={() => safeGoBack(navigation)}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.description}>
          Every row below came from a real Android BLE advertisement — nothing is simulated. This is
          a BLE/GATT scan, not the Bluetooth Classic pairing list, so it shows more devices than
          Android&apos;s Bluetooth settings screen. Look for {PREFERRED_EMG_DEVICE_NAME}. Unnamed
          rows are genuine peripherals that broadcast without a name. Connecting validates the
          Nordic UART service and waits for a real EMG packet before reporting EMG Ready.
        </Text>

        <GlassCard style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Device scan</Text>
          {scanning ? (
            <View style={styles.scanningRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.scanningText}>Scanning for nearby BLE devices...</Text>
            </View>
          ) : (
            <CustomButton title="Scan for devices" variant="outline" onPress={handleScan} />
          )}
          <View style={styles.segmentRow}>
            {[
              { key: 'useful', label: 'Connectable' },
              { key: 'emg', label: 'EMG only' },
              { key: 'all', label: 'All BLE' },
            ].map((option) => (
              <TouchableOpacity
                key={option.key}
                onPress={() => setDeviceView(option.key)}
                style={[
                  styles.segment,
                  deviceView === option.key && styles.segmentActive,
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    deviceView === option.key && styles.segmentTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.toggleHint}>
            {deviceView === 'emg'
              ? 'Only peripherals advertising Nordic UART or an EMG/ESP32 name.'
              : deviceView === 'all'
                ? 'Every raw advertisement Android reported, including anonymous beacons.'
                : 'Hides anonymous background beacons that cannot accept connections.'}
          </Text>
          {scanning ? (
            <TouchableOpacity onPress={clearScan} style={styles.stopScanBtn}>
              <Text style={styles.stopScanText}>Stop scan</Text>
            </TouchableOpacity>
          ) : null}
        </GlassCard>

        {hasCompletedScan && discovery.total > 0 ? (
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>What the scan found</Text>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Total advertisements:</Text>
              <Text style={styles.statusValue}>{discovery.total}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Likely EMG devices:</Text>
              <Text style={styles.statusValue}>{discovery.emgCandidates}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Named peripherals:</Text>
              <Text style={styles.statusValue}>{discovery.named}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Unnamed but identifiable:</Text>
              <Text style={styles.statusValue}>{discovery.identifiable}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Anonymous beacons:</Text>
              <Text style={styles.statusValue}>{discovery.backgroundBeacons}</Text>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Rotating privacy addresses:</Text>
              <Text style={styles.statusValue}>{discovery.rotatingAddresses}</Text>
            </View>
            <Text style={styles.explainerText}>
              A BLE scan sees far more than Android&apos;s Bluetooth settings screen. Settings
              lists paired devices plus pairable ones it recognises; this scan reports every
              nearby advertisement, including phones, watches, earbuds and trackers that
              broadcast under rotating anonymous addresses and never expose a name. Those
              cannot be paired and are not app-generated entries.
            </Text>
          </GlassCard>
        ) : null}

        <GlassCard style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>
            Nearby BLE devices{' '}
            {displayedDevices.length > 0 ? `(${displayedDevices.length})` : ''}
            {discoveredDevices.length > displayedDevices.length
              ? ` · ${discoveredDevices.length} total advertisements scanned`
              : ''}
          </Text>
          {displayedDevices.length === 0 ? (
            <View style={styles.emptyDevices}>
              <Ionicons name="bluetooth-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyText}>{emptyMessage}</Text>
            </View>
          ) : (
            <FlatList
              data={displayedDevices}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              renderItem={({ item }) => (
                <DeviceRow
                  item={item}
                  isConnected={activeConnectedId === item.id && deviceConnected}
                  isConnecting={connectingId === item.id}
                  onConnect={handleConnect}
                />
              )}
            />
          )}
        </GlassCard>

        <GlassCard style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Connection status</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Connection status:</Text>
            <Text
              style={[
                styles.statusValue,
                connectionStatus === 'Connected' && { color: colors.success },
                connectionStatus === 'Disconnected' && { color: colors.error },
                (connectionStatus === 'Scanning' || connectionStatus === 'Connecting') && {
                  color: colors.warning,
                },
              ]}
            >
              {connectionStatus}
            </Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>BLE / EMG phase:</Text>
            <Text style={styles.statusValue}>{phaseLabel}</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>EMG status:</Text>
            <Text
              style={[
                styles.statusValue,
                bleStatusLabel === 'EMG Ready' && { color: colors.success },
                bleStatusLabel === 'Streaming' && { color: colors.primary },
              ]}
            >
              {bleStatusLabel}
            </Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Device:</Text>
            <Text style={styles.statusValue} numberOfLines={1}>
              {connectedDevice?.name ?? '—'}
            </Text>
          </View>
          {firstSamplePreview ? (
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>First packet:</Text>
              <Text style={[styles.statusValue, { color: colors.success }]}>
                {firstSamplePreview}
              </Text>
            </View>
          ) : null}
          {lastError ? (
            <Text style={styles.errorText}>{lastError}</Text>
          ) : null}
          {connectionStatus === 'Connected' && bleReady && (
            <>
              <GradientButton
                title="Return to Dashboard"
                onPress={() => safeGoBack(navigation)}
                style={styles.returnBtn}
              />
              <CustomButton
                title="Disconnect"
                variant="outline"
                onPress={handleDisconnect}
                style={styles.disconnectBtn}
              />
            </>
          )}
          {connectionStatus === 'Connected' && !bleReady ? (
            <CustomButton
              title="Disconnect"
              variant="outline"
              onPress={handleDisconnect}
              style={styles.disconnectBtn}
            />
          ) : null}
        </GlassCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  description: {
    fontSize: typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  sectionCard: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: spacing.md,
  },
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scanningText: {
    fontSize: typography.body,
    color: colors.textSecondary,
  },
  stopScanBtn: {
    alignSelf: 'center',
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  stopScanText: {
    fontSize: typography.caption,
    color: colors.error,
    fontWeight: typography.semiBold,
  },
  segmentRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: colors.primary + '22',
  },
  segmentText: {
    fontSize: typography.small,
    color: colors.textSecondary,
    fontWeight: typography.semiBold,
  },
  segmentTextActive: {
    color: colors.primary,
  },
  toggleHint: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
    lineHeight: 17,
  },
  explainerText: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  emptyDevices: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  emptyText: {
    fontSize: typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.border + '66',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  deviceIconWrapEmg: {
    backgroundColor: colors.primary + '18',
  },
  deviceInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  deviceName: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: 2,
  },
  deviceNameUnnamed: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  deviceId: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginBottom: 2,
  },
  deviceDetail: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginBottom: 4,
    lineHeight: 16,
  },
  availabilityConnected: {
    color: colors.success,
    fontWeight: typography.semiBold,
  },
  availabilityFailed: {
    color: colors.error,
  },
  availabilityBroadcast: {
    color: colors.textMuted,
  },
  broadcastTag: {
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.border + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  broadcastTagText: {
    fontSize: typography.small,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 14,
  },
  deviceKind: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginBottom: 4,
  },
  deviceKindEmg: {
    color: colors.primary,
    fontWeight: typography.semiBold,
  },
  signalLabel: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  connectionState: {
    fontSize: typography.small,
    color: colors.textMuted,
    marginTop: 4,
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  signalBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  signalBarActive: {
    backgroundColor: colors.accent,
  },
  connectBtn: {
    minHeight: 40,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  statusLabel: {
    fontSize: typography.body,
    color: colors.textSecondary,
  },
  statusValue: {
    flex: 1,
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.text,
    textAlign: 'right',
  },
  errorText: {
    fontSize: typography.caption,
    color: colors.error,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  returnBtn: {
    marginTop: spacing.sm,
  },
  disconnectBtn: {
    marginTop: spacing.sm,
  },
});
