import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader, GlassCard, GradientButton, CustomButton } from '../../components';
import { useAppState } from '../../context/AppStateContext';
import { EMG_WORDS } from '../../constants/emgConfig';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

function LegacyCalibrationResult({ navigation, calibration, setCalibrationDone }) {
  const baseline = calibration.baselineValue ?? calibration.baseline_value ?? '—';
  const threshold = calibration.thresholdLevel ?? calibration.threshold_level ?? '—';

  let wordProfiles = {};
  try {
    const parsed = JSON.parse(calibration.calibrationData ?? '{}');
    wordProfiles = parsed.wordProfiles ?? {};
  } catch {
    wordProfiles = {};
  }

  return (
    <>
      <Text style={styles.message}>
        Your EMG calibration profile is stored and ready for AI inference.
      </Text>
      <GlassCard style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Baseline (EMG ADC)</Text>
          <Text style={styles.infoValue}>{baseline}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Activation Threshold</Text>
          <Text style={styles.infoValue}>{threshold}</Text>
        </View>
      </GlassCard>
      <GlassCard style={styles.wordsCard}>
        <Text style={styles.wordsTitle}>Per-word pot positions</Text>
        {EMG_WORDS.map((word) => (
          <View key={word} style={styles.wordRow}>
            <Text style={styles.wordName}>{word}</Text>
            <Text style={styles.wordPot}>pot {wordProfiles[word]?.potMean ?? '—'}</Text>
          </View>
        ))}
      </GlassCard>
      <GradientButton
        title="Continue to Dashboard"
        onPress={() => {
          setCalibrationDone(true);
          navigation.replace('MainTabs');
        }}
        style={styles.primaryBtn}
      />
      <CustomButton
        title="Recalibrate"
        variant="outline"
        onPress={() => navigation.replace('Calibration')}
      />
    </>
  );
}

function WordCalibrationResult({ navigation, wordResult, setCalibrationDone }) {
  const displayWord = String(wordResult.word || '')
    .replace(/^\w/, (c) => c.toUpperCase());

  return (
    <>
      <Text style={styles.message}>
        Personalized EMG reference saved for "{displayWord}".
      </Text>
      <GlassCard style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Word</Text>
          <Text style={styles.infoValue}>{displayWord}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>POT Center</Text>
          <Text style={styles.infoValue}>
            {wordResult.potCenter != null ? Number(wordResult.potCenter).toFixed(1) : '—'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>EMG Profile</Text>
          <Text style={styles.infoValue}>Personalized</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Quality</Text>
          <Text style={styles.infoValue}>
            {wordResult.qualityScore != null
              ? Number(wordResult.qualityScore).toFixed(2)
              : '—'}
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Captures</Text>
          <Text style={styles.infoValue}>{wordResult.captureCount ?? '—'}</Text>
        </View>
      </GlassCard>
      <GradientButton
        title="Done"
        onPress={() => {
          setCalibrationDone(true);
          navigation.replace('Calibration');
        }}
        style={styles.primaryBtn}
      />
      <CustomButton
        title="Calibrate Another Word"
        variant="outline"
        onPress={() => navigation.replace('Calibration')}
      />
    </>
  );
}

export default function CalibrationResultScreen({ navigation, route }) {
  const { setCalibrationDone } = useAppState();
  const wordResult = route.params?.wordResult;
  const calibration = route.params?.calibration ?? {};

  return (
    <View style={styles.container}>
      <AppHeader
        title="Calibration Complete"
        subtitle={wordResult ? 'Per-word profile saved' : 'Profile saved to database'}
        showBack
        onBackPress={() => navigation.navigate('Calibration')}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.iconWrap}>
          <Ionicons name="checkmark-circle" size={80} color={colors.success} />
        </View>
        {wordResult ? (
          <WordCalibrationResult
            navigation={navigation}
            wordResult={wordResult}
            setCalibrationDone={setCalibrationDone}
          />
        ) : (
          <LegacyCalibrationResult
            navigation={navigation}
            calibration={calibration}
            setCalibrationDone={setCalibrationDone}
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  iconWrap: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  message: {
    fontSize: typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
  },
  infoCard: { marginBottom: spacing.md },
  wordsCard: { marginBottom: spacing.lg },
  wordsTitle: {
    fontSize: typography.body,
    fontWeight: typography.semiBold,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  wordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  wordName: {
    fontSize: typography.body,
    color: colors.text,
    textTransform: 'capitalize',
  },
  wordPot: { fontSize: typography.body, color: colors.textSecondary },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  infoLabel: { fontSize: typography.body, color: colors.textSecondary },
  infoValue: { fontSize: typography.body, fontWeight: typography.semiBold, color: colors.text },
  divider: { height: 1, backgroundColor: colors.border },
  primaryBtn: { marginBottom: spacing.sm },
});
