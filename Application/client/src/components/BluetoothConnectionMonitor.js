import { useEffect, useRef } from 'react';
import { AppState as RnAppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { bluetoothApi } from '../services/api';
import {
  notifyDeviceConnected,
  notifyDeviceDisconnected,
} from '../services/notificationService';
import {
  checkBleConnectionState,
  onBleConnectionChange,
  restoreConnectionTracking,
  startConnectionMonitor,
} from '../services/bleService';
import { clearLiveEmgState } from '../services/emgStreamService';
import {
  shouldNotifyDeviceConnect,
  shouldNotifyDeviceDisconnect,
} from '../utils/bleConnectionNotificationTransitions';

export default function BluetoothConnectionMonitor() {
  const { token } = useAuth();
  const {
    deviceConnected,
    setDeviceConnected,
    setBleReady,
    connectedDevice,
    setConnectedDevice,
  } = useAppState();
  const wasConnectedRef = useRef(deviceConnected);

  useEffect(() => {
    if (deviceConnected && connectedDevice?.id) {
      restoreConnectionTracking(connectedDevice.id);
      checkBleConnectionState(connectedDevice.id).then((state) => {
        if (!state.connected) {
          setDeviceConnected(false);
          setBleReady(false);
          setConnectedDevice(null);
        } else {
          setBleReady(true);
        }
      });
    }
  }, [
    connectedDevice?.id,
    deviceConnected,
    setConnectedDevice,
    setDeviceConnected,
    setBleReady,
  ]);

  useEffect(() => {
    const unsubscribe = onBleConnectionChange(async ({ connected, device, reason }) => {
      if (connected) {
        const deviceName = device?.name || device?.localName || 'EMG Device';
        const deviceId = device?.id ?? '';

        setDeviceConnected(true);
        setBleReady(true);
        setConnectedDevice({
          id: deviceId,
          name: deviceName,
        });

        if (shouldNotifyDeviceConnect(wasConnectedRef.current)) {
          notifyDeviceConnected({ deviceId, deviceName }).catch(() => {});
        }

        wasConnectedRef.current = true;
        return;
      }

      const shouldNotifyDisconnect = shouldNotifyDeviceDisconnect(wasConnectedRef.current);
      wasConnectedRef.current = false;

      clearLiveEmgState();
      setDeviceConnected(false);
      setBleReady(false);
      setConnectedDevice(null);

      if (token) {
        await bluetoothApi.disconnect(token).catch(() => {});
      }

      if (shouldNotifyDisconnect) {
        notifyDeviceDisconnected({
          deviceId: device?.id,
          reason: reason || 'unexpected',
        }).catch(() => {});
      }
    });

    return unsubscribe;
  }, [setConnectedDevice, setDeviceConnected, setBleReady, token]);

  useEffect(() => {
    if (!deviceConnected) {
      return undefined;
    }

    return startConnectionMonitor();
  }, [deviceConnected, connectedDevice?.id]);

  useEffect(() => {
    const subscription = RnAppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && deviceConnected) {
        checkBleConnectionState(connectedDevice?.id).then((state) => {
          if (!state.connected) {
            setDeviceConnected(false);
            setBleReady(false);
            setConnectedDevice(null);
          }
        });
      }
    });

    return () => subscription.remove();
  }, [deviceConnected, connectedDevice?.id, setConnectedDevice, setDeviceConnected, setBleReady]);

  return null;
}
