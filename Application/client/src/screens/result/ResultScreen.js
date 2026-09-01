import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { AppHeader, GradientButton, GlassCard } from '../../components';
import { useHistory } from '../../context/HistoryContext';
import { useSession } from '../../context/SessionContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { safeGoBack } from '../../navigation/navigationRef';
import {
  getErrorMessage,
  getSpeechLanguageFromUser,
  getTranslationLanguageFromUser,
} from '../../utils/apiHelpers';
import { buildResultViewModel } from '../../utils/aiPrediction';
import { playResultSpeech, stopSpeech, SPEECH_UI_STATE } from '../../services/speechService';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

export default function ResultScreen({ navigation, route }) {
  const { fetchHistory } = useHistory();
  const { completeSession, saveWordResult } = useSession();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [speechState, setSpeechState] = useState(SPEECH_UI_STATE.IDLE);
  const [isSaving, setIsSaving] = useState(false);
  const [savedResult, setSavedResult] = useState(route.params?.result ?? {});

  const signalRows = route.params?.signalRows ?? [];
  const durationMs = route.params?.durationMs ?? null;
  const translationLanguage = getTranslationLanguageFromUser(user);
  const view = useMemo(
    () => buildResultViewModel(savedResult, translationLanguage),
    [savedResult, translationLanguage]
  );
  const {
    recognizedText,
    englishPhrase,
    translatedPhrase,
    phraseTranslations,
    targetLanguage,
    translationLanguage: viewTranslationLanguage,
    speechLanguage,
    predictedLabel,
    accepted,
    statusText,
    confidenceLabel,
    confidenceCaption,
    bestGuessHint,
    isAiWindowResult,
    confidenceScore,
    persisted,
  } = view;
  const saveDisabled = isSaving || persisted;

  const resolvedSpeechLanguage = speechLanguage ?? getSpeechLanguageFromUser(user);

  const handlePlaySpeech = async () => {
    if (speechState === SPEECH_UI_STATE.SPEAKING || speechState === SPEECH_UI_STATE.STARTING) {
      await stopSpeech();
      setSpeechState(SPEECH_UI_STATE.IDLE);
      return;
    }

    try {
      await playResultSpeech({
        recognizedText,
        englishPhrase,
        phraseTranslations,
        speechLanguage: resolvedSpeechLanguage,
        targetLanguage,
        onStateChange: setSpeechState,
      });
    } catch (error) {
      setSpeechState(SPEECH_UI_STATE.IDLE);
      showToast(error?.message || 'Speech playback failed.');
    }
  };

  const speechButtonTitle =
    speechState === SPEECH_UI_STATE.STARTING
      ? 'Starting...'
      : speechState === SPEECH_UI_STATE.SPEAKING
        ? 'Stop Speech'
        : 'Play Speech';
  const isSpeechActive =
    speechState === SPEECH_UI_STATE.STARTING || speechState === SPEECH_UI_STATE.SPEAKING;

  const handleSaveResult = async () => {
    if (saveDisabled) {
      if (persisted) {
        showToast('Result is already saved to history.');
      }
      return;
    }

    setIsSaving(true);
    try {
      if (isAiWindowResult) {
        if (!Array.isArray(signalRows) || signalRows.length === 0) {
          throw new Error('Signal window is missing. Record again before saving.');
        }

        const merged = await saveWordResult({
          rows: signalRows,
          result: savedResult,
          durationMs,
          textId: savedResult.textId ?? null,
        });

        if (!merged?.persisted) {
          throw new Error('Result was not saved to history.');
        }

        setSavedResult(merged);
        await fetchHistory();
        showToast('Result saved to history.');
        return;
      }

      await completeSession(1, confidenceScore);
      await fetchHistory();
      showToast('Result saved to history.');
    } catch (error) {
      showToast(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <AppHeader title="Session Result" showBack onBackPress={() => safeGoBack(navigation)} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.predictionCard}>
          <Text style={styles.sectionLabel}>Predicted Word</Text>
          <Text style={[styles.predictedWord, !accepted ? styles.predictedWordUncertain : null]}>
            {predictedLabel}
          </Text>
          <Text style={styles.confidenceInline}>Confidence: {confidenceLabel}</Text>
          {confidenceCaption ? (
            <Text style={styles.confidenceBasis}>{confidenceCaption}</Text>
          ) : null}
          <Text style={[styles.statusPill, accepted ? styles.statusOk : styles.statusWarn]}>
            {statusText}
          </Text>
        </GlassCard>

        <GlassCard style={styles.textCard}>
          <Text style={styles.sectionLabel}>Related Phrase</Text>
          <Text style={styles.bodyText}>{englishPhrase}</Text>
        </GlassCard>

        <GlassCard style={styles.textCard}>
          <Text style={styles.sectionLabel}>Translated Phrase</Text>
          <Text style={styles.bodyText}>{translatedPhrase}</Text>
        </GlassCard>

        {!accepted || bestGuessHint ? (
          <GlassCard style={styles.textCard}>
            <Text style={styles.sectionLabel}>Recognition Details</Text>
            <Text style={styles.bodyText}>{recognizedText}</Text>
            {bestGuessHint ? (
              <Text style={styles.bestGuess}>
                Closest match was &quot;{bestGuessHint}&quot;, but it did not pass the model&apos;s
                acceptance threshold.
              </Text>
            ) : null}
            {!accepted ? (
              <Text style={styles.lowConfidence}>
                Low confidence. Recalibrate per-word pot positions or record longer with a stable
                potentiometer.
              </Text>
            ) : null}
          </GlassCard>
        ) : null}

        {isAiWindowResult ? (
          <GlassCard style={styles.textCard}>
            <Text style={styles.sectionLabel}>Model Details</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Samples used</Text>
              <Text style={styles.metaValue}>{view.samplesUsed ?? '—'}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Signal quality</Text>
              <Text style={styles.metaValue}>{view.quality ?? '—'}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Session adaptation</Text>
              <Text style={styles.metaValue}>{view.sessionAdaptation ?? 'none'}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaKey}>Processing time</Text>
              <Text style={styles.metaValue}>
                {view.processingTimeMs != null ? `${view.processingTimeMs} ms` : '—'}
              </Text>
            </View>
            {persisted ? (
              <Text style={styles.metaSaved}>Saved to history.</Text>
            ) : (
              <Text style={styles.metaNote}>
                Tap Save Result to store this prediction in your history.
              </Text>
            )}
          </GlassCard>
        ) : null}

        <Text style={styles.speechHint}>Speech: {resolvedSpeechLanguage}</Text>
        <GradientButton
          title={speechButtonTitle}
          onPress={handlePlaySpeech}
          disabled={speechState === SPEECH_UI_STATE.STARTING}
        />
        <GradientButton
          title={
            isSaving ? 'Saving...' : persisted ? 'Saved to History' : 'Save Result'
          }
          onPress={handleSaveResult}
          disabled={saveDisabled}
          style={styles.btn}
        />
        <GradientButton
          title="New Recording"
          onPress={() => navigation.navigate('MainTabs', { screen: 'Record' })}
          style={styles.btn}
        />
      </ScrollView>
      {isSpeechActive || isSaving ? (
        <ActivityIndicator size="small" color={colors.primary} style={styles.speakingIndicator} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  predictionCard: { marginBottom: spacing.md, alignItems: 'center' },
  predictedWord: {
    fontSize: 40,
    fontWeight: typography.bold,
    color: colors.primary,
    textTransform: 'capitalize',
    marginVertical: spacing.sm,
    textAlign: 'center',
  },
  predictedWordUncertain: { color: colors.warning },
  confidenceInline: {
    fontSize: typography.body,
    color: colors.textSecondary,
  },
  confidenceBasis: {
    marginTop: spacing.xs,
    fontSize: typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 16,
  },
  statusPill: {
    marginTop: spacing.sm,
    fontSize: typography.small,
    fontWeight: typography.semiBold,
  },
  statusOk: { color: colors.success },
  statusWarn: { color: colors.warning },
  bestGuess: {
    marginTop: spacing.sm,
    fontSize: typography.small,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  metaKey: { fontSize: typography.small, color: colors.textSecondary },
  metaValue: { fontSize: typography.small, color: colors.text, fontWeight: typography.semiBold },
  metaNote: {
    marginTop: spacing.sm,
    fontSize: typography.caption,
    color: colors.textMuted,
    lineHeight: 16,
  },
  metaSaved: {
    marginTop: spacing.sm,
    fontSize: typography.caption,
    color: colors.success,
    lineHeight: 16,
  },
  textCard: { marginBottom: spacing.lg },
  sectionLabel: {
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  bodyText: { fontSize: typography.body, color: colors.text, lineHeight: 24 },
  lowConfidence: {
    marginTop: spacing.sm,
    fontSize: typography.small,
    color: colors.warning,
    lineHeight: 18,
  },
  btn: { marginTop: spacing.sm },
  speechHint: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontSize: typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  speakingIndicator: { marginBottom: spacing.md },
});
