import React, { createContext, useState, useContext } from 'react';

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [bleReady, setBleReady] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [calibrationDone, setCalibrationDone] = useState(false);

  return (
    <AppStateContext.Provider
      value={{
        deviceConnected,
        setDeviceConnected,
        bleReady,
        setBleReady,
        connectedDevice,
        setConnectedDevice,
        calibrationDone,
        setCalibrationDone,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}
