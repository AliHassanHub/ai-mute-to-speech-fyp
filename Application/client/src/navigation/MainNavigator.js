import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  DashboardScreen,
  RecordSignalScreen,
  HistoryScreen,
  ProfileScreen,
  EditProfileScreen,
  LanguageSettingsScreen,
  NotificationSettingsScreen,
  ProcessingScreen,
  ResultScreen,
  CalibrationScreen,
  CalibrationResultScreen,
  BaselineCalibrationScreen,
  WordCalibrationScreen,
  DeviceConnectionScreen,
} from '../screens';
import { colors } from '../theme/colors';
import typography from '../theme/typography';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Dashboard: focused ? 'grid' : 'grid-outline',
            Record: focused ? 'mic' : 'mic-outline',
            History: focused ? 'time' : 'time-outline',
            Profile: focused ? 'person' : 'person-outline',
          };
          return <Ionicons name={icons[route.name]} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: typography.medium },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Record" component={RecordSignalScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function MainNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="MainTabs"
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    >
      <Stack.Screen name="MainTabs" component={MainTabs} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="LanguageSettings" component={LanguageSettingsScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="DeviceConnection" component={DeviceConnectionScreen} />
      <Stack.Screen name="Calibration" component={CalibrationScreen} />
      <Stack.Screen name="BaselineCalibration" component={BaselineCalibrationScreen} />
      <Stack.Screen name="WordCalibration" component={WordCalibrationScreen} />
      <Stack.Screen name="CalibrationResult" component={CalibrationResultScreen} />
      <Stack.Screen name="Processing" component={ProcessingScreen} />
      <Stack.Screen name="Result" component={ResultScreen} />
    </Stack.Navigator>
  );
}
