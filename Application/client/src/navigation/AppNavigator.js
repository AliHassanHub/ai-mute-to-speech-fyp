import React, { useEffect, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import SplashScreen from '../screens/auth/SplashScreen';
import { HomeScreen } from '../screens';
import AuthNavigator from './AuthNavigator';
import MainNavigator from './MainNavigator';
import { colors } from '../theme/colors';

const AuthenticatedStack = createNativeStackNavigator();
const UnauthenticatedStack = createNativeStackNavigator();

function AuthenticatedApp() {
  return (
    <AuthenticatedStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <AuthenticatedStack.Screen name="Main" component={MainNavigator} />
    </AuthenticatedStack.Navigator>
  );
}

function UnauthenticatedApp() {
  return (
    <UnauthenticatedStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <UnauthenticatedStack.Screen name="Home" component={HomeScreen} />
      <UnauthenticatedStack.Screen name="Auth" component={AuthNavigator} />
    </UnauthenticatedStack.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    if (isBootstrapping) {
      setShowSplash(true);
      return undefined;
    }

    const timer = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(timer);
  }, [isBootstrapping]);

  if (isBootstrapping || showSplash) {
    return <SplashScreen />;
  }

  return isAuthenticated ? <AuthenticatedApp /> : <UnauthenticatedApp />;
}
