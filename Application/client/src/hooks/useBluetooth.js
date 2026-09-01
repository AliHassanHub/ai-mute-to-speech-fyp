import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { bluetoothApi } from '../services/api';
import { checkBleConnectionState, getConnectedBleDevice, isLiveBleConnected } from '../services/bleService';

export function useBluetooth() {
  const { token } = useAuth();
  const {
    deviceConnected,
    setDeviceConnected,
    bleReady,
    setBleReady,
    connectedDevice,
    setConnectedDevice,
  } = useAppState();

  const syncBluetoothStatus = useCallback(async () => {
    if (!token) {
      return {
        isConnected: false,
        connection: null,
      };
    }

    const btStatus = await bluetoothApi.status(token);
    const live = await isLiveBleConnected();
    const deviceMac =
      getConnectedBleDevice()?.id ??
      btStatus.connection?.deviceMac ??
      connectedDevice?.id ??
      null;

    // Live BLE is authoritative. Backend "connected" alone must not keep the UI connected.
    if (live && deviceMac) {
      const bleState = await checkBleConnectionState(deviceMac);
      const reallyConnected = Boolean(bleState.connected && getConnectedBleDevice());
      setDeviceConnected(reallyConnected);
      setBleReady(reallyConnected);
      if (!reallyConnected) {
        setConnectedDevice(null);
        setBleReady(false);
        if (btStatus.isConnected) {
          await bluetoothApi.disconnect(token).catch(() => {});
        }
      } else if (btStatus.connection) {
        setConnectedDevice({
          id: btStatus.connection.deviceMac,
          name: btStatus.connection.deviceName,
        });
      }
    } else {
      setDeviceConnected(false);
      setBleReady(false);
      setConnectedDevice(null);
      if (btStatus.isConnected) {
        await bluetoothApi.disconnect(token).catch(() => {});
      }
    }

    return btStatus;
  }, [token, connectedDevice?.id, setConnectedDevice, setDeviceConnected, setBleReady]);

  return {
    deviceConnected,
    bleReady,
    connectedDevice,
    setDeviceConnected,
    setBleReady,
    setConnectedDevice,
    syncBluetoothStatus,
  };
}
