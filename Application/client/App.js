import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { AppStateProvider } from './src/context/AppStateContext';
import { SessionProvider } from './src/context/SessionContext';
import { DialogProvider } from './src/context/DialogContext';
import { ToastProvider } from './src/context/ToastContext';
import { HistoryProvider } from './src/context/HistoryContext';
import AppDialog from './src/components/AppDialog';
import CustomToast from './src/components/CustomToast';
import AppNavigator from './src/navigation/AppNavigator';
import BluetoothConnectionMonitor from './src/components/BluetoothConnectionMonitor';
import NotificationBootstrap from './src/components/NotificationBootstrap';
import { navigationRef } from './src/navigation/navigationRef';
import { colors } from './src/theme/colors';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppStateProvider>
          <SessionProvider>
            <HistoryProvider>
              <DialogProvider>
                <ToastProvider>
                  <NavigationContainer ref={navigationRef}>
                    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
                      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
                      <BluetoothConnectionMonitor />
                      <NotificationBootstrap />
                      <AppNavigator />
                    </SafeAreaView>
                  </NavigationContainer>
                  <AppDialog />
                  <CustomToast />
                </ToastProvider>
              </DialogProvider>
            </HistoryProvider>
          </SessionProvider>
        </AppStateProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
