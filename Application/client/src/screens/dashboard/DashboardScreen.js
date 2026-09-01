import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { GradientButton, GlassCard, StatCard } from '../../components';
import { useAppState } from '../../context/AppStateContext';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { useBluetooth } from '../../hooks/useBluetooth';
import { useCalibration } from '../../hooks/useCalibration';
import { historyApi } from '../../services/api';
import { checkBleConnectionState, onBleConnectionChange } from '../../services/bleService';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function DashboardScreen({ navigation }) {
  const { calibrationDone, setCalibrationDone } = useAppState();
  const { token, user } = useAuth();
  const dialog = useDialog();
  const parentNav = navigation.getParent();
  const {
    deviceConnected,
    connectedDevice,
    setDeviceConnected,
    setConnectedDevice,
    setBleReady,
    syncBluetoothStatus,
  } = useBluetooth();
  const { loadCalibrationDashboard } = useCalibration();
  const [stats, setStats] = useState({ sessions: 0, recordings: 0, accuracy: '—' });
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [, dashboard, history] = await Promise.all([
        syncBluetoothStatus(),
        loadCalibrationDashboard(),
        historyApi.list(1, 50, token),
      ]);

      setCalibrationDone(dashboard.isCalibrated ?? false);

      const items = history.history ?? [];
      const avgConfidence = items.length
        ? Math.round(
            items.reduce((sum, item) => sum + (item.confidenceScore ?? 0), 0) / items.length
          )
        : null;

      setStats({
        sessions: items.length,
        recordings: items.length,
        accuracy: avgConfidence != null ? `${avgConfidence}%` : '—',
      });
    } catch {
    } finally {
      setLoading(false);
    }
  }, [token, syncBluetoothStatus, loadCalibrationDashboard, setCalibrationDone]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useFocusEffect(
    useCallback(() => {
      if (!deviceConnected) {
        return undefined;
      }

      checkBleConnectionState(connectedDevice?.id).then((state) => {
        if (!state.connected) {
          setDeviceConnected(false);
          setBleReady(false);
          setConnectedDevice(null);
        }
      });

      const interval = setInterval(() => {
        checkBleConnectionState(connectedDevice?.id).then((state) => {
          if (!state.connected) {
            setDeviceConnected(false);
            setBleReady(false);
            setConnectedDevice(null);
          }
        });
      }, 2000);

      return () => clearInterval(interval);
    }, [connectedDevice?.id, deviceConnected, setConnectedDevice, setDeviceConnected, setBleReady])
  );

  useEffect(() => {
    const unsubscribe = onBleConnectionChange(({ connected, device }) => {
      setDeviceConnected(connected);
      setBleReady(connected);
      if (connected) {
        setConnectedDevice({
          id: device?.id ?? '',
          name: device?.name || device?.localName || 'EMG Device',
        });
      } else {
        setConnectedDevice(null);
      }
    });
    return unsubscribe;
  }, [setConnectedDevice, setDeviceConnected, setBleReady]);

  const handleStartRecording = () => {
    if (!deviceConnected) {
      dialog.show({
        title: 'Connection Required',
        description: 'Please connect your EMG device first.',
        buttons: [{ text: 'Connect Device', onPress: () => { parentNav?.navigate('DeviceConnection'); } }],
      });
      return;
    }
    if (!calibrationDone) {
      dialog.show({
        title: 'Calibration Required',
        description: 'Calibration is required before recording.',
        buttons: [{ text: 'Calibrate', onPress: () => { parentNav?.navigate('Calibration'); } }],
      });
      return;
    }
    navigation.navigate('Record');
  };

  const recordingDisabled = !deviceConnected;
  const recordingMessage = !deviceConnected
    ? 'Please connect your EMG device first.'
    : !calibrationDone
      ? 'Calibration required before recording.'
      : null;

  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.welcome}>Welcome back, {firstName} 👋</Text>
      <Text style={styles.subtitle}>Your EMG activity and speech sessions at a glance.</Text>

      <View style={styles.statusRow}>
        <GlassCard style={styles.statusCard}>
          <Text style={styles.statusCardLabel}>Device Status</Text>
          <Text
            style={[
              styles.statusCardValue,
              { color: deviceConnected ? colors.success : colors.error },
            ]}
          >
            {deviceConnected
              ? connectedDevice?.name
                ? `Connected · ${connectedDevice.name}`
                : 'Connected'
              : 'Disconnected'}
          </Text>
        </GlassCard>
        <GlassCard style={styles.statusCard}>
          <Text style={styles.statusCardLabel}>Calibration Status</Text>
          <Text
            style={[
              styles.statusCardValue,
              { color: calibrationDone ? colors.success : colors.error },
            ]}
          >
            {calibrationDone ? 'Personalized' : 'Not Calibrated'}
          </Text>
        </GlassCard>
      </View>

      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.statsLoader} />
      ) : (
        <View style={styles.statsRow}>
          <StatCard label="Sessions" value={String(stats.sessions)} />
          <StatCard label="Recordings" value={String(stats.recordings)} />
          <StatCard label="Accuracy" value={stats.accuracy} accent={colors.accent} />
        </View>
      )}

      <GlassCard style={styles.mainActionCard}>
        <Text style={styles.mainTitle}>Start EMG Recording</Text>
        <Text style={styles.mainSubtitle}>Begin a new mute-to-speech session.</Text>
        {recordingMessage && <Text style={styles.recordingMessage}>{recordingMessage}</Text>}
        <GradientButton
          title="Start Recording"
          onPress={handleStartRecording}
          disabled={recordingDisabled}
          style={[styles.mainButton, recordingDisabled && { opacity: 0.6 }]}
        />
      </GlassCard>

      <View style={styles.quickActions}>
        <GradientButton
          title="Connect Device"
          onPress={() => parentNav?.navigate('DeviceConnection')}
          style={styles.secondaryButton}
        />
        <GradientButton
          title="Calibration"
          onPress={() => parentNav?.navigate('Calibration')}
          style={styles.secondaryButton}
        />
        <GradientButton
          title="View History"
          onPress={() => navigation.navigate('History')}
          style={styles.secondaryButton}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  welcome: { fontSize: typography.h2, fontWeight: typography.bold, color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: typography.body, color: colors.textSecondary, marginBottom: spacing.lg },
  statusRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statusCard: { flex: 1 },
  statusCardLabel: {
    fontSize: typography.caption,
    fontWeight: typography.bold,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  statusCardValue: { fontSize: typography.caption, fontWeight: typography.semiBold },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statsLoader: { marginBottom: spacing.lg },
  mainActionCard: { marginBottom: spacing.lg },
  mainTitle: { fontSize: typography.h3, fontWeight: typography.bold, color: colors.text, marginBottom: spacing.xs },
  mainSubtitle: { fontSize: typography.body, color: colors.textSecondary, marginBottom: spacing.sm },
  recordingMessage: {
    fontSize: typography.caption,
    color: colors.warning,
    marginBottom: spacing.sm,
  },
  mainButton: { alignSelf: 'flex-start' },
  quickActions: { gap: spacing.sm },
  secondaryButton: { alignSelf: 'stretch' },
});
