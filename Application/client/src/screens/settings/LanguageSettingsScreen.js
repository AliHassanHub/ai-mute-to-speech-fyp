import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { AppHeader, GradientButton, GlassCard } from '../../components';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { safeGoBack } from '../../navigation/navigationRef';
import { profileApi } from '../../services/api';
import {
  getErrorMessage,
  getSupportedLanguages,
  languageCodeToName,
  normalizeLanguageCode,
} from '../../utils/apiHelpers';
import { colors } from '../../theme/colors';
import spacing from '../../theme/spacing';
import typography from '../../theme/typography';

function RadioOption({ label, selected, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
      <View style={styles.radioRow}>
        <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
          {selected ? <View style={styles.radioInner} /> : null}
        </View>
        <Text style={[styles.radioLabel, selected && styles.radioLabelSelected]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
}

function LanguageSection({ title, subtitle, value, options, onChange }) {
  return (
    <GlassCard style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSubtitle}>{subtitle}</Text>
      {options.map((option) => (
        <RadioOption
          key={`${title}-${option.code}`}
          label={option.name}
          selected={value === option.code}
          onPress={() => onChange(option.code)}
        />
      ))}
    </GlassCard>
  );
}

export default function LanguageSettingsScreen({ navigation }) {
  const { token, user, updateUser } = useAuth();
  const { showToast } = useToast();
  const fallbackLanguages = useMemo(() => getSupportedLanguages(), []);

  const [supportedLanguages, setSupportedLanguages] = useState(fallbackLanguages);
  const [translationLanguage, setTranslationLanguage] = useState('en');
  const [speechLanguage, setSpeechLanguage] = useState('en');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const loadLanguageSettings = useCallback(async () => {
    if (!token) {
      setLoading(false);
      setError('Please log in to manage language settings.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await profileApi.getLanguage(token);
      const options = Array.isArray(data.supportedLanguages)
        ? data.supportedLanguages
        : fallbackLanguages;

      setSupportedLanguages(options);
      setTranslationLanguage(
        normalizeLanguageCode(data.language?.translationLanguage ?? user?.translationLanguage)
      );
      setSpeechLanguage(
        normalizeLanguageCode(data.language?.speechLanguage ?? user?.speechLanguage)
      );
    } catch (err) {
      const options = fallbackLanguages;
      setSupportedLanguages(options);
      setTranslationLanguage(
        normalizeLanguageCode(user?.translationLanguage ?? user?.language ?? 'en')
      );
      setSpeechLanguage(
        normalizeLanguageCode(user?.speechLanguage ?? user?.language ?? 'en')
      );
      setError(getErrorMessage(err, 'Could not load language settings.'));
    } finally {
      setLoading(false);
    }
  }, [token, user, fallbackLanguages]);

  useFocusEffect(
    useCallback(() => {
      loadLanguageSettings();
    }, [loadLanguageSettings])
  );

  const handleSave = async () => {
    if (!token) {
      showToast('Please log in to save language settings.');
      return;
    }

    setSaving(true);
    try {
      const data = await profileApi.updateLanguage(
        translationLanguage,
        speechLanguage,
        token
      );

      await updateUser({
        ...(data.user ?? {}),
        language: data.user?.language ?? `${translationLanguage}:${speechLanguage}`,
        targetLanguage:
          data.language?.translationLanguageName ??
          languageCodeToName(translationLanguage),
        translationLanguage:
          data.language?.translationLanguage ?? translationLanguage,
        speechLanguage: data.language?.speechLanguage ?? speechLanguage,
        translationLanguageName:
          data.language?.translationLanguageName ??
          languageCodeToName(translationLanguage),
        speechLanguageName:
          data.language?.speechLanguageName ?? languageCodeToName(speechLanguage),
        sourceLanguage: 'English',
      });

      showToast('Language settings saved.');
      safeGoBack(navigation);
    } catch (err) {
      showToast(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const languageOptions =
    Array.isArray(supportedLanguages) && supportedLanguages.length > 0
      ? supportedLanguages
      : fallbackLanguages;

  return (
    <View style={styles.container}>
      <AppHeader
        title="Language"
        subtitle="Translation and speech output"
        showBack
        onBackPress={() => safeGoBack(navigation)}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {!loading ? (
          <>
            <LanguageSection
              title="TRANSLATION LANGUAGE"
              subtitle="Language used for translated text after AI recognition."
              value={translationLanguage}
              options={languageOptions}
              onChange={setTranslationLanguage}
            />

            <LanguageSection
              title="SPEECH OUTPUT LANGUAGE"
              subtitle="Language that future text-to-speech will use."
              value={speechLanguage}
              options={languageOptions}
              onChange={setSpeechLanguage}
            />

            <GradientButton
              title={saving ? 'Saving...' : 'Save Changes'}
              onPress={handleSave}
              disabled={saving}
              style={styles.saveBtn}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  loader: { marginVertical: spacing.lg },
  errorText: {
    color: colors.warning,
    marginBottom: spacing.md,
    fontSize: typography.small,
  },
  card: { marginBottom: spacing.lg },
  cardTitle: {
    fontSize: typography.caption,
    fontWeight: typography.semiBold,
    color: colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  cardSubtitle: {
    fontSize: typography.small,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  radioOuterSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    fontSize: typography.body,
    color: colors.text,
  },
  radioLabelSelected: {
    fontWeight: typography.semiBold,
    color: colors.primary,
  },
  saveBtn: { marginTop: spacing.sm },
});
